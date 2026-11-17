/**
 * T3 Med: what the doctor's controls send. Each form is compared with the row it edits, so a
 * change carries only what changed and an unchanged form sends nothing.
 */
import type {
  MedLab,
  MedLabCorrection,
  MedLabRevision,
  MedPatientDetails,
  MedPatientEdit,
  MedPlan,
  MedPlanChange,
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

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * The form after the result as written was retyped. Digits with a decimal point are the
 * number too; any other text leaves the number for the doctor, because `2,6` and `1,234` do
 * not say which mark the comma is.
 */
export function followWritten(form: LabForm, valueText: string): LabForm {
  const written = valueText.trim();
  return { ...form, valueText, number: PLAIN_NUMBER.test(written) ? written : form.number };
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

/**
 * The edit that takes one back: what the patient had in every field the edit changed, and the
 * spellings always, because a rename adds the old name to them.
 */
export function patientUndoOf(patient: MedPatientDetails, edit: MedPatientEdit): MedPatientEdit {
  return {
    ...(edit.name === undefined ? {} : { name: patient.name }),
    ...(edit.urn === undefined ? {} : { urn: patient.urn }),
    ...(edit.sex === undefined ? {} : { sex: patient.sex }),
    ...(edit.dateOfBirth === undefined ? {} : { dateOfBirth: patient.dateOfBirth }),
    ...(edit.diagnoses === undefined ? {} : { diagnoses: patient.diagnoses }),
    ...(edit.status === undefined ? {} : { status: patient.status }),
    alsoWrittenAs: patient.alsoWrittenAs,
  };
}
