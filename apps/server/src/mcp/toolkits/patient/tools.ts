import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as PatientStore from "../../../med/PatientStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** What `patient_file` takes as `patientId` to file to the Inbox. */
export const INBOX = "inbox";

const IsoDate = Schema.String.annotate({ description: "YYYY-MM-DD" });

const patientSummary = {
  patientId: Schema.String,
  name: Schema.String,
  urn: Schema.NullOr(Schema.String),
  status: Schema.Literals(["new", "active", "archived"]),
};
const PatientSummary = Schema.Struct(patientSummary);
const sex = Schema.Literals(["female", "male"]);
const patient = {
  ...patientSummary,
  sex: Schema.NullOr(sex),
  dateOfBirth: Schema.NullOr(Schema.String),
  diagnoses: Schema.String,
  alsoWrittenAs: Schema.Array(Schema.String),
};
/** The patient this thread was linked to before the call linked it to another one. */
const relinkedFrom = Schema.NullOr(
  Schema.Struct({ patientId: Schema.String, name: Schema.String }),
);

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
  baseline: Schema.NullOr(
    Schema.Struct({ value: Schema.Number, unit: Schema.String, collected: Schema.String }),
  ),
  valueInBaselineUnit: Schema.NullOr(Schema.Number),
  changeFromBaseline: Schema.NullOr(Schema.Number),
  changeUnit: Schema.NullOr(Schema.String),
  changePercent: Schema.NullOr(Schema.Number),
  notCompared: Schema.NullOr(
    Schema.Literals([
      "first_result",
      "in_inbox",
      "result_has_no_number",
      "result_has_no_unit",
      "baseline_has_no_unit",
      "no_verified_conversion",
    ]),
  ),
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
  ...writing,
  description:
    "Call this first when a message is about a patient, with the URN when the message gives one, or with no arguments to read only `linked`, the patient this thread is linked to. A `urn` that matches links this thread to that patient as `match`; a `name` only lists `candidates` for the doctor to choose from, and never links.",
  parameters: Schema.Struct({
    urn: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    match: Schema.NullOr(PatientSummary),
    candidates: Schema.Array(PatientSummary),
    relinkedFrom,
    linked: Schema.NullOr(PatientSummary),
  }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const patientFields = {
  sex: Schema.optional(sex),
  dateOfBirth: Schema.optional(IsoDate),
  diagnoses: Schema.optional(Schema.String),
};

const PatientCreateTool = Tool.make("patient_create", {
  ...writing,
  description:
    "Call this when a message gives a URN that `patient_find` did not match. It creates the patient, marked new, and links this thread to them.",
  parameters: Schema.Struct({ name: Schema.String, urn: Schema.String, ...patientFields }),
  success: Schema.Struct({ ...patient, relinkedFrom }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientUpdateTool = Tool.make("patient_update", {
  ...writing,
  description:
    "Call this when the doctor corrects a patient's details, or when a message writes the patient's name another way (`addSpelling`).",
  parameters: Schema.Struct({
    patientId: Schema.String,
    name: Schema.optional(Schema.String),
    urn: Schema.optional(Schema.String),
    ...patientFields,
    addSpelling: Schema.optional(Schema.String),
  }),
  success: Schema.Struct(patient),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.OpenWorld, false);

const PatientFileTool = Tool.make("patient_file", {
  ...writing,
  description:
    "Call this once for each message that carries patient data, without asking first, to file its labs, plans and source files as drafts on this thread's note. A retry files nothing twice.",
  parameters: Schema.Struct({
    patientId: Schema.String.annotate({
      description: "The patient this thread is linked to, or `inbox` when no URN matched.",
    }),
    title: Schema.optional(
      Schema.String.annotate({ description: "Needed for the thread's first filing." }),
    ),
    summary: Schema.optional(
      Schema.String.annotate({ description: "Replaces the note's summary." }),
    ),
    needsYou: Schema.optional(
      Schema.String.annotate({
        description:
          "A question for the doctor, added to those the note has; for the Inbox, the candidates.",
      }),
    ),
    clearNeedsYou: Schema.optional(
      Schema.Boolean.annotate({ description: "True once the doctor has answered." }),
    ),
    kind: Schema.optional(noteKind),
    date: Schema.optional(IsoDate),
    labs: Schema.optional(
      Schema.Array(
        Schema.Struct({
          testAsWritten: Schema.String,
          value: Schema.optional(Schema.Finite),
          valueText: Schema.optional(Schema.String),
          unit: Schema.optional(Schema.String),
          referenceRange: Schema.optional(Schema.String),
          flag: Schema.optional(flag),
          collected: IsoDate,
          lab: Schema.optional(Schema.String),
        }),
      ).annotate({
        description:
          "Results as the sheet writes them. The reply gives each one's change from baseline; never calculate it.",
      }),
    ),
    plans: Schema.optional(
      Schema.Array(Schema.Struct({ title: Schema.String, due: IsoDate, type: planType })),
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
    "Call this when the doctor asks what is filed for a patient: details, labs oldest first, plans and notes. Pass `test`, a test name or Test ID, for one test's labs only.",
  parameters: Schema.Struct({ patientId: Schema.String, test: Schema.optional(Schema.String) }),
  success: Schema.Struct({
    patient: Schema.Struct(patient),
    labs: Schema.Array(Lab),
    plans: Schema.Array(Plan),
    notes: Schema.Array(Schema.Struct({ ...note, files: Schema.Array(noteFile) })),
  }),
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientReviewTool = Tool.make("patient_review", {
  ...reading,
  description:
    "Call this when the doctor asks what is waiting for them: Inbox notes, notes with a question in `needsYou`, and each patient's unverified drafts.",
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
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientUpcomingTool = Tool.make("patient_upcoming", {
  ...reading,
  description:
    "Call this when the doctor asks what is planned or due: plans not yet done, soonest first, with each patient's name. Pass `from` and `to` for a period.",
  parameters: Schema.Struct({
    from: Schema.optional(IsoDate),
    to: Schema.optional(IsoDate),
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
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const PatientVerifyTool = Tool.make("patient_verify", {
  ...writing,
  description:
    "Call this only after the doctor says that what this thread filed is correct. It verifies the drafts on this thread's note for the patient the thread is linked to.",
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
    "Call this when the doctor says which patient this thread's Inbox note belongs to. It moves the note with its labs and plans to that patient, sets the labs' baselines, and links this thread to them.",
  parameters: Schema.Struct({ patientId: Schema.String }),
  success: Schema.Struct({
    noteId: Schema.String,
    patientId: Schema.String,
    labs: Schema.Array(Lab),
    relinkedFrom,
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
