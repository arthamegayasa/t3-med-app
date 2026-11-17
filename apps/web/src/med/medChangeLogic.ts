/**
 * T3 Med: what the doctor's controls send. Each form is compared with the row it edits, so a
 * change carries only what changed and an unchanged form sends nothing.
 */
import {
  type MedDraftLab,
  type MedDraftPlan,
  type MedLab,
  type MedLabCorrection,
  type MedLabRevision,
  type MedPatientDetails,
  type MedPatientEdit,
  type MedNoteRows,
  type MedPlan,
  type MedPlanChange,
  type MedWaitingNote,
  writtenNumberReadings,
} from "@t3tools/contracts/med";

import { formatDay } from "./medLogic";

/** What a form sends: a change, nothing when it changed nothing, or why it cannot be sent. */
export type FormOutcome<Change> =
  | { readonly change: Change | null; readonly problem?: never }
  | { readonly problem: string; readonly change?: never };

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

export type LabAction = "verify" | "unverify" | "correct" | "undo-correction" | "remove";

export function labActions(lab: Pick<MedLab, "status" | "revisions">): ReadonlyArray<LabAction> {
  const undo: ReadonlyArray<LabAction> = lab.revisions.length === 0 ? [] : ["undo-correction"];
  return lab.status === "draft"
    ? ["verify", "correct", ...undo, "remove"]
    : ["correct", ...undo, "unverify", "remove"];
}

export type PlanAction = "verify" | "unverify" | "done" | "cancel" | "reopen" | "change" | "remove";

export function planActions(plan: Pick<MedPlan, "status">): ReadonlyArray<PlanAction> {
  switch (plan.status) {
    case "draft":
      return ["verify", "done", "cancel", "change", "remove"];
    case "planned":
      return ["done", "cancel", "change", "unverify", "remove"];
    case "done":
    case "cancelled":
      return ["reopen", "change", "remove"];
  }
}

export interface LabForm {
  readonly testAsWritten: string;
  readonly valueText: string;
  /** The result as a number, for the chart and the change from baseline; empty when it is none. */
  readonly number: string;
  readonly unit: string;
  readonly referenceRange: string;
  readonly flag: "" | NonNullable<MedLab["flag"]>;
  readonly collected: string;
}

export function labFormOf(lab: MedLab): LabForm {
  return {
    testAsWritten: lab.testAsWritten,
    valueText: lab.valueText,
    number: lab.value === null ? "" : String(lab.value),
    unit: lab.unit,
    referenceRange: lab.referenceRange,
    flag: lab.flag ?? "",
    collected: lab.collected,
  };
}

/**
 * The form after the result as written was retyped. The number is what the text says when it
 * reads one way (`2,6`, `80`), and emptied when it reads two ways (`9.800`) or is no number
 * (`negative`): the number the text had before is never left beside a text that changed.
 */
export function followWritten(form: LabForm, valueText: string): LabForm {
  const readings = writtenNumberReadings(valueText);
  return { ...form, valueText, number: readings.length === 1 ? String(readings[0]) : "" };
}

export function labCorrectionOf(lab: MedLab, form: LabForm): FormOutcome<MedLabCorrection> {
  const testAsWritten = tidy(form.testAsWritten);
  if (testAsWritten === "") return { problem: "The test needs a name." };
  const typed = form.number.trim();
  const value = typed === "" ? null : Number(typed);
  if (value !== null && !Number.isFinite(value)) {
    return { problem: "Number must be a number, or empty for a result that is not one." };
  }
  const valueText = form.valueText.trim();
  if (valueText === "") return { problem: "Write the result as the sheet has it." };
  // The store's rule, said before it is sent: the two fields say one thing.
  const readings = writtenNumberReadings(valueText);
  if (value === null && readings.length > 0) {
    return {
      problem: `${valueText} reads as ${readings.join(" or ")}. Enter the number used for comparison.`,
    };
  }
  if (value !== null && !readings.includes(value)) {
    return {
      problem:
        readings.length === 0
          ? "The result as written is not a number, so leave the number used for comparison empty."
          : "The result as written and the number used for comparison do not agree.",
    };
  }
  if (form.collected === "") return { problem: "Choose the day the sample was collected." };
  const unit = form.unit.trim();
  const flag = form.flag === "" ? null : form.flag;
  const change: MedLabCorrection = {
    ...(testAsWritten === lab.testAsWritten ? {} : { testAsWritten }),
    // The number and the text say one thing, so the store takes them together.
    ...(value === lab.value && valueText === lab.valueText ? {} : { value, valueText }),
    ...(unit === lab.unit ? {} : { unit }),
    ...(form.referenceRange === lab.referenceRange ? {} : { referenceRange: form.referenceRange }),
    ...(flag === lab.flag ? {} : { flag }),
    ...(form.collected === lab.collected ? {} : { collected: form.collected }),
  };
  return { change: Object.keys(change).length === 0 ? null : change };
}

/**
 * What a correction replaced, as short phrases after "Was": the values that differ from what
 * came after them, which is the next correction or the result as it now stands.
 */
export function revisionChanges(
  after: Pick<
    MedLabRevision,
    "testAsWritten" | "valueText" | "unit" | "referenceRange" | "flag" | "collected"
  >,
  before: MedLabRevision,
  today: string,
): ReadonlyArray<string> {
  return [
    ...(before.testAsWritten === after.testAsWritten ? [] : [`test ${before.testAsWritten}`]),
    ...(before.valueText === after.valueText && before.unit === after.unit
      ? []
      : [before.unit === "" ? before.valueText : `${before.valueText} ${before.unit}`]),
    ...(before.referenceRange === after.referenceRange
      ? []
      : [before.referenceRange === "" ? "no reference" : `reference ${before.referenceRange}`]),
    ...(before.flag === after.flag
      ? []
      : [before.flag === null ? "no flag" : `flag ${before.flag}`]),
    ...(before.collected === after.collected
      ? []
      : [`collected ${formatDay(before.collected, today)}`]),
  ];
}

/** Who made a correction and when, after what it replaced: `corrected by agent, 17 Nov`. */
export function correctedLabel(
  revision: Pick<MedLabRevision, "correctedBy" | "replacedAt">,
  today: string,
): string {
  const day = formatDay(revision.replacedAt.slice(0, 10), today);
  if (revision.correctedBy === null) return `corrected ${day}`;
  return `corrected by ${revision.correctedBy === "agent" ? "agent" : "you"}, ${day}`;
}

/** A draft result as a list names it: test, result as written, unit and the day collected. */
export function draftLabLabel(lab: MedDraftLab, today: string): string {
  const result = lab.unit === "" ? lab.valueText : `${lab.valueText} ${lab.unit}`;
  return `${lab.testName} ${result}, ${formatDay(lab.collected, today)}`;
}

export function draftPlanLabel(plan: MedDraftPlan, today: string): string {
  return `${plan.title}, due ${formatDay(plan.due, today)}`;
}

/** The drafts of a note as the page shows them: verifying confirms these and no others. */
export function noteRowsOf(
  note: Pick<MedWaitingNote, "draftLabRows" | "draftPlanRows">,
): MedNoteRows {
  return {
    labIds: note.draftLabRows.map((lab) => lab.id),
    planIds: note.draftPlanRows.map((plan) => plan.id),
  };
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `2 results and 1 plan`, or null for none of either. */
export function rowsLabel(rows: MedNoteRows): string | null {
  const parts = [
    ...(rows.labIds.length === 0 ? [] : [counted(rows.labIds.length, "result")]),
    ...(rows.planIds.length === 0 ? [] : [counted(rows.planIds.length, "plan")]),
  ];
  return parts.length === 0 ? null : parts.join(" and ");
}

/** Whether a note still asks the doctor something: a question not yet marked as handled. */
export function questionWaits(note: Pick<MedWaitingNote, "needsYou" | "needsYouHandledAt">) {
  return note.needsYou.trim() !== "" && note.needsYouHandledAt === null;
}

export interface PlanForm {
  readonly title: string;
  readonly due: string;
  /** Shown and sent only for a plan that is done. */
  readonly doneOn: string;
}

export function planFormOf(plan: MedPlan): PlanForm {
  return { title: plan.title, due: plan.due, doneOn: plan.doneOn ?? "" };
}

export function planChangeOf(plan: MedPlan, form: PlanForm): FormOutcome<MedPlanChange> {
  const title = form.title.trim();
  if (title === "") return { problem: "The plan needs a title." };
  if (form.due === "") return { problem: "Choose a due date." };
  const change: MedPlanChange = {
    ...(title === plan.title ? {} : { title }),
    ...(form.due === plan.due ? {} : { due: form.due }),
    ...(plan.status !== "done" || form.doneOn === "" || form.doneOn === plan.doneOn
      ? {}
      : { doneOn: form.doneOn }),
  };
  return { change: Object.keys(change).length === 0 ? null : change };
}

export interface PatientForm {
  readonly name: string;
  readonly urn: string;
  readonly sex: "" | NonNullable<MedPatientDetails["sex"]>;
  readonly dateOfBirth: string;
  readonly diagnoses: string;
  /** One spelling on each line. */
  readonly alsoWrittenAs: string;
}

export function patientFormOf(patient: MedPatientDetails): PatientForm {
  return {
    name: patient.name,
    urn: patient.urn ?? "",
    sex: patient.sex ?? "",
    dateOfBirth: patient.dateOfBirth ?? "",
    diagnoses: patient.diagnoses,
    alsoWrittenAs: patient.alsoWrittenAs.join("\n"),
  };
}

export function patientEditOf(
  patient: MedPatientDetails,
  form: PatientForm,
): FormOutcome<MedPatientEdit> {
  const name = tidy(form.name);
  if (name === "") return { problem: "The patient needs a name." };
  const urn = form.urn.trim() === "" ? null : form.urn.trim();
  const sex = form.sex === "" ? null : form.sex;
  const dateOfBirth = form.dateOfBirth === "" ? null : form.dateOfBirth;
  const spellings = form.alsoWrittenAs
    .split("\n")
    .map(tidy)
    .filter((spelling) => spelling !== "");
  const change: MedPatientEdit = {
    ...(name === patient.name ? {} : { name }),
    ...(urn === patient.urn ? {} : { urn }),
    ...(sex === patient.sex ? {} : { sex }),
    ...(dateOfBirth === patient.dateOfBirth ? {} : { dateOfBirth }),
    ...(form.diagnoses === patient.diagnoses ? {} : { diagnoses: form.diagnoses }),
    ...(spellings.join("\n") === patient.alsoWrittenAs.join("\n")
      ? {}
      : { alsoWrittenAs: spellings }),
  };
  return { change: Object.keys(change).length === 0 ? null : change };
}

const spellingKey = (spelling: string) => tidy(spelling).toLowerCase();

/**
 * The edit that takes one back: what the patient had in every field the edit changed, and for
 * the spellings only the ones the edit put on or took off. The list is never sent whole, so a
 * spelling an agent added since the edit stays.
 */
export function patientUndoOf(
  before: MedPatientDetails,
  after: Pick<MedPatientDetails, "name" | "alsoWrittenAs">,
  edit: MedPatientEdit,
): MedPatientEdit {
  const had = new Set(before.alsoWrittenAs.map(spellingKey));
  const has = new Set(after.alsoWrittenAs.map(spellingKey));
  // A rename back makes the name it replaces a spelling, which the patient never had.
  const removeSpellings = [
    ...after.alsoWrittenAs,
    ...(spellingKey(after.name) === spellingKey(before.name) ? [] : [after.name]),
  ].filter((spelling) => !had.has(spellingKey(spelling)));
  const addSpellings = before.alsoWrittenAs.filter((spelling) => !has.has(spellingKey(spelling)));
  return {
    ...(edit.name === undefined ? {} : { name: before.name }),
    ...(edit.urn === undefined ? {} : { urn: before.urn }),
    ...(edit.sex === undefined ? {} : { sex: before.sex }),
    ...(edit.dateOfBirth === undefined ? {} : { dateOfBirth: before.dateOfBirth }),
    ...(edit.diagnoses === undefined ? {} : { diagnoses: before.diagnoses }),
    ...(removeSpellings.length === 0 ? {} : { removeSpellings }),
    ...(addSpellings.length === 0 ? {} : { addSpellings }),
  };
}
