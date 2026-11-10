import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as PatientStore from "../../../med/PatientStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { INBOX, PatientToolkit } from "./tools.ts";

// A refusal says what the agent must change, so its text goes through; a store failure says
// only the step it failed in.
const refused = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: error._tag === "PatientStoreError" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const urnTaken = Effect.fn("mcp.patient.urnTaken")(function* (
  error: PatientStore.PatientUrnTakenError,
) {
  const store = yield* PatientStore.PatientStore;
  const holder = yield* store.getPatient(error.patientId).pipe(Effect.mapError(refused));
  return yield* new OrchestratorMcpFailure({
    code: "invalid_request",
    message: `URN ${holder.urn} belongs to patient ${holder.id} (${holder.name}, ${holder.status}). Nothing was changed; use that patient.`,
  });
});

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
  valueInBaselineUnit: lab.valueInBaselineUnit,
  changeFromBaseline: lab.changeFromBaseline,
  changePercent: lab.changePercent,
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

const handlers = {
  patient_find: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { match, candidates } = yield* store.findPatient(input).pipe(Effect.mapError(refused));
      return {
        match: Option.getOrNull(Option.map(match, patientSummary)),
        candidates: candidates.map(patientSummary),
      };
    }),
  ),
  patient_create: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      return yield* store
        .createPatient(input)
        .pipe(
          Effect.map(patientDetails),
          Effect.catchTags({ PatientUrnTakenError: urnTaken }),
          Effect.mapError(refused),
        );
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
  patient_verify: McpToolAccess.actsAsCaller(({ patientId, noteId }) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      if (noteId !== undefined) {
        return yield* store.verifyNote(noteId).pipe(Effect.mapError(refused));
      }
      if (patientId === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass `patientId` for this thread's note, or `noteId`.",
        });
      }
      return yield* store
        .verifyThreadNote({ threadId: yield* callingThread, patientId })
        .pipe(Effect.mapError(refused));
    }),
  ),
  patient_move_note: McpToolAccess.actsAsCaller(({ patientId, noteId }) =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const note = yield* (
        noteId === undefined
          ? store.moveThreadNoteToPatient({ threadId: yield* callingThread, patientId })
          : store.moveNoteToPatient({ noteId, patientId })
      ).pipe(Effect.mapError(refused));
      const labs = yield* store
        .listLabs({ patientId, sourceNoteId: note.id })
        .pipe(Effect.mapError(refused));
      return { noteId: note.id, patientId, labs: labs.map(labResult) };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PatientToolkit.tools>;

export const layer = McpToolAccess.toLayer(PatientToolkit, handlers);
