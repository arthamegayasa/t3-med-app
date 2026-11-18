import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { MedHttpApi } from "@t3tools/contracts/med";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Tracer from "effect/Tracer";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import * as HttpApi from "effect/http-api/HttpApi";
import * as TestClock from "effect/testing/TestClock";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as MedDatabase from "./MedDatabase.ts";
import * as MedHttp from "./http.ts";
import * as PatientStore from "./PatientStore.ts";

const layerStore = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-http-test-" });
    return PatientStore.layer.pipe(
      Layer.provideMerge(MedDatabase.layerFromPath(path.join(directory, "t3med.sqlite"))),
    );
  }),
);

type Store = PatientStore.PatientStore["Service"];

// The routes as the server mounts them, over the test's store and a session with these scopes.
// `null` is a request that carries no credential.
const serve = Effect.fn("test.serveMedRoutes")(function* (
  store: Store,
  scopes: ReadonlyArray<AuthEnvironmentScope> | null,
  tracer?: Tracer.Tracer,
) {
  const { handler, dispose } = HttpRouter.toWebHandler(
    MedHttp.layerPatients.pipe(
      Layer.provide(Layer.succeed(PatientStore.PatientStore, store)),
      Layer.provide(
        Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
          authenticateHttpRequest: () =>
            scopes === null
              ? Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError({}))
              : Effect.succeed({
                  sessionId: AuthSessionId.make("test"),
                  subject: "test",
                  method: "browser-session-cookie",
                  scopes,
                }),
        } as unknown as EnvironmentAuth.EnvironmentAuth["Service"]),
      ),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(Etag.layerWeak),
      Layer.provide(NodeServices.layer),
      Layer.provide(tracer === undefined ? Layer.empty : Layer.succeed(Tracer.Tracer, tracer)),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const call = (path: string, write?: { readonly method: string; readonly body: unknown }) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(
          `http://t3med.test${path}`,
          write === undefined
            ? undefined
            : {
                method: write.method,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(write.body),
              },
        ),
      );
      const text = await response.text();
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        body: text === "" ? null : JSON.parse(text),
      };
    });
  return call;
});

const BOTH_SCOPES = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope];

const seed = Effect.fn("test.seedPatients")(function* (store: Store) {
  const wayan = yield* store.createPatient({
    name: "I Wayan Sudarma",
    urn: "00-45-67-89",
    sex: "male",
    dateOfBirth: "1968-03-02",
    diagnoses: "Ischemic stroke",
    alsoWrittenAs: ["Pak Yan"],
  });
  const made = yield* store.createPatient({ name: "Ni Made Ayu" });
  const ketut = yield* store.createPatient({ name: "Ketut Rai" });
  yield* TestClock.adjust(Duration.minutes(1));
  yield* store.linkThread({ threadId: "thread-1", patientId: wayan.id });
  const filed = yield* store.fileFromThread({
    threadId: "thread-1",
    patientId: wayan.id,
    title: "Labs 6 Nov",
    date: "2026-11-06",
    summary: "LDL saved as a draft",
    needsYou: "Is the unit mg/dL?",
    labs: [{ testAsWritten: "LDL", value: 78, unit: "mg/dL", collected: "2026-11-06" }],
    plans: [{ title: "Clinic visit", due: "2026-11-14", type: "follow_up" }],
  });
  const inbox = yield* store.fileFromThread({
    threadId: "thread-2",
    patientId: null,
    title: "Unknown patient",
    date: "2026-11-10",
    needsYou: "Named only as Ketut.",
    plans: [{ title: "EEG", due: "2026-11-12", type: "procedure" }],
  });
  // Made's chat is the latest, so the directory's order is not the order of the names.
  yield* TestClock.adjust(Duration.minutes(1));
  yield* store.linkThread({ threadId: "thread-3", patientId: made.id });
  return { wayan, made, ketut, note: filed.note, inboxNote: inbox.note };
});

const READ_ROUTES = [
  "/api/med/patients",
  "/api/med/patients/some-patient",
  "/api/med/patients/some-patient/record",
  "/api/med/patients/some-patient/removed",
  "/api/med/needs-you",
  "/api/med/upcoming",
  "/api/med/counts",
  "/api/med/threads/thread-1/patient",
  "/api/med/thread-patients",
];

const WRITE_ROUTES = [
  ["PATCH", "/api/med/patients/some-patient", { diagnoses: "Migraine" }],
  ["PATCH", "/api/med/labs/some-lab", { unit: "mg/dL" }],
  ["POST", "/api/med/labs/some-lab/undo-correction", {}],
  ["PUT", "/api/med/labs/some-lab/verified", { verified: true }],
  ["PUT", "/api/med/labs/some-lab/removed", { removed: true }],
  ["PATCH", "/api/med/plans/some-plan", { status: "done" }],
  ["PUT", "/api/med/plans/some-plan/verified", { verified: true }],
  ["PUT", "/api/med/plans/some-plan/removed", { removed: true }],
  ["POST", "/api/med/notes/some-note/verify", { labIds: [], planIds: [] }],
  ["POST", "/api/med/notes/some-note/unverify", { labIds: [], planIds: [] }],
  ["PUT", "/api/med/notes/some-note/question-handled", { handled: true }],
  ["POST", "/api/med/notes/some-note/inbox", undefined],
] as const;

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("med HTTP routes", (it) => {
  it.effect("answers no route without a credential, and no route the session's scopes miss", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      yield* seed(store);

      // Patient data is never kept by a cache, whatever the answer.
      const anonymous = yield* serve(store, null);
      for (const path of READ_ROUTES) {
        const response = yield* anonymous(path);
        assert.deepStrictEqual(
          [path, response.status, response.body?.reason, response.cacheControl],
          [path, 401, "missing_credential", "no-store"],
        );
      }

      const unscoped = yield* serve(store, []);
      for (const path of READ_ROUTES) {
        const response = yield* unscoped(path);
        assert.deepStrictEqual(
          [path, response.status, response.cacheControl],
          [path, 403, "no-store"],
        );
      }

      const reader = yield* serve(store, [AuthOrchestrationReadScope]);
      for (const path of READ_ROUTES) {
        const response = yield* reader(path);
        assert.deepStrictEqual(
          [path, response.status, response.cacheControl],
          [path, path.includes("some-patient") ? 404 : 200, "no-store"],
        );
      }
      assert.deepStrictEqual((yield* reader("/api/med/threads/thread-9/patient")).body, {
        patient: null,
      });

      // A change needs the operate scope on top of what a read needs, and a credential first.
      const statuses = Effect.fn("test.writeStatuses")(function* (
        scopes: ReadonlyArray<AuthEnvironmentScope> | null,
      ) {
        const call = yield* serve(store, scopes);
        const answers = yield* Effect.forEach(WRITE_ROUTES, ([method, path, body]) =>
          call(path, { method, body }),
        );
        assert.deepStrictEqual(
          answers.map((answer) => answer.cacheControl),
          WRITE_ROUTES.map(() => "no-store"),
        );
        return [...new Set(answers.map((answer) => answer.status))];
      });
      assert.deepStrictEqual(yield* statuses(null), [401]);
      assert.deepStrictEqual(yield* statuses([]), [403]);
      assert.deepStrictEqual(yield* statuses([AuthOrchestrationReadScope]), [403]);
      assert.deepStrictEqual(yield* statuses([AuthOrchestrationOperateScope]), [403]);
      assert.deepStrictEqual(yield* statuses(BOTH_SCOPES), [404]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("has no route that links a thread to a patient, whatever else it changes", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, made } = yield* seed(store);
      const routes: Array<string> = [];
      HttpApi.reflect(MedHttpApi, {
        onGroup: () => {},
        onEndpoint: ({ endpoint }) => routes.push(`${endpoint.method} ${endpoint.path}`),
      });
      assert.deepStrictEqual(routes.toSorted(), [
        "GET /api/med/counts",
        "GET /api/med/needs-you",
        "GET /api/med/patients",
        "GET /api/med/patients/:patientId",
        "GET /api/med/patients/:patientId/record",
        "GET /api/med/patients/:patientId/removed",
        "GET /api/med/thread-patients",
        "GET /api/med/threads/:threadId/patient",
        "GET /api/med/upcoming",
        "PATCH /api/med/labs/:labId",
        "PATCH /api/med/patients/:patientId",
        "PATCH /api/med/plans/:planId",
        "POST /api/med/labs/:labId/undo-correction",
        "POST /api/med/notes/:noteId/inbox",
        "POST /api/med/notes/:noteId/unverify",
        "POST /api/med/notes/:noteId/verify",
        "PUT /api/med/labs/:labId/removed",
        "PUT /api/med/labs/:labId/verified",
        "PUT /api/med/notes/:noteId/question-handled",
        "PUT /api/med/plans/:planId/removed",
        "PUT /api/med/plans/:planId/verified",
      ]);
      // Every route that changes something is listed with the others that are tried below.
      assert.deepStrictEqual(
        routes.filter((route) => !route.startsWith("GET ")).toSorted(),
        WRITE_ROUTES.map(
          ([method, path]) => `${method} ${path.replace(/some-(\w+)/, ":$1Id")}`,
        ).toSorted(),
      );

      // The request the patient pages once sent, and its neighbours, from a session that may do all.
      const call = yield* serve(store, BOTH_SCOPES);
      for (const threadId of ["thread-1", "thread-9"]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = yield* call(`/api/med/threads/${threadId}/patient`, {
            method,
            body: { patientId: made.id },
          });
          assert.deepStrictEqual([method, threadId, response.status], [method, threadId, 404]);
        }
      }
      const linked = (threadId: string) =>
        store
          .getThreadPatient(threadId)
          .pipe(Effect.map((patient) => Option.getOrNull(patient)?.id ?? null));
      assert.deepStrictEqual(
        [yield* linked("thread-1"), yield* linked("thread-9")],
        [wayan.id, null],
      );

      // Nor does any change the routes do make: a note sent back to the Inbox leaves its
      // thread linked, and a thread no agent linked stays unlinked.
      const lab = (yield* store.listLabs({ patientId: wayan.id }))[0];
      const plan = (yield* store.listPlans({ patientId: wayan.id }))[0];
      const note = lab?.sourceNoteId ?? "";
      const real = (path: string) =>
        path
          .replace("some-patient", wayan.id)
          .replace("some-lab", lab?.id ?? "")
          .replace("some-plan", plan?.id ?? "")
          .replace("some-note", note);
      for (const [method, path, body] of WRITE_ROUTES) {
        const response = yield* call(real(path), { method, body });
        // The one refusal: nothing was corrected, so there is no correction to undo.
        assert.deepStrictEqual(
          [path, response.status],
          [path, path.endsWith("undo-correction") ? 422 : 200],
        );
      }
      assert.strictEqual((yield* store.listNeedsYou()).inbox.length, 2);
      assert.deepStrictEqual(
        [yield* linked("thread-1"), yield* linked("thread-2"), yield* linked("thread-9")],
        [wayan.id, null, null],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("corrects, verifies, removes and restores a result, with what it said before", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, note } = yield* seed(store);
      const call = yield* serve(store, BOTH_SCOPES);
      const lab = (yield* store.listLabs({ patientId: wayan.id }))[0]!;
      const path = `/api/med/labs/${lab.id}`;
      const stored = store
        .listLabs({ patientId: wayan.id })
        .pipe(Effect.map((labs) => labs.map((row) => [row.valueText, row.status])));

      const corrected = yield* call(path, {
        method: "PATCH",
        body: { value: 87, valueText: "87", flag: "normal" },
      });
      assert.strictEqual(corrected.status, 200);
      assert.deepInclude(corrected.body, {
        id: lab.id,
        testName: "LDL cholesterol",
        value: 87,
        valueText: "87",
        flag: "normal",
        status: "draft",
        noteId: note.id,
      });
      const revision = {
        correctedBy: "doctor",
        testAsWritten: "LDL",
        value: 78,
        valueText: "78",
        unit: "mg/dL",
        referenceRange: "",
        flag: null,
        collected: "2026-11-06",
        status: "draft",
      };
      assert.deepInclude(corrected.body.revisions[0], revision);
      const record = (yield* call(`/api/med/patients/${wayan.id}/record`)).body;
      assert.deepInclude(record.labs[0].revisions[0], revision);

      const verified = yield* call(`${path}/verified`, { method: "PUT", body: { verified: true } });
      assert.deepStrictEqual(
        [verified.status, verified.body.verified, typeof verified.body.updatedAt],
        [200, true, "string"],
      );
      assert.deepStrictEqual(yield* stored, [["87", "verified"]]);
      assert.strictEqual((yield* store.getPatient(wayan.id)).status, "active");
      yield* call(`${path}/verified`, { method: "PUT", body: { verified: false } });
      assert.deepStrictEqual(yield* stored, [["87", "draft"]]);

      const removed = yield* call(`${path}/removed`, { method: "PUT", body: { removed: true } });
      assert.deepStrictEqual([removed.status, removed.body.removed], [200, true]);
      assert.deepStrictEqual(yield* stored, []);
      assert.strictEqual(
        (yield* call(path, { method: "PATCH", body: { unit: "mg/dl" } })).status,
        404,
      );
      // The list that puts a removed row back names it as the Labs surface does.
      assert.deepStrictEqual((yield* call(`/api/med/patients/${wayan.id}/removed`)).body, {
        labs: [
          {
            id: lab.id,
            testName: "LDL cholesterol",
            valueText: "87",
            unit: "mg/dL",
            collected: "2026-11-06",
            removedAt: removed.body.updatedAt,
          },
        ],
        plans: [],
      });
      assert.strictEqual((yield* call("/api/med/patients/nobody/removed")).status, 404);
      yield* call(`${path}/removed`, {
        method: "PUT",
        body: { removed: false, ifUpdatedAt: removed.body.updatedAt },
      });
      assert.deepStrictEqual(yield* stored, [["87", "draft"]]);

      // An undo that names a row as it no longer is, or a correction that is not the latest,
      // is answered as a conflict and changes nothing.
      const late = { _tag: "MedChangedSinceError", row: "lab", id: lab.id };
      const lateRemoval = yield* call(`${path}/removed`, {
        method: "PUT",
        body: { removed: true, ifUpdatedAt: "2026-01-01T00:00:00.000Z" },
      });
      assert.deepStrictEqual([lateRemoval.status, lateRemoval.body], [409, late]);
      const lateUndo = yield* call(`${path}/undo-correction`, {
        method: "POST",
        body: { revisionId: "another-correction" },
      });
      assert.deepStrictEqual([lateUndo.status, lateUndo.body], [409, late]);
      const mismatch = yield* call(path, { method: "PATCH", body: { valueText: "165" } });
      assert.deepStrictEqual([mismatch.status, mismatch.body.reason.includes("165")], [422, false]);
      assert.deepStrictEqual(yield* stored, [["87", "draft"]]);

      const undone = yield* call(`${path}/undo-correction`, {
        method: "POST",
        body: { revisionId: corrected.body.revisions[0].id },
      });
      assert.deepInclude(undone.body, { value: 78, valueText: "78", flag: null, revisions: [] });
      const nothingToUndo = yield* call(`${path}/undo-correction`, { method: "POST", body: {} });
      assert.deepStrictEqual(
        [nothingToUndo.status, nothingToUndo.body],
        [
          422,
          {
            _tag: "MedRefusedError",
            reason: `Lab result ${lab.id} has no correction to undo.`,
          },
        ],
      );

      // A refusal names the field, and a value of the wrong kind never reaches the store.
      const badDate = yield* call(path, { method: "PATCH", body: { collected: "6 Nov" } });
      assert.deepStrictEqual(
        [badDate.status, badDate.body.reason],
        [422, "collected must be a calendar date written as YYYY-MM-DD."],
      );
      assert.strictEqual(
        (yield* call(path, { method: "PATCH", body: { value: "high" } })).status,
        400,
      );
      const missing = yield* call("/api/med/labs/no-such-lab", {
        method: "PATCH",
        body: { unit: "mg/dL" },
      });
      assert.deepStrictEqual(
        [missing.status, missing.body],
        [404, { _tag: "MedRowNotFoundError", row: "lab", id: "no-such-lab" }],
      );
      assert.deepStrictEqual(yield* stored, [["78", "draft"]]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("closes, reopens, changes and verifies a plan, and a whole note", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, note, inboxNote } = yield* seed(store);
      const call = yield* serve(store, BOTH_SCOPES);
      const plan = (yield* store.listPlans({ patientId: wayan.id }))[0]!;
      const path = `/api/med/plans/${plan.id}`;
      const change = (body: unknown) => call(path, { method: "PATCH", body });

      const done = yield* change({ status: "done", doneOn: "2026-11-13" });
      assert.deepStrictEqual(
        [done.status, done.body],
        [
          200,
          {
            id: plan.id,
            patientId: wayan.id,
            title: "Clinic visit",
            due: "2026-11-14",
            type: "follow_up",
            status: "done",
            doneOn: "2026-11-13",
            updatedAt: done.body.updatedAt,
          },
        ],
      );
      const lateReopen = yield* change({ status: "open", ifUpdatedAt: "2026-01-01T00:00:00.000Z" });
      assert.deepStrictEqual(
        [lateReopen.status, lateReopen.body],
        [409, { _tag: "MedChangedSinceError", row: "plan", id: plan.id }],
      );
      assert.deepInclude((yield* change({ status: "open" })).body, {
        status: "draft",
        doneOn: null,
      });
      assert.deepInclude(
        (yield* change({ title: "Clinic visit and MRI", due: "2026-11-21" })).body,
        { title: "Clinic visit and MRI", due: "2026-11-21", status: "draft" },
      );
      const notDone = yield* change({ doneOn: "2026-11-13" });
      assert.deepStrictEqual(
        [notDone.status, notDone.body.reason],
        [
          422,
          `doneOn is the day a plan was done; plan ${plan.id} is not done, so send it with status done.`,
        ],
      );
      assert.strictEqual((yield* change({ status: "planned" })).status, 400);

      const verified = yield* call(`${path}/verified`, { method: "PUT", body: { verified: true } });
      assert.deepStrictEqual([verified.status, verified.body.verified], [200, true]);
      assert.strictEqual((yield* store.listPlans({ patientId: wayan.id }))[0]?.status, "planned");

      yield* call(`${path}/removed`, { method: "PUT", body: { removed: true } });
      assert.deepStrictEqual((yield* call(`/api/med/patients/${wayan.id}`)).body.upcomingPlans, []);
      yield* call(`${path}/removed`, { method: "PUT", body: { removed: false } });
      assert.lengthOf((yield* call(`/api/med/patients/${wayan.id}`)).body.upcomingPlans, 1);

      // The patient's page says how many drafts each note still holds, which is what it offers to verify.
      assert.deepInclude((yield* call(`/api/med/patients/${wayan.id}`)).body.notes[0], {
        id: note.id,
        draftLabs: 1,
        draftPlans: 0,
      });
      // Verifying a note needs the rows the page showed; none named is none verified.
      const verifyNote = (noteId: string, body: unknown) =>
        call(`/api/med/notes/${noteId}/verify`, { method: "POST", body });
      assert.strictEqual((yield* verifyNote(note.id, undefined)).status, 400);
      assert.deepInclude((yield* verifyNote(note.id, { labIds: [], planIds: [] })).body, {
        labsVerified: 0,
      });
      const shown = (yield* call(`/api/med/patients/${wayan.id}`)).body.notes[0].draftLabRows;
      assert.deepStrictEqual(shown, [
        {
          id: shown[0].id,
          testName: "LDL cholesterol",
          valueText: "78",
          unit: "mg/dL",
          collected: "2026-11-06",
        },
      ]);
      const rows = { labIds: [shown[0].id], planIds: [] };
      const whole = yield* verifyNote(note.id, rows);
      assert.deepStrictEqual(
        [whole.status, whole.body],
        [200, { labsVerified: 1, plansPlanned: 0, patientActivated: false, ...rows }],
      );
      const back = yield* call(`/api/med/notes/${note.id}/unverify`, {
        method: "POST",
        body: rows,
      });
      assert.deepStrictEqual([back.status, back.body], [200, rows]);
      assert.strictEqual((yield* store.listLabs({ patientId: wayan.id }))[0]?.status, "draft");

      // A question marked as handled leaves Needs you and stays on the note.
      const handle = (handled: boolean) =>
        call(`/api/med/notes/${note.id}/question-handled`, { method: "PUT", body: { handled } });
      yield* verifyNote(note.id, rows);
      assert.strictEqual((yield* call("/api/med/counts")).body.needsYou, 1);
      assert.deepStrictEqual((yield* handle(true)).body, { handled: true });
      assert.strictEqual((yield* call("/api/med/counts")).body.needsYou, 0);
      const handledNote = (yield* call(`/api/med/patients/${wayan.id}`)).body.notes[0];
      assert.strictEqual(handledNote.needsYou, "Is the unit mg/dL?");
      assert.isString(handledNote.needsYouHandledAt);
      yield* handle(false);
      assert.strictEqual((yield* call("/api/med/counts")).body.needsYou, 1);

      const inInbox = yield* verifyNote(inboxNote.id, { labIds: [], planIds: [] });
      assert.deepStrictEqual(
        [inInbox.status, inInbox.body.reason],
        [422, `Note ${inboxNote.id} is in the Inbox; move it to a patient before verifying it.`],
      );

      const moved = yield* call(`/api/med/notes/${note.id}/inbox`, {
        method: "POST",
        body: undefined,
      });
      assert.deepStrictEqual([moved.status, moved.body], [200, { noteId: note.id }]);
      assert.deepStrictEqual(
        (yield* store.listLabs({ inbox: true })).map((lab) => [lab.valueText, lab.status]),
        [["78", "draft"]],
      );
      const again = yield* call(`/api/med/notes/${note.id}/inbox`, {
        method: "POST",
        body: undefined,
      });
      assert.deepStrictEqual(
        [again.status, again.body.reason],
        [422, `Note ${note.id} is already in the Inbox.`],
      );
      const missing = yield* call("/api/med/notes/no-such-note/inbox", {
        method: "POST",
        body: undefined,
      });
      assert.deepStrictEqual(
        [missing.status, missing.body],
        [404, { _tag: "MedRowNotFoundError", row: "note", id: "no-such-note" }],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("edits a patient's details, archives and brings back, and keeps URNs apart", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, made } = yield* seed(store);
      const call = yield* serve(store, BOTH_SCOPES);
      const edit = (patientId: string, body: unknown) =>
        call(`/api/med/patients/${patientId}`, { method: "PATCH", body });

      const edited = yield* edit(wayan.id, {
        name: "I Wayan Sudarma, S.H.",
        urn: "00-45-67-90",
        sex: null,
        dateOfBirth: "1968-03-03",
        diagnoses: "Ischemic stroke\nHypertension",
        alsoWrittenAs: ["Pak Wayan"],
      });
      assert.strictEqual(edited.status, 200);
      assert.deepInclude(edited.body, {
        id: wayan.id,
        name: "I Wayan Sudarma, S.H.",
        urn: "00-45-67-90",
        sex: null,
        dateOfBirth: "1968-03-03",
        diagnoses: "Ischemic stroke\nHypertension",
        alsoWrittenAs: ["Pak Wayan"],
        status: "new",
      });

      assert.strictEqual((yield* edit(wayan.id, { archived: true })).body.status, "archived");
      assert.strictEqual((yield* call("/api/med/counts")).body.patients, 2);
      assert.strictEqual((yield* edit(wayan.id, { archived: false })).body.status, "new");
      assert.strictEqual((yield* call("/api/med/counts")).body.patients, 3);
      // An undo takes off the one spelling its edit added, and leaves the others.
      assert.deepStrictEqual(
        (yield* edit(wayan.id, { addSpellings: ["Wyn"], removeSpellings: ["pak wayan"] })).body
          .alsoWrittenAs,
        ["Wyn"],
      );
      assert.deepStrictEqual(
        (yield* edit(wayan.id, { addSpellings: ["Pak Wayan"], removeSpellings: ["Wyn"] })).body
          .alsoWrittenAs,
        ["Pak Wayan"],
      );
      const noKey = yield* edit(made.id, { urn: "---" });
      assert.deepStrictEqual([noKey.status, noKey.body.reason], [422, "urn must not be blank."]);

      const taken = yield* edit(made.id, { urn: "00 45 67 90" });
      assert.deepStrictEqual(
        [taken.status, taken.body],
        [
          409,
          {
            _tag: "MedUrnTakenError",
            patientId: wayan.id,
            patientName: "I Wayan Sudarma, S.H.",
          },
        ],
      );
      const badDate = yield* edit(made.id, { dateOfBirth: "1968" });
      assert.deepStrictEqual(
        [badDate.status, badDate.body.reason],
        [422, "dateOfBirth must be a calendar date written as YYYY-MM-DD."],
      );
      assert.strictEqual(
        (yield* edit(made.id, { name: " " })).body.reason,
        "name must not be blank.",
      );
      assert.strictEqual((yield* edit(made.id, { archived: "yes" })).status, 400);
      assert.strictEqual((yield* edit("no-such-patient", { name: "Nobody" })).status, 404);
      assert.deepInclude(yield* store.getPatient(made.id), { name: "Ni Made Ayu", urn: null });
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("keeps what a change carries, and whose URN was taken, out of every span", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, made } = yield* seed(store);
      const spans: Array<Tracer.NativeSpan> = [];
      const call = yield* serve(
        store,
        BOTH_SCOPES,
        Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        }),
      );
      const secret = "Sekarwangi";
      const lab = (yield* store.listLabs({ patientId: wayan.id }))[0]!;
      const plan = (yield* store.listPlans({ patientId: wayan.id }))[0]!;

      yield* call(`/api/med/patients/${wayan.id}`, {
        method: "PATCH",
        body: { name: `Ni Luh ${secret}`, urn: "00-55-66-77", diagnoses: `${secret}: migraine` },
      });
      const taken = yield* call(`/api/med/patients/${made.id}`, {
        method: "PATCH",
        body: { urn: "00-55-66-77" },
      });
      assert.strictEqual(taken.body.patientName, `Ni Luh ${secret}`);
      yield* call(`/api/med/labs/${lab.id}`, {
        method: "PATCH",
        body: { value: 87, valueText: `87 (${secret})` },
      });
      yield* call(`/api/med/labs/${lab.id}`, {
        method: "PATCH",
        body: { collected: `when ${secret} came` },
      });
      yield* call(`/api/med/labs/${lab.id}`, { method: "PATCH", body: { value: secret } });
      yield* call(`/api/med/plans/${plan.id}`, {
        method: "PATCH",
        body: { title: `Visit of ${secret}`, doneOn: `the day ${secret} came` },
      });

      const recorded = JSON.stringify(
        spans.map((span) => ({
          name: span.name,
          attributes: Object.fromEntries(span.attributes),
          events: span.events,
          exit:
            span.status._tag === "Ended" && Exit.isFailure(span.status.exit)
              ? Cause.pretty(span.status.exit.cause)
              : "",
        })),
      );
      const names = spans.map((span) => span.name);
      assert.include(names, "PatientStore.updatePatient");
      assert.include(names, "PatientStore.correctLab");
      assert.include(names, "med.patients.updatePlan");
      assert.notInclude(recorded, secret);
      assert.notInclude(recorded, "00-55-66-77");
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect(
    "serves the directory, a patient's home and what waits, with the contract's fields",
    () =>
      Effect.gen(function* () {
        const store = yield* PatientStore.PatientStore;
        const { wayan, made, ketut, note, inboxNote } = yield* seed(store);
        const get = yield* serve(store, [AuthOrchestrationReadScope]);
        const wayanSummary = {
          id: wayan.id,
          name: "I Wayan Sudarma",
          urn: "00-45-67-89",
          status: "new",
          alsoWrittenAs: ["Pak Yan"],
          lastChatAt: note.updatedAt,
        };
        const waitingNote = {
          id: note.id,
          threadId: "thread-1",
          title: "Labs 6 Nov",
          date: "2026-11-06",
          summary: "LDL saved as a draft",
          needsYou: "Is the unit mg/dL?",
          needsYouHandledAt: null,
        };
        const stored = (yield* store.listPlans({ patientId: wayan.id }))[0];
        const visit = {
          id: stored?.id,
          patientId: wayan.id,
          title: "Clinic visit",
          due: "2026-11-14",
          type: "follow_up",
          status: "draft",
          doneOn: null,
          updatedAt: stored?.updatedAt,
        };
        // A waiting note lists its drafts, each named enough to know which row it is.
        const drafts = {
          draftLabs: 1,
          draftPlans: 1,
          draftLabRows: [
            {
              id: (yield* store.listLabs({ patientId: wayan.id }))[0]?.id,
              testName: "LDL cholesterol",
              valueText: "78",
              unit: "mg/dL",
              collected: "2026-11-06",
            },
          ],
          draftPlanRows: [{ id: stored?.id, title: "Clinic visit", due: "2026-11-14" }],
        };
        const madeLinkedAt = (yield* store.getPatientHome(made.id)).threads[0]?.linkedAt;
        assert.isTrue(madeLinkedAt !== undefined && madeLinkedAt > note.updatedAt);

        // Latest chat first; a patient with no chat has no last chat and comes after them.
        const directory = yield* get("/api/med/patients");
        assert.strictEqual(directory.status, 200);
        assert.deepStrictEqual(directory.body.patients, [
          {
            id: made.id,
            name: "Ni Made Ayu",
            urn: null,
            status: "new",
            alsoWrittenAs: [],
            lastChatAt: madeLinkedAt,
          },
          wayanSummary,
          {
            id: ketut.id,
            name: "Ketut Rai",
            urn: null,
            status: "new",
            alsoWrittenAs: [],
            lastChatAt: null,
          },
        ]);

        // Diagnoses and the store's own columns are not in this route's schema, so they stay home.
        assert.deepStrictEqual((yield* get(`/api/med/patients/${wayan.id}`)).body, {
          patient: { ...wayanSummary, sex: "male", dateOfBirth: "1968-03-02" },
          notes: [{ ...waitingNote, ...drafts }],
          threads: [{ threadId: "thread-1", linkedAt: note.updatedAt }],
          draftLabs: 1,
          draftPlans: 1,
          upcomingPlans: [visit],
        });
        // A chat that filed nothing is still one of the patient's chats.
        assert.deepInclude((yield* get(`/api/med/patients/${made.id}`)).body, {
          notes: [],
          threads: [{ threadId: "thread-3", linkedAt: madeLinkedAt }],
        });
        const missing = yield* get("/api/med/patients/no-such-patient");
        assert.deepStrictEqual(
          [missing.status, missing.body],
          [404, { _tag: "MedPatientNotFoundError", patientId: "no-such-patient" }],
        );

        assert.deepStrictEqual((yield* get("/api/med/needs-you")).body, {
          inbox: [
            {
              id: inboxNote.id,
              threadId: "thread-2",
              title: "Unknown patient",
              date: "2026-11-10",
              summary: "",
              needsYou: "Named only as Ketut.",
              needsYouHandledAt: null,
              draftLabs: 0,
              draftPlans: 1,
              draftLabRows: [],
              draftPlanRows: [
                {
                  id: (yield* store.listPlans({ inbox: true }))[0]?.id,
                  title: "EEG",
                  due: "2026-11-12",
                },
              ],
            },
          ],
          patients: [
            {
              patient: wayanSummary,
              draftLabs: 1,
              draftPlans: 1,
              notes: [{ ...waitingNote, ...drafts }],
            },
          ],
        });

        const upcoming = yield* get("/api/med/upcoming");
        assert.deepStrictEqual(
          upcoming.body.plans.map((plan: Record<string, unknown>) => [
            plan.due,
            plan.title,
            plan.patientName,
            plan.patientUrn,
            plan.patientId,
            plan.type,
            plan.status,
          ]),
          [
            ["2026-11-12", "EEG", null, null, null, "procedure", "draft"],
            [
              "2026-11-14",
              "Clinic visit",
              "I Wayan Sudarma",
              "00-45-67-89",
              wayan.id,
              "follow_up",
              "draft",
            ],
          ],
        );

        assert.deepStrictEqual((yield* get("/api/med/counts")).body, {
          inbox: 1,
          patients: 3,
          needsYou: 1,
          upcoming: 2,
        });
        assert.deepStrictEqual((yield* get("/api/med/threads/thread-3/patient")).body, {
          patient: { id: made.id, name: "Ni Made Ayu" },
        });
        // Every linked thread in one answer, for the sidebar: the Inbox chat (thread-2) has none.
        assert.deepStrictEqual((yield* get("/api/med/thread-patients")).body, {
          links: [
            {
              threadId: "thread-1",
              patientId: wayan.id,
              name: "I Wayan Sudarma",
              urn: "00-45-67-89",
            },
            { threadId: "thread-3", patientId: made.id, name: "Ni Made Ayu", urn: null },
          ],
        });
      }).pipe(Effect.provide(layerStore)),
  );

  it.effect("serves a patient's record with every lab as stored and an English test name", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, note } = yield* seed(store);
      yield* store.fileFromThread({
        threadId: "thread-4",
        patientId: null,
        title: "Labs 16 Oct",
        date: "2026-10-16",
        labs: [
          {
            testAsWritten: "Anti-dsDNA",
            value: null,
            valueText: "negative",
            collected: "2026-10-16",
          },
          {
            testAsWritten: "Kolesterol LDL",
            value: 2.6,
            unit: "mmol/L",
            referenceRange: "< 2.6",
            flag: "high",
            collected: "2026-10-16",
          },
        ],
      });
      const earlier = yield* store.moveThreadNoteToPatient({
        threadId: "thread-4",
        patientId: wayan.id,
      });
      yield* store.verifyNote(earlier.note.id);
      const stored = yield* store.getPatientRecord({ patientId: wayan.id });
      const get = yield* serve(store, [AuthOrchestrationReadScope]);

      const record = (yield* get(`/api/med/patients/${wayan.id}/record`)).body;
      assert.deepInclude(record.patient, {
        id: wayan.id,
        name: "I Wayan Sudarma",
        sex: "male",
        dateOfBirth: "1968-03-02",
        diagnoses: "Ischemic stroke",
      });
      // Oldest first. The catalogue row was named by the sheet that filed it last here, in
      // Indonesian or English; a known Test ID reads the same either way, an unknown test as written.
      const ldlTest = stored.labs.find((lab) => lab.testId === "ldl")?.labTestId;
      assert.deepStrictEqual(
        record.labs.map((lab: Record<string, unknown>) => [
          lab.collected,
          lab.testName,
          lab.testId,
          lab.labTestId === ldlTest,
          lab.valueText,
          lab.unit,
          lab.referenceRange,
          lab.flag,
          lab.status,
          lab.isBaseline,
          lab.noteId,
        ]),
        [
          [
            "2026-10-16",
            "Anti-dsDNA",
            null,
            false,
            "negative",
            "",
            "",
            null,
            "verified",
            false,
            earlier.note.id,
          ],
          [
            "2026-10-16",
            "LDL cholesterol",
            "ldl",
            true,
            "2.6",
            "mmol/L",
            "< 2.6",
            "high",
            "verified",
            true,
            earlier.note.id,
          ],
          [
            "2026-11-06",
            "LDL cholesterol",
            "ldl",
            true,
            "78",
            "mg/dL",
            "",
            null,
            "draft",
            false,
            note.id,
          ],
        ],
      );
      // The comparison is the store's: the route passes its numbers on and computes none.
      const latest = stored.labs.at(-1);
      assert.isTrue(latest?.valueInBaselineUnit != null && latest.changeFromBaseline != null);
      assert.deepInclude(record.labs.at(-1), {
        value: 78,
        valueInBaselineUnit: latest?.valueInBaselineUnit,
        changeFromBaseline: latest?.changeFromBaseline,
        changePercent: latest?.changePercent,
        changeUnit: "mmol/L",
        notCompared: null,
      });
      assert.deepStrictEqual(
        record.plans.map((plan: Record<string, unknown>) => [plan.title, plan.due, plan.status]),
        [["Clinic visit", "2026-11-14", "draft"]],
      );
      assert.deepStrictEqual(
        record.notes.map((entry: Record<string, unknown>) => [entry.date, entry.title]),
        [
          ["2026-11-06", "Labs 6 Nov"],
          ["2026-10-16", "Labs 16 Oct"],
        ],
      );
      assert.notProperty(record.notes[0], "files");
    }).pipe(Effect.provide(layerStore)),
  );
});
