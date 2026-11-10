import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";

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
  const call = (path: string, body?: unknown) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(
          `http://t3med.test${path}`,
          body === undefined
            ? undefined
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
        ),
      );
      const text = await response.text();
      return { status: response.status, body: text === "" ? null : JSON.parse(text) };
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
  return { wayan, made, note: filed.note, inboxNote: inbox.note };
});

const READ_ROUTES = [
  "/api/med/patients",
  "/api/med/patients/some-patient",
  "/api/med/needs-you",
  "/api/med/upcoming",
  "/api/med/counts",
  "/api/med/threads/thread-1/patient",
];

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("med HTTP routes", (it) => {
  it.effect("answers no route without a credential, and no route the session's scopes miss", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan } = yield* seed(store);
      const link = { patientId: wayan.id };

      const anonymous = yield* serve(store, null);
      for (const path of READ_ROUTES) {
        const response = yield* anonymous(path);
        assert.deepStrictEqual(
          [path, response.status, response.body?.reason],
          [path, 401, "missing_credential"],
        );
      }
      assert.strictEqual((yield* anonymous("/api/med/threads/thread-9/patient", link)).status, 401);

      const unscoped = yield* serve(store, []);
      for (const path of READ_ROUTES) {
        assert.deepStrictEqual([path, (yield* unscoped(path)).status], [path, 403]);
      }

      const reader = yield* serve(store, [AuthOrchestrationReadScope]);
      assert.strictEqual((yield* reader("/api/med/counts")).status, 200);
      const refused = yield* reader("/api/med/threads/thread-9/patient", link);
      assert.deepStrictEqual(
        [refused.status, refused.body?.requiredScope],
        [403, AuthOrchestrationOperateScope],
      );
      assert.deepStrictEqual((yield* reader("/api/med/threads/thread-9/patient")).body, {
        patient: null,
      });
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect(
    "serves the directory, a patient's home and what waits, with the contract's fields",
    () =>
      Effect.gen(function* () {
        const store = yield* PatientStore.PatientStore;
        const { wayan, made, note, inboxNote } = yield* seed(store);
        const get = yield* serve(store, [AuthOrchestrationReadScope]);
        const wayanSummary = {
          id: wayan.id,
          name: "I Wayan Sudarma",
          urn: "00-45-67-89",
          status: "new",
          alsoWrittenAs: ["Pak Yan"],
          lastActivityAt: (yield* store.getPatient(wayan.id)).lastActivityAt,
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

        const directory = yield* get("/api/med/patients");
        assert.strictEqual(directory.status, 200);
        assert.deepStrictEqual(directory.body.patients, [
          wayanSummary,
          {
            id: made.id,
            name: "Ni Made Ayu",
            urn: null,
            status: "new",
            alsoWrittenAs: [],
            lastActivityAt: made.lastActivityAt,
          },
        ]);

        // Diagnoses and the store's own columns are not part of the contract, so they stay home.
        assert.deepStrictEqual((yield* get(`/api/med/patients/${wayan.id}`)).body, {
          patient: { ...wayanSummary, sex: "male", dateOfBirth: "1968-03-02" },
          notes: [waitingNote],
          draftLabs: 1,
          draftPlans: 1,
          upcomingPlans: [visit],
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
            plan.patientId,
            plan.type,
            plan.status,
          ]),
          [
            ["2026-11-12", "EEG", null, null, "procedure", "draft"],
            ["2026-11-14", "Clinic visit", "I Wayan Sudarma", wayan.id, "follow_up", "draft"],
          ],
        );

        assert.deepStrictEqual((yield* get("/api/med/counts")).body, {
          inbox: 1,
          patients: 2,
          needsYou: 1,
          upcoming: 2,
        });
      }).pipe(Effect.provide(layerStore)),
  );

  it.effect("links a thread to the patient the doctor chose, and reads the link back", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { wayan, made } = yield* seed(store);
      const call = yield* serve(store, [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
      const path = "/api/med/threads/thread-9/patient";

      assert.deepStrictEqual((yield* call(path)).body, { patient: null });
      assert.deepStrictEqual(yield* call(path, { patientId: made.id }), {
        status: 200,
        body: { patient: { id: made.id, name: "Ni Made Ayu" } },
      });
      assert.deepStrictEqual((yield* call(path)).body, {
        patient: { id: made.id, name: "Ni Made Ayu" },
      });
      // The doctor's later choice replaces the earlier one.
      yield* call(path, { patientId: wayan.id });
      assert.deepStrictEqual((yield* call(path)).body, {
        patient: { id: wayan.id, name: "I Wayan Sudarma" },
      });

      const unknown = yield* call(path, { patientId: "no-such-patient" });
      assert.deepStrictEqual(
        [unknown.status, unknown.body?._tag],
        [404, "MedPatientNotFoundError"],
      );
      assert.strictEqual((yield* call(path, { patient: made.id })).status, 400);
      assert.deepStrictEqual((yield* call(path)).body, {
        patient: { id: wayan.id, name: "I Wayan Sudarma" },
      });
    }).pipe(Effect.provide(layerStore)),
  );
});
