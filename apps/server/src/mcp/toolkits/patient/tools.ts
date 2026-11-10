import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as PatientStore from "../../../med/PatientStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** What `patient_file` takes as `patientId` to file to the Inbox. */
export const INBOX = "inbox";

const patientSummary = {
  patientId: Schema.String,
  name: Schema.String,
  urn: Schema.NullOr(Schema.String),
  status: Schema.Literals(["new", "active", "archived"]),
};
const PatientSummary = Schema.Struct(patientSummary);
const sex = Schema.Literals(["female", "male"]);
const Patient = Schema.Struct({
  ...patientSummary,
  sex: Schema.NullOr(sex),
  dateOfBirth: Schema.NullOr(Schema.String),
  diagnoses: Schema.String,
  alsoWrittenAs: Schema.Array(Schema.String),
});

const flag = Schema.Literals(["low", "normal", "high"]);
const Lab = Schema.Struct({
  testName: Schema.String,
  testId: Schema.NullOr(Schema.String),
  testAsWritten: Schema.String,
  value: Schema.NullOr(Schema.Number),
  valueText: Schema.String,
  unit: Schema.String,
  referenceRange: Schema.String,
  flag: Schema.NullOr(flag),
  collected: Schema.String,
  lab: Schema.String,
  status: Schema.Literals(["draft", "verified"]),
  isBaseline: Schema.Boolean,
  valueInBaselineUnit: Schema.NullOr(Schema.Number),
  changeFromBaseline: Schema.NullOr(Schema.Number),
  changePercent: Schema.NullOr(Schema.Number),
  noteId: Schema.String,
});

const planType = Schema.Literals(["follow_up", "lab", "imaging", "procedure", "other"]);
const plan = {
  title: Schema.String,
  due: Schema.String,
  type: planType,
  status: Schema.Literals(["draft", "planned", "done", "cancelled"]),
  noteId: Schema.String,
};
const Plan = Schema.Struct(plan);

const noteKind = Schema.Literals(["chat", "lab_sheet", "imaging_report", "clinical_note", "other"]);
const note = {
  noteId: Schema.String,
  patientId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
  title: Schema.String,
  date: Schema.String,
  kind: noteKind,
  summary: Schema.String,
  needsYou: Schema.String,
};
const noteFile = Schema.Struct({ name: Schema.String, path: Schema.String });
const WaitingNote = Schema.Struct({
  ...note,
  draftLabs: Schema.Number,
  draftPlans: Schema.Number,
});

const reading = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, PatientStore.PatientStore],
};
const writing = {
  ...reading,
  dependencies: [...reading.dependencies, ThreadManagementService.ThreadManagementService],
};

const PatientFindTool = Tool.make("patient_find", {
  ...reading,
  description:
    "Look a patient up before filing. A `urn` finds its patient as `match`, exactly; a `name` only lists `candidates`, which never decide whom a message is about.",
  parameters: Schema.Struct({
    urn: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    match: Schema.NullOr(PatientSummary),
    candidates: Schema.Array(PatientSummary),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const patientFields = {
  urn: Schema.optional(Schema.String),
  sex: Schema.optional(sex),
  dateOfBirth: Schema.optional(Schema.String),
  diagnoses: Schema.optional(Schema.String),
};

const PatientCreateTool = Tool.make("patient_create", {
  ...writing,
  description:
    "Create a patient, marked new, when a message gives a URN that `patient_find` did not match. A URN that belongs to a patient is refused, and the refusal names that patient.",
  parameters: Schema.Struct({ name: Schema.String, ...patientFields }),
  success: Patient,
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientUpdateTool = Tool.make("patient_update", {
  ...writing,
  description:
    "Correct a patient's details, or add another way the name is written with `addSpelling`.",
  parameters: Schema.Struct({
    patientId: Schema.String,
    name: Schema.optional(Schema.String),
    ...patientFields,
    addSpelling: Schema.optional(Schema.String),
  }),
  success: Patient,
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.OpenWorld, false);

const PatientFileTool = Tool.make("patient_file", {
  ...writing,
  description:
    "File what a message says about a patient, once per message and without asking first: this thread's note with its labs, plans and source files, all as drafts. `patientId` is a patient's id, or `inbox` when no URN matched, with the candidates in `needsYou`; `summary` and `needsYou` replace the note's, and each lab returns its change from baseline, so never calculate it.",
  parameters: Schema.Struct({
    patientId: Schema.String,
    title: Schema.String,
    summary: Schema.optional(Schema.String),
    needsYou: Schema.optional(Schema.String),
    kind: Schema.optional(noteKind),
    date: Schema.optional(Schema.String),
    labs: Schema.optional(
      Schema.Array(
        Schema.Struct({
          testAsWritten: Schema.String,
          value: Schema.optional(Schema.Finite),
          valueText: Schema.optional(Schema.String),
          unit: Schema.optional(Schema.String),
          referenceRange: Schema.optional(Schema.String),
          flag: Schema.optional(flag),
          collected: Schema.String,
          lab: Schema.optional(Schema.String),
        }),
      ),
    ),
    plans: Schema.optional(
      Schema.Array(Schema.Struct({ title: Schema.String, due: Schema.String, type: planType })),
    ),
    files: Schema.optional(Schema.Array(noteFile)),
  }),
  success: Schema.Struct({
    noteId: Schema.String,
    patientId: Schema.NullOr(Schema.String),
    labs: Schema.Array(Lab),
    plans: Schema.Array(Plan),
  }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientRecordTool = Tool.make("patient_record", {
  ...reading,
  description:
    "Read what is filed for a patient: details, labs oldest first, plans and notes. `test`, a test name or Test ID, keeps one test's labs.",
  parameters: Schema.Struct({ patientId: Schema.String, test: Schema.optional(Schema.String) }),
  success: Schema.Struct({
    patient: Patient,
    labs: Schema.Array(Lab),
    plans: Schema.Array(Plan),
    notes: Schema.Array(Schema.Struct({ ...note, files: Schema.Array(noteFile) })),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientReviewTool = Tool.make("patient_review", {
  ...reading,
  description:
    "List what waits for the doctor: Inbox notes, notes with `needsYou`, and each patient's draft labs and plans.",
  success: Schema.Struct({
    inbox: Schema.Array(WaitingNote),
    patients: Schema.Array(
      Schema.Struct({
        ...patientSummary,
        draftLabs: Schema.Number,
        draftPlans: Schema.Number,
        notes: Schema.Array(WaitingNote),
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientUpcomingTool = Tool.make("patient_upcoming", {
  ...reading,
  description:
    "List plans not yet done, soonest due first, with each patient's name, optionally only those due between `from` and `to`.",
  parameters: Schema.Struct({
    from: Schema.optional(Schema.String),
    to: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    plans: Schema.Array(
      Schema.Struct({
        ...plan,
        patientId: Schema.NullOr(Schema.String),
        patientName: Schema.NullOr(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientVerifyTool = Tool.make("patient_verify", {
  ...writing,
  description:
    "Mark a note's drafts as verified, only after the doctor says what was filed is correct. Give `patientId` for this thread's note for that patient, or a `noteId`.",
  parameters: Schema.Struct({
    patientId: Schema.optional(Schema.String),
    noteId: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    labsVerified: Schema.Number,
    plansPlanned: Schema.Number,
    patientActivated: Schema.Boolean,
  }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.OpenWorld, false);

const PatientMoveNoteTool = Tool.make("patient_move_note", {
  ...writing,
  description:
    "Give an Inbox note to a patient once the doctor says whose it is; its labs then get baselines and its thread is linked. Without `noteId` it moves this thread's Inbox note.",
  parameters: Schema.Struct({ patientId: Schema.String, noteId: Schema.optional(Schema.String) }),
  success: Schema.Struct({
    noteId: Schema.String,
    patientId: Schema.String,
    labs: Schema.Array(Lab),
  }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.OpenWorld, false);

export const PatientToolkit = Toolkit.make(
  PatientFindTool,
  PatientCreateTool,
  PatientUpdateTool,
  PatientFileTool,
  PatientRecordTool,
  PatientReviewTool,
  PatientUpcomingTool,
  PatientVerifyTool,
  PatientMoveNoteTool,
);
