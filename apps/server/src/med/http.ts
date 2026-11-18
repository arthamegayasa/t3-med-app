/**
 * T3 Med: the routes the patient pages read and the doctor's changes go through. Each handler
 * checks the session's scopes, calls one `PatientStore` method and maps its failure; the
 * contract's schemas drop every store field the pages do not show. No handler passes a thread
 * id, and none links a thread to a patient.
 */
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  MedChangedSinceError,
  MedHttpApi,
  MedPatientNotFoundError,
  MedRefusedError,
  MedRowNotFoundError,
  MedUrnTakenError,
} from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as MedForwardedHost from "./forwardedHost.ts";
import { layerAuth } from "./httpAuth.ts";
import { testDisplayName } from "./labs.ts";
import * as PatientStore from "./PatientStore.ts";
import * as MedRemote from "./remote.ts";

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

const failChanged = (error: PatientStore.RowChangedError) =>
  Effect.fail(new MedChangedSinceError({ row: error.row, id: error.id }));

// No handler passes a thread, so no row is out of reach.
const dieOutOfReach = (error: PatientStore.RowOutOfReachError) => Effect.die(error);

const labForPage = <Row extends PatientStore.Lab>(lab: Row) => ({
  ...lab,
  testName: testDisplayName(lab.testId) ?? lab.testName,
  noteId: lab.sourceNoteId,
});

// A note's drafts are named by the test's display name, as the Labs surface names them.
const noteForPage = (note: PatientStore.WaitingNote) => ({
  ...note,
  draftLabRows: note.draftLabRows.map(labForPage),
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
          const home = yield* store.getPatientHome(args.params.patientId).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
            }),
          );
          return { ...home, notes: home.notes.map(noteForPage) };
        }),
      )
      .handle(
        "removed",
        Effect.fn("med.patients.removed")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const removed = yield* store.listRemoved(args.params.patientId).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
            }),
          );
          return { ...removed, labs: removed.labs.map(labForPage) };
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
          const waiting = yield* store
            .listNeedsYou()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return {
            inbox: waiting.inbox.map(noteForPage),
            patients: waiting.patients.map((entry) => ({
              ...entry,
              notes: entry.notes.map(noteForPage),
            })),
          };
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
        "threadPatients",
        Effect.fn("med.patients.threadPatients")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const links = yield* store
            .listThreadPatients()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return { links };
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
          const { revisionId } = args.payload;
          return yield* store.undoLabCorrection({ labId: args.params.labId, revisionId }).pipe(
            Effect.map(labForPage),
            Effect.catchTags({
              PatientStoreError: failStore,
              LabNotFoundError: failMissingLab,
              RowChangedError: failChanged,
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
          const stamp = yield* store
            .setLabRemoved({ ...args.payload, labId: args.params.labId })
            .pipe(
              Effect.catchTags({
                PatientStoreError: failStore,
                LabNotFoundError: failMissingLab,
                RowChangedError: failChanged,
                RowOutOfReachError: dieOutOfReach,
              }),
            );
          return { removed, ...stamp };
        }),
      )
      .handle(
        "setLabVerified",
        Effect.fn("med.patients.setLabVerified")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { verified } = args.payload;
          const stamp = yield* store
            .setLabVerified({ ...args.payload, labId: args.params.labId })
            .pipe(
              Effect.catchTags({
                PatientStoreError: failStore,
                LabNotFoundError: failMissingLab,
                RowChangedError: failChanged,
                NoteInInboxError: refuse,
              }),
            );
          return { verified, ...stamp };
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
              RowChangedError: failChanged,
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
          const stamp = yield* store
            .setPlanRemoved({ ...args.payload, planId: args.params.planId })
            .pipe(
              Effect.catchTags({
                PatientStoreError: failStore,
                PlanNotFoundError: failMissingPlan,
                RowChangedError: failChanged,
                RowOutOfReachError: dieOutOfReach,
              }),
            );
          return { removed, ...stamp };
        }),
      )
      .handle(
        "setPlanVerified",
        Effect.fn("med.patients.setPlanVerified")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { verified } = args.payload;
          const stamp = yield* store
            .setPlanVerified({ ...args.payload, planId: args.params.planId })
            .pipe(
              Effect.catchTags({
                PatientStoreError: failStore,
                PlanNotFoundError: failMissingPlan,
                RowChangedError: failChanged,
                NoteInInboxError: refuse,
              }),
            );
          return { verified, ...stamp };
        }),
      )
      .handle(
        "verifyNote",
        Effect.fn("med.patients.verifyNote")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          // Always the rows the page showed: a draft filed since is not among them.
          return yield* store.verifyNote(args.params.noteId, args.payload).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              NoteNotFoundError: failMissingNote,
              NoteInInboxError: refuse,
            }),
          );
        }),
      )
      .handle(
        "unverifyNote",
        Effect.fn("med.patients.unverifyNote")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          yield* store.returnNoteRowsToDraft(args.params.noteId, args.payload).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              NoteNotFoundError: failMissingNote,
            }),
          );
          return args.payload;
        }),
      )
      .handle(
        "setQuestionHandled",
        Effect.fn("med.patients.setQuestionHandled")(function* (args) {
          yield* requireChangeScopes(args.endpoint.name);
          const { handled } = args.payload;
          yield* store.setQuestionHandled({ noteId: args.params.noteId, handled }).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              NoteNotFoundError: failMissingNote,
            }),
          );
          return { handled };
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

/**
 * The routes, signed in by the middleware that guards upstream's own HTTP API. No answer may
 * be kept by a cache: each one is patient data.
 */
export const layerPatients = HttpApiBuilder.layer(MedHttpApi).pipe(
  Layer.provide(layerHandlers),
  Layer.provide(layerAuth),
);

/**
 * What `server.ts` mounts: the patient routes and remote access under `/api/med`, and the
 * forwarded-host check, which guards every route of the server.
 */
export const layer = Layer.mergeAll(layerPatients, MedRemote.layer, MedForwardedHost.layer);
