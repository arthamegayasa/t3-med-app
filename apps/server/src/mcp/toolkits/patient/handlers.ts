import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

import * as PatientStore from "../../../med/PatientStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { INBOX, PatientToolkit } from "./tools.ts";

/**
 * `Toolkit.handle` writes a call's raw arguments on the current span, and so into the trace
 * file. Under this the current span is a copy that takes no attributes and has the same ids, so
 * the spans of the call still hang from the request's.
 */
export const withoutArgumentsOnSpan = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.matchEffect(Effect.currentSpan, {
    onFailure: () => effect,
    onSuccess: ({ spanId, traceId, sampled, annotations }) =>
      Effect.withParentSpan(effect, Tracer.externalSpan({ spanId, traceId, sampled, annotations })),
  });

// A refusal says what the agent must change, so its text goes through; a store failure says
// only the step it failed in.
const refused = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: error._tag === "PatientStoreError" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

// The holder's name is for the agent only: the error's own message would put it in the trace.
const urnTaken = ({ urn, patientId, patientName, status }: PatientStore.PatientUrnTakenError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "invalid_request",
      message: `URN ${urn} belongs to patient ${patientId} (${patientName}, ${status}). Nothing was changed; find that patient by this URN to file for them.`,
    }),
  );

const callingThread = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This tool")),
  Effect.map((scope) => scope.thread.threadId),
);

const patientSummary = (patient: PatientStore.Patient) => ({
  patientId: patient.id,
  name: patient.name,
  urn: patient.urn,
  status: patient.status,
});

const patientDetails = (patient: PatientStore.Patient) => ({
  ...patientSummary(patient),
  sex: patient.sex,
  dateOfBirth: patient.dateOfBirth,
  diagnoses: patient.diagnoses,
  alsoWrittenAs: patient.alsoWrittenAs,
});

const relinkedFrom = (previous: Option.Option<PatientStore.Patient>) =>
  Option.getOrNull(Option.map(previous, ({ id, name }) => ({ patientId: id, name })));

const labResult = (lab: PatientStore.Lab) => ({
  testName: lab.testName,
  testId: lab.testId,
  testAsWritten: lab.testAsWritten,
  value: lab.value,
  valueText: lab.valueText,
  unit: lab.unit,
  referenceRange: lab.referenceRange,
  flag: lab.flag,
  collected: lab.collected,
  lab: lab.lab,
  status: lab.status,
  isBaseline: lab.isBaseline,
  baseline: lab.baseline,
  valueInBaselineUnit: lab.valueInBaselineUnit,
  changeFromBaseline: lab.changeFromBaseline,
  changeUnit: lab.changeUnit,
  changePercent: lab.changePercent,
  notCompared: lab.notCompared,
  noteId: lab.sourceNoteId,
});

const planResult = (plan: PatientStore.Plan) => ({
  title: plan.title,
  due: plan.due,
  type: plan.type,
  status: plan.status,
  noteId: plan.sourceNoteId,
});

const noteResult = (note: PatientStore.Note) => ({
  noteId: note.id,
  patientId: note.patientId,
  threadId: note.threadId,
  title: note.title,
  date: note.date,
  kind: note.kind,
  summary: note.summary,
  needsYou: note.needsYou,
});

const waitingNote = (note: PatientStore.WaitingNote) => ({
  ...noteResult(note),
  draftLabs: note.draftLabs,
  draftPlans: note.draftPlans,
});

// Each handler makes one store call: a thread is linked, and a message filed, in one transaction.
const handlers = {
  patient_find: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const found = yield* store
        .findPatientFromThread({ ...input, threadId: yield* callingThread })
        .pipe(Effect.mapError(refused));
      return {
        match: Option.getOrNull(Option.map(found.match, patientSummary)),
        candidates: found.candidates.map(patientSummary),
        relinkedFrom: relinkedFrom(found.relinkedFrom),
      };
    }),
  ),
  patient_create: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const created = yield* store
        .createPatientFromThread({ ...input, threadId: yield* callingThread })
        .pipe(Effect.catchTags({ PatientUrnTakenError: urnTaken }), Effect.mapError(refused));
      return {
        ...patientDetails(created.patient),
        relinkedFrom: relinkedFrom(created.relinkedFrom),
      };
    }),
  ),
  patient_update: McpToolAccess.actsAsCaller(({ patientId, ...fields }) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      return yield* store
        .updatePatient(patientId, fields)
        .pipe(
          Effect.map(patientDetails),
          Effect.catchTags({ PatientUrnTakenError: urnTaken }),
          Effect.mapError(refused),
        );
    }),
  ),
  patient_file: McpToolAccess.actsAsCaller(({ patientId, labs, ...message }) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const filed = yield* store
        .fileFromThread({
          ...message,
          threadId: yield* callingThread,
          patientId: patientId === INBOX ? null : patientId,
          labs: labs?.map((lab) => ({ ...lab, value: lab.value ?? null })),
        })
        .pipe(Effect.mapError(refused));
      return {
        noteId: filed.note.id,
        patientId: filed.note.patientId,
        labs: filed.labs.map(labResult),
        plans: filed.plans.map(planResult),
      };
    }),
  ),
  patient_record: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const record = yield* store.getPatientRecord(input).pipe(Effect.mapError(refused));
      return {
        patient: patientDetails(record.patient),
        labs: record.labs.map(labResult),
        plans: record.plans.map(planResult),
        notes: record.notes.map((note) => ({
          ...noteResult(note),
          files: note.files.map(({ name, path }) => ({ name, path })),
        })),
      };
    }),
  ),
  patient_review: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const waiting = yield* store.listNeedsYou().pipe(Effect.mapError(refused));
      return {
        inbox: waiting.inbox.map(waitingNote),
        patients: waiting.patients.map(({ patient, draftLabs, draftPlans, notes }) => ({
          ...patientSummary(patient),
          draftLabs,
          draftPlans,
          notes: notes.map(waitingNote),
        })),
      };
    }),
  ),
  patient_upcoming: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const plans = yield* store.listUpcomingPlans(input).pipe(Effect.mapError(refused));
      return {
        plans: plans.map((plan) => ({
          ...planResult(plan),
          patientId: plan.patientId,
          patientName: plan.patientName,
        })),
      };
    }),
  ),
  patient_verify: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      return yield* store
        .verifyThreadNote({ threadId: yield* callingThread })
        .pipe(Effect.mapError(refused));
    }),
  ),
  patient_move_note: McpToolAccess.actsAsCaller(({ patientId }) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const moved = yield* store
        .moveThreadNoteToPatient({ threadId: yield* callingThread, patientId })
        .pipe(Effect.mapError(refused));
      return {
        noteId: moved.note.id,
        patientId,
        labs: moved.labs.map(labResult),
        relinkedFrom: relinkedFrom(moved.relinkedFrom),
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PatientToolkit.tools>;

export const layer = McpToolAccess.toLayer(PatientToolkit, handlers);
