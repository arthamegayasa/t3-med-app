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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
) {
  const { handler, dispose } = HttpRouter.toWebHandler(
    MedHttp.layer.pipe(
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
  "/api/med/needs-you",
  "/api/med/upcoming",
  "/api/med/counts",
  "/api/med/threads/thread-1/patient",
];

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
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("has no route that links a thread to a patient, or changes anything", () =>
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
        "GET /api/med/threads/:threadId/patient",
        "GET /api/med/upcoming",
      ]);

      // The request the patient pages once sent, and its neighbours, from a session that may do all.
      const call = yield* serve(store, [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
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
        };
        const visit = {
          id: (yield* store.listPlans({ patientId: wayan.id }))[0]?.id,
          patientId: wayan.id,
          title: "Clinic visit",
          due: "2026-11-14",
          type: "follow_up",
          status: "draft",
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

        // Diagnoses and the store's own columns are not part of the contract, so they stay home.
        assert.deepStrictEqual((yield* get(`/api/med/patients/${wayan.id}`)).body, {
          patient: { ...wayanSummary, sex: "male", dateOfBirth: "1968-03-02" },
          notes: [waitingNote],
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
              draftLabs: 0,
              draftPlans: 1,
            },
          ],
          patients: [
            {
              patient: wayanSummary,
              draftLabs: 1,
              draftPlans: 1,
              notes: [{ ...waitingNote, draftLabs: 1, draftPlans: 1 }],
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
