/**
 * T3 Med: the routes the patient pages read and the doctor's changes go through. Each handler
 * checks the session's scopes, calls one `PatientStore` method and maps its failure; the
 * contract's schemas drop every store field the pages do not show. No handler passes a thread
 * id, and none links a thread to a patient.
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthenticatedAuth,
} from "@t3tools/contracts";
import {
  MedHttpApi,
  MedPatientNotFoundError,
  MedRefusedError,
  MedRowNotFoundError,
  MedUrnTakenError,
} from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpServerResponse } from "effect/http";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  layerAuthenticatedAuth,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { testDisplayName } from "./labs.ts";
import * as PatientStore from "./PatientStore.ts";

// Only the step is logged: the cause of a failed statement can carry what it was given.
const failStore = Effect.fnUntraced(function* (error: PatientStore.PatientStoreError) {
  yield* Effect.logError("patient store failed for a med route", { operation: error.operation });
  return yield* failEnvironmentInternal("internal_error");
});

const failMissingPatient = (error: PatientStore.PatientNotFoundError) =>
  Effect.fail(new MedPatientNotFoundError({ patientId: error.patientId }));

// A change needs what a read needs, and the scope to operate on top of it.
const requireChangeScopes = Effect.fnUntraced(function* (endpoint: string) {
  yield* annotateEnvironmentRequest(endpoint);
  yield* requireEnvironmentScope(AuthOrchestrationReadScope);
  yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
});

// The store's own sentence: it names the field or the row's id, never what was sent.
const refuse = (error: { readonly message: string }) =>
  Effect.fail(new MedRefusedError({ reason: error.message }));

const failMissingLab = (error: PatientStore.LabNotFoundError) =>
  Effect.fail(new MedRowNotFoundError({ row: "lab", id: error.labId }));

const failMissingPlan = (error: PatientStore.PlanNotFoundError) =>
  Effect.fail(new MedRowNotFoundError({ row: "plan", id: error.planId }));

const failMissingNote = (error: PatientStore.NoteNotFoundError) =>
  Effect.fail(new MedRowNotFoundError({ row: "note", id: error.noteId }));

// No handler passes a thread, so no row is out of reach.
const dieOutOfReach = (error: PatientStore.RowOutOfReachError) => Effect.die(error);

const labForPage = (lab: PatientStore.Lab) => ({
  ...lab,
  testName: testDisplayName(lab.testId) ?? lab.testName,
  noteId: lab.sourceNoteId,
});

const layerHandlers = HttpApiBuilder.group(
  MedHttpApi,
  "patients",
  Effect.fnUntraced(function* (handlers) {
    const store = yield* PatientStore.PatientStore;
    return handlers
      .handle(
        "list",
        Effect.fn("med.patients.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const patients = yield* store
            .listPatients()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return { patients };
        }),
      )
      .handle(
        "home",
        Effect.fn("med.patients.home")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store.getPatientHome(args.params.patientId).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
            }),
          );
        }),
      )
      .handle(
        "record",
        Effect.fn("med.patients.record")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const record = yield* store.getPatientRecord({ patientId: args.params.patientId }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
            }),
          );
          return { ...record, labs: record.labs.map(labForPage) };
        }),
      )
      .handle(
        "needsYou",
        Effect.fn("med.patients.needsYou")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store
            .listNeedsYou()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
        }),
      )
      .handle(
        "upcoming",
        Effect.fn("med.patients.upcoming")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const plans = yield* store.listUpcomingPlans().pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              // No range is given, so neither can be refused.
              InvalidDateError: (error) => Effect.die(error),
              DateRangeError: (error) => Effect.die(error),
            }),
          );
          return { plans };
        }),
      )
      .handle(
        "counts",
        Effect.fn("med.patients.counts")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store.getCounts().pipe(Effect.catchTags({ PatientStoreError: failStore }));
        }),
      )
      .handle(
        "threadPatient",
        Effect.fn("med.patients.threadPatient")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const patient = yield* store
            .getThreadPatient(args.params.threadId)
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return { patient: Option.getOrNull(patient) };
        }),
      )
      .handle(
        "updatePatient",
        Effect.fn("med.patients.updatePatient")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          return yield* store.updatePatient(args.params.patientId, args.payload).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
              // The holder's name goes to the doctor in the answer; the error's message has none.
              PatientUrnTakenError: ({ patientId, patientName }) =>
                Effect.fail(new MedUrnTakenError({ patientId, patientName })),
              InvalidDateError: refuse,
              BlankFieldError: refuse,
              InvalidChoiceError: refuse,
              InvalidLabValueError: refuse,
            }),
          );
        }),
      )
      .handle(
        "correctLab",
        Effect.fn("med.patients.correctLab")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          return yield* store.correctLab({ ...args.payload, labId: args.params.labId }).pipe(
            Effect.map(labForPage),
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              RowOutOfReachError: dieOutOfReach,
              LabValueMismatchError: refuse,
              InvalidDateError: refuse,
              BlankFieldError: refuse,
              InvalidChoiceError: refuse,
              InvalidLabValueError: refuse,
            }),
          );
        }),
      )
      .handle(
        "undoLabCorrection",
        Effect.fn("med.patients.undoLabCorrection")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          return yield* store.undoLabCorrection(args.params.labId).pipe(
            Effect.map(labForPage),
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              NoLabCorrectionError: refuse,
            }),
          );
        }),
      )
      .handle(
        "setLabRemoved",
        Effect.fn("med.patients.setLabRemoved")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { removed } = args.payload;
          yield* store.setRemoved({ row: "lab", id: args.params.labId, removed }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              PlanNotFoundError: failMissingPlan,
              RowOutOfReachError: dieOutOfReach,
            }),
          );
          return { removed };
        }),
      )
      .handle(
        "setLabVerified",
        Effect.fn("med.patients.setLabVerified")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { verified } = args.payload;
          yield* store.setVerified({ row: "lab", id: args.params.labId, verified }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              PlanNotFoundError: failMissingPlan,
              NoteInInboxError: refuse,
            }),
          );
          return { verified };
        }),
      )
      .handle(
        "updatePlan",
        Effect.fn("med.patients.updatePlan")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          return yield* store.updatePlan({ ...args.payload, planId: args.params.planId }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PlanNotFoundError: failMissingPlan,
              RowOutOfReachError: dieOutOfReach,
              PlanNotDoneError: refuse,
              InvalidDateError: refuse,
              BlankFieldError: refuse,
              InvalidChoiceError: refuse,
            }),
          );
        }),
      )
      .handle(
        "setPlanRemoved",
        Effect.fn("med.patients.setPlanRemoved")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { removed } = args.payload;
          yield* store.setRemoved({ row: "plan", id: args.params.planId, removed }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              PlanNotFoundError: failMissingPlan,
              RowOutOfReachError: dieOutOfReach,
            }),
          );
          return { removed };
        }),
      )
      .handle(
        "setPlanVerified",
        Effect.fn("med.patients.setPlanVerified")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { verified } = args.payload;
          yield* store.setVerified({ row: "plan", id: args.params.planId, verified }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              PlanNotFoundError: failMissingPlan,
              NoteInInboxError: refuse,
            }),
          );
          return { verified };
        }),
      )
      .handle(
        "verifyNote",
        Effect.fn("med.patients.verifyNote")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          return yield* store.verifyNote(args.params.noteId).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              NoteNotFoundError: failMissingNote,
              NoteInInboxError: refuse,
            }),
          );
        }),
      )
      .handle(
        "moveNoteToInbox",
        Effect.fn("med.patients.moveNoteToInbox")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const note = yield* store.moveNoteToInbox({ noteId: args.params.noteId }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              NoteNotFoundError: failMissingNote,
              NoteAlreadyInInboxError: refuse,
            }),
          );
          return { noteId: note.id };
        }),
      );
  }),
);

const forbidStoring = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, "cache-control", "no-store")),
);

// Every route runs this middleware first, so a refusal carries the header as an answer does.
const layerAuth = Layer.effect(
  EnvironmentAuthenticatedAuth,
  Effect.gen(function* () {
    const authenticate = yield* EnvironmentAuthenticatedAuth;
    return (httpEffect, options) =>
      forbidStoring.pipe(Effect.andThen(authenticate(httpEffect, options)));
  }),
).pipe(Layer.provide(layerAuthenticatedAuth));

/**
 * The routes, signed in by the middleware that guards upstream's own HTTP API. No answer may
 * be kept by a cache: each one is patient data.
 */
export const layer = HttpApiBuilder.layer(MedHttpApi).pipe(
  Layer.provide(layerHandlers),
  Layer.provide(layerAuth),
);
