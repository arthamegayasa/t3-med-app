/**
 * T3 Med: patients and what agents file for them. Every row an agent writes is a draft until the doctor
 * verifies it, and a note with no patient sits in the Inbox.
 */
import { urnKey, writtenNumberReadings } from "@t3tools/contracts/med";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/sql/SqlError";
import type { Fragment } from "effect/sql/Statement";

import { compareToBaseline, normaliseUnit, resolveTest } from "./labs.ts";
import * as MedDatabase from "./MedDatabase.ts";

const PATIENT_STATUSES = ["new", "active", "archived"] as const;
const PATIENT_SEXES = ["female", "male"] as const;
const LAB_FLAGS = ["low", "normal", "high"] as const;
const PLAN_TYPES = ["follow_up", "lab", "imaging", "procedure", "other"] as const;
const NOTE_KINDS = ["chat", "lab_sheet", "imaging_report", "clinical_note", "other"] as const;
/** What `updatePlan` can do to a plan's status; `open` reopens one that is done or cancelled. */
const PLAN_MOVES = ["done", "cancelled", "open"] as const;

export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export type PatientSex = (typeof PATIENT_SEXES)[number];
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Patient {
  readonly id: string;
  readonly name: string;
  readonly urn: string | null;
  readonly urnKey: string | null;
  readonly status: PatientStatus;
  readonly sex: PatientSex | null;
  readonly dateOfBirth: string | null;
  readonly diagnoses: string;
  readonly alsoWrittenAs: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The latest change to a note of the patient, to what it files, or to a thread's link to the
   * patient. Null when the patient has neither a note nor a linked thread.
   */
  readonly lastChatAt: string | null;
  /** `lastChatAt`, else the creation time: what the directory is ordered by. */
  readonly lastActivityAt: string;
}

/** A thread linked to a patient, and when it was last linked to them. */
export interface LinkedThread {
  readonly threadId: string;
  readonly linkedAt: string;
}

export interface Note {
  readonly id: string;
  /** Null while the note is in the Inbox. */
  readonly patientId: string | null;
  readonly threadId: string | null;
  readonly title: string;
  readonly date: string;
  readonly kind: NoteKind;
  readonly summary: string;
  /** Empty when nothing waits for the doctor. */
  readonly needsYou: string;
  readonly localFile: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LabTest {
  readonly id: string;
  readonly name: string;
  /** The Test ID that `resolveTest` gives, or null for a test it does not know. */
  readonly testId: string | null;
  readonly category: string;
  readonly alsoWrittenAs: ReadonlyArray<string>;
}

export type LabFlag = (typeof LAB_FLAGS)[number];

/** Why a result has no change from baseline. `first_result` is the baseline itself. */
export type NotComparedReason =
  | "first_result"
  | "in_inbox"
  | "result_has_no_number"
  | "result_has_no_unit"
  | "baseline_has_no_unit"
  | "no_verified_conversion";

/** What a result said before a correction replaced it. */
export interface LabRevision {
  readonly testAsWritten: string;
  readonly value: number | null;
  readonly valueText: string;
  readonly unit: string;
  readonly referenceRange: string;
  readonly flag: LabFlag | null;
  readonly collected: string;
  readonly status: "draft" | "verified";
  readonly replacedAt: string;
}

export interface Lab {
  readonly id: string;
  readonly patientId: string | null;
  readonly labTestId: string;
  readonly testId: string | null;
  readonly testName: string;
  readonly testAsWritten: string;
  /** Null when the result is not a number; `valueText` then holds what the sheet says. */
  readonly value: number | null;
  readonly valueText: string;
  readonly unit: string;
  readonly referenceRange: string;
  readonly flag: LabFlag | null;
  readonly collected: string;
  readonly status: "draft" | "verified";
  readonly isBaseline: boolean;
  readonly valueInBaselineUnit: number | null;
  readonly changeFromBaseline: number | null;
  readonly changePercent: number | null;
  /** The baseline result this one was compared with, as written; null when it was not compared. */
  readonly baseline: {
    readonly value: number;
    readonly unit: string;
    readonly collected: string;
  } | null;
  /** The unit `valueInBaselineUnit` and `changeFromBaseline` are in. */
  readonly changeUnit: string | null;
  readonly notCompared: NotComparedReason | null;
  readonly lab: string;
  readonly sourceNoteId: string;
  /** What it said before each correction, the latest first; empty when never corrected. */
  readonly revisions: ReadonlyArray<LabRevision>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LabResultInput {
  readonly testAsWritten: string;
  /** A finite number, or null for a result that is not one; `valueText` must then say what. */
  readonly value: number | null;
  /** The result as the sheet writes it, so no digit is lost; defaults to the number. */
  readonly valueText?: string | undefined;
  readonly unit?: string | undefined;
  readonly referenceRange?: string | undefined;
  readonly flag?: LabFlag | null | undefined;
  readonly collected: string;
  readonly lab?: string | undefined;
  /** Used only when this result adds its test to the catalogue. */
  readonly category?: string | undefined;
}

/** A source document of a note; `path` is where it lies on the doctor's disk. */
export interface NoteFile {
  readonly id: string;
  readonly noteId: string;
  readonly name: string;
  readonly path: string;
}

export interface NoteFileInput {
  readonly name: string;
  readonly path: string;
}

export type PlanType = (typeof PLAN_TYPES)[number];

export interface PlanInput {
  readonly title: string;
  readonly due: string;
  readonly type: PlanType;
}

/** The note of one thread for one patient, or for the Inbox when the patient is null. */
export interface ThreadNoteInput {
  readonly threadId: string;
  readonly patientId: string | null;
  /** A new note needs one; an existing note keeps its title when none is given. */
  readonly title?: string | undefined;
  /** Today when a new note gives none; an existing note keeps its date. */
  readonly date?: string | undefined;
  /** What the thread brought; `chat` when a new note gives none. */
  readonly kind?: NoteKind | undefined;
  readonly summary?: string | undefined;
  /** Added to what the note already asks, one line each; a line it has is not added again. */
  readonly needsYou?: string | undefined;
  /** Empties what the note asks before `needsYou` is added. */
  readonly clearNeedsYou?: boolean | undefined;
}

export interface Plan {
  readonly id: string;
  readonly patientId: string | null;
  readonly title: string;
  readonly due: string;
  readonly type: PlanType;
  readonly status: "draft" | "planned" | "done" | "cancelled";
  /** The day a done plan was done; null for every other status. */
  readonly doneOn: string | null;
  readonly sourceNoteId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Verified {
  readonly labsVerified: number;
  readonly plansPlanned: number;
  readonly patientActivated: boolean;
}

/** A note with something for the doctor: no patient, a question, or drafts filed from it. */
export interface WaitingNote extends Note {
  readonly draftLabs: number;
  readonly draftPlans: number;
}

export interface UpcomingPlan extends Plan {
  /** Null for a plan still in the Inbox. */
  readonly patientName: string | null;
  /** Tells two patients of one name apart. */
  readonly patientUrn: string | null;
}

/** Whose rows a list returns: one patient's, or those still in the Inbox. Never everyone's. */
export type RowOwner =
  | { readonly patientId: string; readonly inbox?: never }
  | { readonly inbox: true; readonly patientId?: never };

export class PatientStoreError extends Schema.TaggedError<PatientStoreError>()(
  "PatientStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The patient store failed in ${this.operation}.`;
  }
}

export class PatientNotFoundError extends Schema.TaggedError<PatientNotFoundError>()(
  "PatientNotFoundError",
  { patientId: Schema.String },
) {
  override get message(): string {
    return `No patient has the id ${this.patientId}.`;
  }
}

/**
 * Names the patient who holds the URN. The message leaves the name and URN out, because a
 * failure's message is written to the trace file with the span it ended.
 */
export class PatientUrnTakenError extends Schema.TaggedError<PatientUrnTakenError>()(
  "PatientUrnTakenError",
  {
    patientId: Schema.String,
    patientName: Schema.String,
    status: Schema.Literals(PATIENT_STATUSES),
    urn: Schema.String,
  },
) {
  override get message(): string {
    return `Patient ${this.patientId} already has this URN.`;
  }
}

export class NoteNotFoundError extends Schema.TaggedError<NoteNotFoundError>()(
  "NoteNotFoundError",
  { noteId: Schema.String },
) {
  override get message(): string {
    return `No note has the id ${this.noteId}.`;
  }
}

export class ThreadNoteNotFoundError extends Schema.TaggedError<ThreadNoteNotFoundError>()(
  "ThreadNoteNotFoundError",
  { patientId: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    return this.patientId === null
      ? "This thread has no note in the Inbox."
      : `This thread has filed no note for patient ${this.patientId}.`;
  }
}

export class ThreadNotLinkedError extends Schema.TaggedError<ThreadNotLinkedError>()(
  "ThreadNotLinkedError",
  { patientId: Schema.String },
) {
  override get message(): string {
    return `This thread is not linked to patient ${this.patientId}; find the patient by URN, create them from a URN, or file to the Inbox.`;
  }
}

export class ThreadHasNoPatientError extends Schema.TaggedError<ThreadHasNoPatientError>()(
  "ThreadHasNoPatientError",
  { before: Schema.Literals(["verifying", "returning its note"]) },
) {
  override get message(): string {
    return `This thread is not linked to a patient; find the patient by URN, or move this thread's Inbox note to a patient, before ${this.before}.`;
  }
}

export class LabNotFoundError extends Schema.TaggedError<LabNotFoundError>()("LabNotFoundError", {
  labId: Schema.String,
}) {
  override get message(): string {
    return `No lab result has the id ${this.labId}.`;
  }
}

export class PlanNotFoundError extends Schema.TaggedError<PlanNotFoundError>()(
  "PlanNotFoundError",
  { planId: Schema.String },
) {
  override get message(): string {
    return `No plan has the id ${this.planId}.`;
  }
}

export class RowOutOfReachError extends Schema.TaggedError<RowOutOfReachError>()(
  "RowOutOfReachError",
  { row: Schema.Literals(["lab", "plan"]), id: Schema.String },
) {
  override get message(): string {
    return `This thread may change only what is filed for the patient it is linked to or from its own notes; ${this.row} ${this.id} is neither.`;
  }
}

export class NoLabCorrectionError extends Schema.TaggedError<NoLabCorrectionError>()(
  "NoLabCorrectionError",
  { labId: Schema.String },
) {
  override get message(): string {
    return `Lab result ${this.labId} has no correction to undo.`;
  }
}

export class PlanNotDoneError extends Schema.TaggedError<PlanNotDoneError>()("PlanNotDoneError", {
  planId: Schema.String,
}) {
  override get message(): string {
    return `doneOn is the day a plan was done; plan ${this.planId} is not done, so send it with status done.`;
  }
}

export class NoteAlreadyInInboxError extends Schema.TaggedError<NoteAlreadyInInboxError>()(
  "NoteAlreadyInInboxError",
  { noteId: Schema.String },
) {
  override get message(): string {
    return `Note ${this.noteId} is already in the Inbox.`;
  }
}

export class NotePatientMismatchError extends Schema.TaggedError<NotePatientMismatchError>()(
  "NotePatientMismatchError",
  { noteId: Schema.String },
) {
  override get message(): string {
    return `Note ${this.noteId} belongs to another patient or to the Inbox; rows filed from a note share its patient.`;
  }
}

export class NoteNotInInboxError extends Schema.TaggedError<NoteNotInInboxError>()(
  "NoteNotInInboxError",
  { noteId: Schema.String },
) {
  override get message(): string {
    return `Note ${this.noteId} already belongs to a patient.`;
  }
}

export class NoteInInboxError extends Schema.TaggedError<NoteInInboxError>()("NoteInInboxError", {
  noteId: Schema.String,
}) {
  override get message(): string {
    return `Note ${this.noteId} is in the Inbox; move it to a patient before verifying it.`;
  }
}

export class InvalidDateError extends Schema.TaggedError<InvalidDateError>()("InvalidDateError", {
  field: Schema.String,
}) {
  override get message(): string {
    return `${this.field} must be a calendar date written as YYYY-MM-DD.`;
  }
}

export class DateRangeError extends Schema.TaggedError<DateRangeError>()("DateRangeError", {}) {
  override get message(): string {
    return "from must not be later than to.";
  }
}

export class BlankFieldError extends Schema.TaggedError<BlankFieldError>()("BlankFieldError", {
  field: Schema.String,
}) {
  override get message(): string {
    return `${this.field} must not be blank.`;
  }
}

export class InvalidChoiceError extends Schema.TaggedError<InvalidChoiceError>()(
  "InvalidChoiceError",
  { field: Schema.String, allowed: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `${this.field} must be one of: ${this.allowed.join(", ")}.`;
  }
}

export class InvalidLabValueError extends Schema.TaggedError<InvalidLabValueError>()(
  "InvalidLabValueError",
  { field: Schema.String },
) {
  override get message(): string {
    return `${this.field} must be a finite number, or null with the result as written in valueText.`;
  }
}

/** The message names the fields and never what was sent: it is written to the trace. */
export class LabValueMismatchError extends Schema.TaggedError<LabValueMismatchError>()(
  "LabValueMismatchError",
  { reason: Schema.Literals(["text_is_a_number", "text_is_not_the_number"]) },
) {
  override get message(): string {
    return this.reason === "text_is_a_number"
      ? "valueText reads as a number, so send that number in value with it: value and valueText change together."
      : "value and valueText must say one thing: valueText has to read as value in Indonesian or English notation (2,6 or 2.6), and value has to be null for a result that is not a number.";
  }
}

type InputError = InvalidDateError | BlankFieldError | InvalidChoiceError | InvalidLabValueError;

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

const spellingKey = (spelling: string) => tidy(spelling).toLowerCase();

const splitSpellings = (text: string) => text.split("\n").filter((spelling) => spelling !== "");

const addSpelling = (spellings: ReadonlyArray<string>, name: string, spelling: string) => {
  const written = tidy(spelling);
  const known = new Set([name, ...spellings].map(spellingKey));
  return written === "" || known.has(spellingKey(written)) ? spellings : [...spellings, written];
};

// A patient's new name is never also one of its spellings, and the old name is kept as one.
const spellingsAfterRename = (patient: Patient, name: string) =>
  addSpelling(
    patient.alsoWrittenAs.filter((spelling) => spellingKey(spelling) !== spellingKey(name)),
    name,
    patient.name,
  );

const joinText = (kept: string, added: string) =>
  [kept, added].filter((text) => text.trim() !== "").join("\n\n");

// What a note asks the doctor is a list of lines, so a retried filing asks nothing twice.
const addLines = (kept: string, added: string) => {
  const known = new Set(kept.split("\n").map((line) => line.trim()));
  const fresh = [...new Set(added.split("\n").map((line) => line.trim()))].filter(
    (line) => line !== "" && !known.has(line),
  );
  return [kept, ...fresh].filter((text) => text.trim() !== "").join("\n");
};

// Round-tripping rejects dates the calendar does not have, such as 2026-02-30.
const isIsoDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Option.exists(
    DateTime.make(`${date}T00:00:00.000Z`),
    (parsed) => DateTime.formatIsoDateUtc(parsed) === date,
  );

// Inputs are checked before any transaction opens, so a refusal names its field instead of
// surfacing as a failed constraint. The checks do not trust the static types: agents call these.
const requireIsoDate = (field: string, date: string) =>
  isIsoDate(date) ? Effect.void : Effect.fail(new InvalidDateError({ field }));

const requireText = (field: string, text: string) =>
  typeof text === "string" && text.trim() !== ""
    ? Effect.void
    : Effect.fail(new BlankFieldError({ field }));

const requireChoice = (field: string, value: string, allowed: ReadonlyArray<string>) =>
  allowed.includes(value) ? Effect.void : Effect.fail(new InvalidChoiceError({ field, allowed }));

// Untraced: runs once per result of a batch, inside the span of `fileLabs`.
const checkLabResult = Effect.fnUntraced(function* (
  result: LabResultInput,
  /** What comes before a field's name in a refusal: `labs[1].`, or nothing for one result. */
  field: string,
) {
  yield* requireText(`${field}testAsWritten`, result.testAsWritten);
  yield* requireIsoDate(`${field}collected`, result.collected);
  const flag = result.flag ?? null;
  if (flag !== null) yield* requireChoice(`${field}flag`, flag, LAB_FLAGS);
  const { value } = result;
  const valueText = result.valueText ?? "";
  const written = valueText.trim() === "" ? null : valueText;
  // A result is a finite number or, when it is not a number, what the sheet says; never neither.
  if (value === null ? written === null : !Number.isFinite(value)) {
    return yield* new InvalidLabValueError({ field: `${field}value` });
  }
  return {
    test_as_written: tidy(result.testAsWritten),
    value,
    value_text: written ?? String(value),
    unit: result.unit?.trim() ?? "",
    reference_range: result.referenceRange ?? "",
    flag,
    collected: result.collected,
    lab: result.lab ?? "",
    category: result.category ?? "",
  };
});

type CheckedLabResult = Effect.Success<ReturnType<typeof checkLabResult>>;

const checkPlan = Effect.fnUntraced(function* (plan: PlanInput, index: number) {
  yield* requireText(`plans[${index}].title`, plan.title);
  yield* requireIsoDate(`plans[${index}].due`, plan.due);
  yield* requireChoice(`plans[${index}].type`, plan.type, PLAN_TYPES);
});

const checkNoteFile = Effect.fnUntraced(function* (file: NoteFileInput, index: number) {
  yield* requireText(`files[${index}].name`, file.name);
  yield* requireText(`files[${index}].path`, file.path);
});

const checkThreadNote = Effect.fnUntraced(function* (note: ThreadNoteInput) {
  if (note.title !== undefined) yield* requireText("title", note.title);
  if (note.date !== undefined) yield* requireIsoDate("date", note.date);
  if (note.kind !== undefined) yield* requireChoice("kind", note.kind, NOTE_KINDS);
});

interface PatientRow extends Omit<Patient, "alsoWrittenAs"> {
  readonly alsoWrittenAs: string;
}

const toPatient = (row: PatientRow): Patient => ({
  ...row,
  alsoWrittenAs: splitSpellings(row.alsoWrittenAs),
});

interface LabTestRow extends Omit<LabTest, "alsoWrittenAs"> {
  readonly alsoWrittenAs: string;
}

const toLabTest = (row: LabTestRow): LabTest => ({
  ...row,
  alsoWrittenAs: splitSpellings(row.alsoWrittenAs),
});

interface LabRow extends Omit<
  Lab,
  "isBaseline" | "baseline" | "changeUnit" | "notCompared" | "revisions"
> {
  readonly isBaseline: number;
  /** The patient's baseline row for the test, when that is another row than this one. */
  readonly baselineValue: number | null;
  readonly baselineUnit: string | null;
  readonly baselineCollected: string | null;
}

const hasNoUnit = (unit: string) => {
  const normalised = normaliseUnit(unit);
  return Result.isFailure(normalised) && normalised.failure._tag === "MissingUnitError";
};

// Read from what `recomputeBaseline` stored, in the order `compareToBaseline` refuses.
const toLab = (
  { baselineValue, baselineUnit, baselineCollected, ...row }: LabRow,
  revisions: ReadonlyArray<LabRevision>,
): Lab => {
  const baseline =
    row.valueInBaselineUnit === null ||
    baselineValue === null ||
    baselineUnit === null ||
    baselineCollected === null
      ? null
      : { value: baselineValue, unit: baselineUnit, collected: baselineCollected };
  const notCompared: NotComparedReason | null =
    baseline !== null
      ? null
      : row.patientId === null
        ? "in_inbox"
        : row.isBaseline === 1
          ? "first_result"
          : row.value === null
            ? "result_has_no_number"
            : hasNoUnit(row.unit)
              ? "result_has_no_unit"
              : baselineUnit !== null && hasNoUnit(baselineUnit)
                ? "baseline_has_no_unit"
                : "no_verified_conversion";
  return {
    ...row,
    isBaseline: row.isBaseline === 1,
    baseline,
    changeUnit:
      baseline === null
        ? null
        : Result.getOrElse(normaliseUnit(baseline.unit), () => baseline.unit),
    notCompared,
    revisions,
  };
};

/** The patient a thread was linked to before it was linked to another one. */
type RelinkedFrom = Option.Option<Patient>;

interface PatientInput {
  readonly name: string;
  readonly urn?: string | null | undefined;
  readonly sex?: PatientSex | null | undefined;
  readonly dateOfBirth?: string | null | undefined;
  readonly diagnoses?: string | undefined;
  readonly alsoWrittenAs?: ReadonlyArray<string> | undefined;
}

type FilingError =
  | PatientNotFoundError
  | NoteNotFoundError
  | NotePatientMismatchError
  | InputError
  | PatientStoreError;

export class PatientStore extends Context.Service<
  PatientStore,
  {
    /** Exact match on the URN key only; a name never finds a patient here. */
    readonly findPatientByUrn: (
      urn: string,
    ) => Effect.Effect<Option.Option<Patient>, PatientStoreError>;
    /**
     * The patient the URN names, if any. Without one, the patients a name could mean: candidates
     * for the doctor to choose from, never a match.
     */
    readonly findPatient: (query: {
      readonly urn?: string | undefined;
      readonly name?: string | undefined;
    }) => Effect.Effect<
      { readonly match: Option.Option<Patient>; readonly candidates: ReadonlyArray<Patient> },
      BlankFieldError | PatientStoreError
    >;
    /**
     * `findPatient` for an agent's thread. A URN that matches is evidence of whom the thread is
     * about, so it links the thread to that patient; a name never links. `linked` is the patient
     * the thread is linked to once the call is done; with no URN and no name it is all that is read.
     */
    readonly findPatientFromThread: (query: {
      readonly threadId: string;
      readonly urn?: string | undefined;
      readonly name?: string | undefined;
    }) => Effect.Effect<
      {
        readonly match: Option.Option<Patient>;
        readonly candidates: ReadonlyArray<Patient>;
        readonly relinkedFrom: RelinkedFrom;
        readonly linked: Option.Option<Patient>;
      },
      BlankFieldError | PatientStoreError
    >;
    readonly getPatient: (
      patientId: string,
    ) => Effect.Effect<Patient, PatientNotFoundError | PatientStoreError>;
    /**
     * All that is filed for one patient: labs oldest first, plans soonest first, notes latest
     * first. `test`, a name as written or a Test ID, keeps the labs of that test only.
     */
    readonly getPatientRecord: (input: {
      readonly patientId: string;
      readonly test?: string | undefined;
    }) => Effect.Effect<
      {
        readonly patient: Patient;
        readonly labs: ReadonlyArray<Lab>;
        readonly plans: ReadonlyArray<Plan>;
        readonly notes: ReadonlyArray<Note & { readonly files: ReadonlyArray<NoteFile> }>;
      },
      PatientNotFoundError | PatientStoreError
    >;
    /** Most recent activity first. */
    readonly listPatients: () => Effect.Effect<ReadonlyArray<Patient>, PatientStoreError>;
    /**
     * What the patient's page shows: notes latest first, every thread linked to the patient with
     * the latest link first, how many of the patient's labs and plans are still drafts, and the
     * draft and planned plans, soonest due first.
     */
    readonly getPatientHome: (patientId: string) => Effect.Effect<
      {
        readonly patient: Patient;
        readonly notes: ReadonlyArray<WaitingNote>;
        readonly threads: ReadonlyArray<LinkedThread>;
        readonly draftLabs: number;
        readonly draftPlans: number;
        readonly upcomingPlans: ReadonlyArray<Plan>;
      },
      PatientNotFoundError | PatientStoreError
    >;
    /** Case-insensitive substring over the name and its other spellings. */
    readonly searchPatients: (
      query: string,
    ) => Effect.Effect<ReadonlyArray<Patient>, PatientStoreError>;
    readonly createPatient: (
      input: PatientInput,
    ) => Effect.Effect<Patient, PatientUrnTakenError | InputError | PatientStoreError>;
    /**
     * `createPatient` for an agent's thread: a new URN is the evidence, so it is required, and
     * the thread is linked to the patient it creates.
     */
    readonly createPatientFromThread: (
      input: PatientInput & { readonly threadId: string; readonly urn: string },
    ) => Effect.Effect<
      { readonly patient: Patient; readonly relinkedFrom: RelinkedFrom },
      PatientUrnTakenError | InputError | PatientStoreError
    >;
    /** A new name keeps the old one as a spelling. */
    readonly updatePatient: (
      patientId: string,
      fields: {
        readonly name?: string | undefined;
        readonly urn?: string | null | undefined;
        readonly status?: PatientStatus | undefined;
        readonly sex?: PatientSex | null | undefined;
        readonly dateOfBirth?: string | null | undefined;
        readonly diagnoses?: string | undefined;
        /** Every other way the name is written: replaces the list, and what a rename would keep. */
        readonly alsoWrittenAs?: ReadonlyArray<string> | undefined;
        /** One more way the name is written, kept beside those already known. */
        readonly addSpelling?: string | undefined;
      },
    ) => Effect.Effect<
      Patient,
      PatientNotFoundError | PatientUrnTakenError | InputError | PatientStoreError
    >;
    readonly addPatientSpelling: (
      patientId: string,
      spelling: string,
    ) => Effect.Effect<Patient, PatientNotFoundError | PatientStoreError>;
    /** A thread has one note per patient and one more in the Inbox, whatever their kind. */
    readonly upsertThreadNote: (
      input: ThreadNoteInput,
    ) => Effect.Effect<Note, PatientNotFoundError | InputError | PatientStoreError>;
    /**
     * Files results as drafts of one note in one transaction and sets their baseline fields. The
     * baseline is the patient's earliest-collected numeric result for the test; Inbox results
     * have none. `patientId` must be the note's patient, or null for a note in the Inbox. A result
     * the note already has (same test, date, value, text and unit) is returned, not filed again.
     */
    readonly fileLabs: (input: {
      readonly patientId: string | null;
      readonly sourceNoteId: string;
      readonly results: ReadonlyArray<LabResultInput>;
    }) => Effect.Effect<ReadonlyArray<Lab>, FilingError>;
    /** Oldest collected first. */
    readonly listLabs: (
      filter: RowOwner & { readonly sourceNoteId?: string | undefined },
    ) => Effect.Effect<ReadonlyArray<Lab>, PatientStoreError>;
    readonly listLabTests: () => Effect.Effect<ReadonlyArray<LabTest>, PatientStoreError>;
    /** A plan the note already has, by title and due date, is returned, not filed again. */
    readonly filePlans: (input: {
      readonly patientId: string | null;
      readonly sourceNoteId: string;
      readonly plans: ReadonlyArray<PlanInput>;
    }) => Effect.Effect<ReadonlyArray<Plan>, FilingError>;
    /** Soonest due first. */
    readonly listPlans: (
      filter: RowOwner & { readonly sourceNoteId?: string | undefined },
    ) => Effect.Effect<ReadonlyArray<Plan>, PatientStoreError>;
    /**
     * Needs you: the notes in the Inbox, and per patient the notes with a question or with draft
     * labs or plans, each with its draft counts. Latest change first. Archived patients are left out.
     */
    readonly listNeedsYou: () => Effect.Effect<
      {
        readonly inbox: ReadonlyArray<WaitingNote>;
        readonly patients: ReadonlyArray<{
          readonly patient: Patient;
          readonly draftLabs: number;
          readonly draftPlans: number;
          readonly notes: ReadonlyArray<WaitingNote>;
        }>;
      },
      PatientStoreError
    >;
    /**
     * How long each list is: the Inbox, the patients not archived, the patients' notes in
     * `listNeedsYou` and `listUpcomingPlans`.
     */
    readonly getCounts: () => Effect.Effect<
      {
        readonly inbox: number;
        readonly patients: number;
        readonly needsYou: number;
        readonly upcoming: number;
      },
      PatientStoreError
    >;
    /**
     * Upcoming: draft and planned plans of every patient not archived and of the Inbox, soonest
     * due first, optionally only those due from `from` to `to`, both included.
     */
    readonly listUpcomingPlans: (range?: {
      readonly from?: string | undefined;
      readonly to?: string | undefined;
    }) => Effect.Effect<
      ReadonlyArray<UpcomingPlan>,
      InvalidDateError | DateRangeError | PatientStoreError
    >;
    /**
     * Gives the note, and the labs and plans filed from it, to a patient; the labs get baselines.
     * When the note's thread already has a note for that patient, the Inbox note is merged
     * into it and deleted, so the note returned can have another id than the one moved. The
     * note's thread is linked to the patient: the doctor's move decides whom the thread is about.
     */
    readonly moveNoteToPatient: (input: {
      readonly noteId: string;
      readonly patientId: string;
    }) => Effect.Effect<
      Note,
      NoteNotFoundError | NoteNotInInboxError | PatientNotFoundError | PatientStoreError
    >;
    /** `moveNoteToPatient` for a thread's own Inbox note, with the labs the note then has. */
    readonly moveThreadNoteToPatient: (input: {
      readonly threadId: string;
      readonly patientId: string;
    }) => Effect.Effect<
      {
        readonly note: Note;
        readonly labs: ReadonlyArray<Lab>;
        readonly relinkedFrom: RelinkedFrom;
      },
      | ThreadNoteNotFoundError
      | NoteNotFoundError
      | NoteNotInInboxError
      | PatientNotFoundError
      | PatientStoreError
    >;
    /** The doctor's confirmation: the note's draft labs and plans, and a new patient, become real. */
    readonly verifyNote: (
      noteId: string,
    ) => Effect.Effect<Verified, NoteNotFoundError | NoteInInboxError | PatientStoreError>;
    /** `verifyNote` for the note a thread has for the patient it is linked to, and no other. */
    readonly verifyThreadNote: (input: {
      readonly threadId: string;
    }) => Effect.Effect<
      Verified,
      | ThreadHasNoPatientError
      | ThreadNoteNotFoundError
      | NoteNotFoundError
      | NoteInInboxError
      | PatientStoreError
    >;
    /**
     * What an agent files for one message, in one transaction: the thread's note for the patient
     * (or its Inbox note), the results and plans as drafts of that note, and the note's files.
     * Filing to a patient needs the thread linked to exactly that patient, and never links it.
     */
    readonly fileFromThread: (
      input: ThreadNoteInput & {
        readonly labs?: ReadonlyArray<LabResultInput> | undefined;
        readonly plans?: ReadonlyArray<PlanInput> | undefined;
        readonly files?: ReadonlyArray<NoteFileInput> | undefined;
      },
    ) => Effect.Effect<
      {
        readonly note: Note;
        readonly labs: ReadonlyArray<Lab>;
        readonly plans: ReadonlyArray<Plan>;
        readonly files: ReadonlyArray<NoteFile>;
      },
      ThreadNotLinkedError | PatientNotFoundError | InputError | PatientStoreError
    >;
    /**
     * Changes what one filed result says. The row is a draft again, its earlier values are kept
     * as a revision, and the baselines of the test it had and the test it has are worked out
     * again. `value` and `valueText` are replaced together and must agree. A change of nothing
     * records nothing. With `threadId`, only a row of the thread's patient or of its own notes.
     */
    readonly correctLab: (input: {
      readonly labId: string;
      readonly threadId?: string | undefined;
      readonly testAsWritten?: string | undefined;
      readonly value?: number | null | undefined;
      readonly valueText?: string | undefined;
      readonly unit?: string | undefined;
      readonly referenceRange?: string | undefined;
      readonly flag?: LabFlag | null | undefined;
      readonly collected?: string | undefined;
    }) => Effect.Effect<
      Lab,
      LabNotFoundError | RowOutOfReachError | LabValueMismatchError | InputError | PatientStoreError
    >;
    /** Puts back what the latest correction replaced, its status included. */
    readonly undoLabCorrection: (
      labId: string,
    ) => Effect.Effect<Lab, LabNotFoundError | NoLabCorrectionError | PatientStoreError>;
    /**
     * Removes a lab or plan filed by mistake from every list, count, baseline and chart, or puts
     * it back. The row is kept, so nothing is lost. `threadId` limits it as in `correctLab`.
     */
    readonly setRemoved: (input: {
      readonly row: "lab" | "plan";
      readonly id: string;
      readonly removed: boolean;
      readonly threadId?: string | undefined;
    }) => Effect.Effect<
      void,
      LabNotFoundError | PlanNotFoundError | RowOutOfReachError | PatientStoreError
    >;
    /**
     * The doctor's confirmation of one draft result or plan, or its return to draft. A plan that
     * is done or cancelled is left as it is. No agent tool calls it.
     */
    readonly setVerified: (input: {
      readonly row: "lab" | "plan";
      readonly id: string;
      readonly verified: boolean;
    }) => Effect.Effect<
      void,
      LabNotFoundError | PlanNotFoundError | NoteInInboxError | PatientStoreError
    >;
    /**
     * Marks a plan done (on `doneOn`, else today) or cancelled, reopens it as what it was before,
     * or changes its title or due date. With `threadId`, limited as in `correctLab`, and a
     * confirmed plan whose title or due date changes is a draft again.
     */
    readonly updatePlan: (input: {
      readonly planId: string;
      readonly threadId?: string | undefined;
      readonly title?: string | undefined;
      readonly due?: string | undefined;
      readonly status?: (typeof PLAN_MOVES)[number] | undefined;
      readonly doneOn?: string | undefined;
    }) => Effect.Effect<
      Plan,
      | PlanNotFoundError
      | RowOutOfReachError
      | PlanNotDoneError
      | InvalidDateError
      | BlankFieldError
      | InvalidChoiceError
      | PatientStoreError
    >;
    /**
     * The reverse of `moveNoteToPatient`: the note leaves its patient for the Inbox with its
     * labs and plans, which are drafts again and compared with nothing; the patient's other
     * results get their baselines anew. Merged into the Inbox note its thread already has, if
     * any. The thread's link to the patient is left alone.
     */
    readonly moveNoteToInbox: (input: {
      readonly noteId: string;
    }) => Effect.Effect<Note, NoteNotFoundError | NoteAlreadyInInboxError | PatientStoreError>;
    /** `moveNoteToInbox` for the note a thread has for the patient it is linked to. */
    readonly returnThreadNoteToInbox: (input: {
      readonly threadId: string;
    }) => Effect.Effect<
      { readonly note: Note; readonly labs: ReadonlyArray<Lab> },
      | ThreadHasNoPatientError
      | ThreadNoteNotFoundError
      | NoteNotFoundError
      | NoteAlreadyInInboxError
      | PatientStoreError
    >;
    /** Adds the files the note does not have yet, by path, and returns all it has. */
    readonly addNoteFiles: (input: {
      readonly noteId: string;
      readonly files: ReadonlyArray<NoteFileInput>;
    }) => Effect.Effect<
      ReadonlyArray<NoteFile>,
      NoteNotFoundError | BlankFieldError | PatientStoreError
    >;
    /**
     * Links a thread to a patient on no evidence. No route and no tool calls it: agents link
     * through `findPatientFromThread`, `createPatientFromThread` and `moveThreadNoteToPatient`.
     */
    readonly linkThread: (input: {
      readonly threadId: string;
      readonly patientId: string;
    }) => Effect.Effect<void, PatientNotFoundError | PatientStoreError>;
    readonly getThreadPatient: (
      threadId: string,
    ) => Effect.Effect<Option.Option<Patient>, PatientStoreError>;
  }
>()("t3/med/PatientStore") {}

const make = Effect.gen(function* () {
  const sql = yield* MedDatabase.MedDatabase;
  const random = yield* SecureRandom.SecureRandom;

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  // The laptop's calendar day: UTC's is still yesterday's until 08:00 in Bali.
  const today = DateTime.now.pipe(
    Effect.map((at) => DateTime.formatIsoDate(DateTime.setZone(at, DateTime.zoneMakeLocal()))),
  );
  // Version 7 ids sort in the order they were made, which breaks ties between rows of one day.
  const newId = random.uuidV7();

  // Each statement names the step it fails in.
  const failedIn = (operation: string) =>
    Effect.mapError((cause: SqlError) => new PatientStoreError({ operation, cause }));

  // The statements of a transaction map their own failures; BEGIN and COMMIT are left for this.
  const transactionFailure = (operation: string) => ({
    SqlError: (cause: SqlError) =>
      Effect.fail(new PatientStoreError({ operation: `${operation}:transaction`, cause })),
  });

  const lastChatAt = sql`(
    SELECT MAX(at) FROM (
      SELECT n.updated_at AS at FROM notes n WHERE n.patient_id = p.id
      UNION ALL
      SELECT t.updated_at FROM thread_patients t WHERE t.patient_id = p.id
    )
  )`;

  const patientColumns = sql`
    p.id AS "id",
    p.name AS "name",
    p.urn AS "urn",
    p.urn_key AS "urnKey",
    p.status AS "status",
    p.sex AS "sex",
    p.date_of_birth AS "dateOfBirth",
    p.diagnoses AS "diagnoses",
    p.also_written_as AS "alsoWrittenAs",
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt",
    ${lastChatAt} AS "lastChatAt",
    COALESCE(${lastChatAt}, p.created_at) AS "lastActivityAt"
  `;

  const noteColumns = sql`
    id AS "id",
    patient_id AS "patientId",
    thread_id AS "threadId",
    title AS "title",
    date AS "date",
    kind AS "kind",
    summary AS "summary",
    needs_you AS "needsYou",
    local_file AS "localFile",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const readPatient = Effect.fn("PatientStore.readPatient")(function* (patientId: string) {
    const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns} FROM patients p WHERE p.id = ${patientId}
    `.pipe(failedIn("readPatient:query"));
    const row = rows[0];
    return row === undefined ? yield* new PatientNotFoundError({ patientId }) : toPatient(row);
  });

  const readNote = Effect.fn("PatientStore.readNote")(function* (noteId: string) {
    const rows = yield* sql<Note>`SELECT ${noteColumns} FROM notes WHERE id = ${noteId}`.pipe(
      failedIn("readNote:query"),
    );
    return rows[0] ?? (yield* new NoteNotFoundError({ noteId }));
  });

  // What a note files counts as activity of the note, which is what orders the patient list.
  const touchNote = (noteId: string, at: string) =>
    sql`UPDATE notes SET updated_at = ${at} WHERE id = ${noteId}`.pipe(
      failedIn("touchNote:update"),
    );

  // Rows filed from a note share its patient, so moving or verifying the note covers them all.
  const requireFilingTarget = Effect.fn("PatientStore.requireFilingTarget")(function* (
    patientId: string | null,
    sourceNoteId: string,
  ) {
    if (patientId !== null) yield* readPatient(patientId);
    const note = yield* readNote(sourceNoteId);
    if (note.patientId !== patientId) {
      return yield* new NotePatientMismatchError({ noteId: sourceNoteId });
    }
  });

  const labTestColumns = sql`
    id AS "id",
    name AS "name",
    test_id AS "testId",
    category AS "category",
    also_written_as AS "alsoWrittenAs"
  `;

  const selectLabs = Effect.fn("PatientStore.selectLabs")(function* (where: Fragment) {
    const rows = yield* sql<LabRow>`
    SELECT
      l.id AS "id",
      l.patient_id AS "patientId",
      l.lab_test_id AS "labTestId",
      t.test_id AS "testId",
      t.name AS "testName",
      l.test_as_written AS "testAsWritten",
      l.value AS "value",
      l.value_text AS "valueText",
      l.unit AS "unit",
      l.reference_range AS "referenceRange",
      l.flag AS "flag",
      l.collected AS "collected",
      l.status AS "status",
      l.is_baseline AS "isBaseline",
      l.value_in_baseline_unit AS "valueInBaselineUnit",
      l.change_from_baseline AS "changeFromBaseline",
      l.change_percent AS "changePercent",
      l.lab AS "lab",
      l.source_note_id AS "sourceNoteId",
      l.created_at AS "createdAt",
      l.updated_at AS "updatedAt",
      b.value AS "baselineValue",
      b.unit AS "baselineUnit",
      b.collected AS "baselineCollected"
    FROM labs l
    JOIN lab_tests t ON t.id = l.lab_test_id
    LEFT JOIN labs b
      ON b.patient_id = l.patient_id
      AND b.lab_test_id = l.lab_test_id
      AND b.is_baseline = 1
      AND b.removed_at IS NULL
      AND b.id <> l.id
    WHERE l.removed_at IS NULL AND (${where})
    ORDER BY l.collected ASC, l.id ASC
  `.pipe(failedIn("selectLabs:query"));
    const revisions = yield* sql<LabRevision & { readonly labId: string }>`
      SELECT
        r.lab_id AS "labId",
        r.test_as_written AS "testAsWritten",
        r.value AS "value",
        r.value_text AS "valueText",
        r.unit AS "unit",
        r.reference_range AS "referenceRange",
        r.flag AS "flag",
        r.collected AS "collected",
        r.status AS "status",
        r.created_at AS "replacedAt"
      FROM lab_revisions r
      WHERE r.lab_id IN (SELECT l.id FROM labs l WHERE ${where})
      ORDER BY r.rowid DESC
    `.pipe(failedIn("selectLabs:revisions"));
    return rows.map((row) =>
      toLab(
        row,
        revisions.flatMap(({ labId, ...revision }) => (labId === row.id ? [revision] : [])),
      ),
    );
  });

  const planColumns = sql`
    pl.id AS "id",
    pl.patient_id AS "patientId",
    pl.title AS "title",
    pl.due AS "due",
    pl.type AS "type",
    pl.status AS "status",
    pl.done_on AS "doneOn",
    pl.source_note_id AS "sourceNoteId",
    pl.created_at AS "createdAt",
    pl.updated_at AS "updatedAt"
  `;

  // Needs you: a note `n` that asks the doctor something or holds a draft lab or plan.
  const draftLabsOfNote = sql`
    (
      SELECT COUNT(*) FROM labs l
      WHERE l.source_note_id = n.id AND l.status = 'draft' AND l.removed_at IS NULL
    )
  `;
  const draftPlansOfNote = sql`
    (
      SELECT COUNT(*) FROM plans pl
      WHERE pl.source_note_id = n.id AND pl.status = 'draft' AND pl.removed_at IS NULL
    )
  `;
  const asksOrHoldsDrafts = sql`
    (TRIM(n.needs_you) <> '' OR ${draftLabsOfNote} > 0 OR ${draftPlansOfNote} > 0)
  `;

  // Upcoming: a plan not done or cancelled, of the Inbox or of a patient who is not archived.
  const stillAhead = sql`
    pl.status IN ('draft', 'planned')
    AND pl.removed_at IS NULL
    AND COALESCE(p.status, '') <> 'archived'
  `;

  const selectPlans = (where: Fragment) =>
    sql<Plan>`
      SELECT ${planColumns} FROM plans pl
      WHERE pl.removed_at IS NULL AND (${where})
      ORDER BY pl.due ASC, pl.id ASC
    `.pipe(failedIn("selectPlans:query"));

  // `patient_id = NULL` matches no row, so a filter that names no owner lists nothing.
  const ownedBy = (column: Fragment, filter: RowOwner) =>
    filter.inbox === true ? sql`${column} IS NULL` : sql`${column} = ${filter.patientId ?? null}`;

  const threadNoteOf = (threadId: string, patientId: string | null) =>
    sql<Pick<Note, "id" | "summary" | "needsYou">>`
      SELECT id AS "id", summary AS "summary", needs_you AS "needsYou" FROM notes
      WHERE thread_id = ${threadId} AND COALESCE(patient_id, '') = ${patientId ?? ""}
      ORDER BY id ASC
    `.pipe(failedIn("threadNoteOf:query"));

  // The catalogue row for a test as written: by Test ID when the name resolves, else by name.
  const catalogueTest = Effect.fn("PatientStore.catalogueTest")(function* (
    written: string,
    category: string,
    at: string,
  ) {
    const testId = resolveTest(written);
    const candidates = yield* sql<LabTestRow>`
      SELECT ${labTestColumns} FROM lab_tests
      WHERE ${testId === null ? sql`test_id IS NULL` : sql`test_id = ${testId}`}
    `.pipe(failedIn("catalogueTest:query"));
    const known = candidates
      .map(toLabTest)
      .find(
        (test) =>
          testId !== null ||
          [test.name, ...test.alsoWrittenAs].some(
            (spelling) => spellingKey(spelling) === spellingKey(written),
          ),
      );
    if (known === undefined) {
      const id = yield* newId;
      yield* sql`
        INSERT INTO lab_tests ${sql.insert({
          id,
          name: written,
          test_id: testId,
          category,
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("catalogueTest:insert"));
      return id;
    }
    const spellings = addSpelling(known.alsoWrittenAs, known.name, written);
    if (spellings !== known.alsoWrittenAs) {
      yield* sql`
        UPDATE lab_tests
        SET also_written_as = ${spellings.join("\n")}, updated_at = ${at}
        WHERE id = ${known.id}
      `.pipe(failedIn("catalogueTest:update"));
    }
    return known.id;
  });

  // Derives the baseline fields of every row one patient has for one test. Running it over all
  // of them is what lets an older result take over as baseline. Inbox rows have no patient, and
  // `patient_id = NULL` matches no row, so results of unknown patients are never compared.
  const recomputeBaseline = Effect.fn("PatientStore.recomputeBaseline")(function* (
    patientId: string | null,
    labTestId: string,
  ) {
    const rows = yield* sql<{
      readonly id: string;
      readonly value: number | null;
      readonly unit: string;
      readonly testAsWritten: string;
      readonly testId: string | null;
    }>`
      SELECT
        l.id AS "id",
        l.value AS "value",
        l.unit AS "unit",
        l.test_as_written AS "testAsWritten",
        t.test_id AS "testId"
      FROM labs l
      JOIN lab_tests t ON t.id = l.lab_test_id
      WHERE l.patient_id = ${patientId}
        AND l.lab_test_id = ${labTestId}
        AND l.removed_at IS NULL
      ORDER BY l.collected ASC, l.id ASC
    `.pipe(failedIn("recomputeBaseline:query"));
    const baseline = rows.find((row) => row.value !== null);
    for (const row of rows) {
      const compared =
        baseline === undefined ||
        baseline.value === null ||
        row.value === null ||
        row.id === baseline.id
          ? undefined
          : Result.getOrUndefined(
              compareToBaseline({
                test: row.testId ?? row.testAsWritten,
                baseline: baseline.value,
                baselineUnit: baseline.unit,
                value: row.value,
                unit: row.unit,
              }),
            );
      yield* sql`
        UPDATE labs
        SET
          is_baseline = ${row.id === baseline?.id ? 1 : 0},
          value_in_baseline_unit = ${compared?.value ?? null},
          change_from_baseline = ${compared?.change ?? null},
          change_percent = ${compared?.changePercent ?? null}
        WHERE id = ${row.id}
      `.pipe(failedIn("recomputeBaseline:update"));
    }
  });

  const readPatientByUrnKey = Effect.fn("PatientStore.readPatientByUrnKey")(function* (
    key: string,
  ) {
    if (key === "") return Option.none<Patient>();
    const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns} FROM patients p WHERE p.urn_key = ${key}
    `.pipe(failedIn("readPatientByUrnKey:query"));
    return Option.map(Option.fromNullishOr(rows[0]), toPatient);
  });

  // The written URN and its key as stored; a URN with no letter or digit has no key.
  const urnColumns = Effect.fn("PatientStore.urnColumns")(function* (
    urn: string | null,
    exceptPatientId?: string,
  ) {
    const written = urn?.trim() ?? "";
    const key = urnKey(written);
    const holder = yield* readPatientByUrnKey(key);
    if (Option.isSome(holder) && holder.value.id !== exceptPatientId) {
      return yield* new PatientUrnTakenError({
        patientId: holder.value.id,
        patientName: holder.value.name,
        status: holder.value.status,
        urn: holder.value.urn ?? written,
      });
    }
    return { urn: written === "" ? null : written, urn_key: key === "" ? null : key };
  });

  const listLabTests: PatientStore["Service"]["listLabTests"] = Effect.fn(
    "PatientStore.listLabTests",
  )(function* () {
    const rows = yield* sql<LabTestRow>`
      SELECT ${labTestColumns} FROM lab_tests ORDER BY name ASC, id ASC
    `.pipe(failedIn("listLabTests:query"));
    return rows.map(toLabTest);
  });

  // The catalogue rows a name means: by Test ID, given or resolved, else by a known spelling.
  const testsNamed = Effect.fn("PatientStore.testsNamed")(function* (written: string) {
    const testId = resolveTest(written);
    const tests = yield* listLabTests();
    return tests
      .filter(
        (test) =>
          (test.testId !== null && (test.testId === written.trim() || test.testId === testId)) ||
          [test.name, ...test.alsoWrittenAs].some(
            (spelling) => spellingKey(spelling) === spellingKey(written),
          ),
      )
      .map((test) => test.id);
  });

  const listPatients: PatientStore["Service"]["listPatients"] = Effect.fn(
    "PatientStore.listPatients",
  )(function* () {
    const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns} FROM patients p ORDER BY "lastActivityAt" DESC, p.name ASC
    `.pipe(failedIn("listPatients:query"));
    return rows.map(toPatient);
  });

  // The functions from here to `PatientStore.of` run inside the caller's transaction.
  const writeThreadNote = Effect.fn("PatientStore.writeThreadNote")(function* (
    input: ThreadNoteInput,
    at: string,
  ) {
    if (input.patientId !== null) yield* readPatient(input.patientId);
    const existing = (yield* threadNoteOf(input.threadId, input.patientId))[0];
    const noteId = existing?.id ?? (yield* newId);
    const asked = input.clearNeedsYou === true ? "" : (existing?.needsYou ?? "");
    if (existing === undefined) {
      if (input.title === undefined) return yield* new BlankFieldError({ field: "title" });
      yield* sql`
        INSERT INTO notes ${sql.insert({
          id: noteId,
          patient_id: input.patientId,
          thread_id: input.threadId,
          title: input.title,
          date: input.date ?? (yield* today),
          kind: input.kind ?? "chat",
          summary: input.summary ?? "",
          needs_you: addLines(asked, input.needsYou ?? ""),
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("upsertThreadNote:insert"));
    } else {
      yield* sql`
        UPDATE notes SET ${sql.update({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.date === undefined ? {} : { date: input.date }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          needs_you: addLines(asked, input.needsYou ?? ""),
          updated_at: at,
        })}
        WHERE id = ${noteId}
      `.pipe(failedIn("upsertThreadNote:update"));
    }
    // The row was written in this transaction, so only its absence is a defect.
    return yield* readNote(noteId).pipe(
      Effect.catchTags({ NoteNotFoundError: (error) => Effect.die(error) }),
    );
  });

  const insertLabs = Effect.fn("PatientStore.insertLabs")(function* (
    patientId: string | null,
    sourceNoteId: string,
    results: ReadonlyArray<CheckedLabResult>,
    at: string,
  ) {
    const filed: Array<string> = [];
    const added = new Set<string>();
    for (const { category, ...result } of results) {
      const labTestId = yield* catalogueTest(result.test_as_written, category, at);
      // A retried filing repeats its results; `IS` also matches a result that is not a number.
      const same = yield* sql<{ readonly id: string }>`
        SELECT id AS "id" FROM labs
        WHERE source_note_id = ${sourceNoteId}
          AND lab_test_id = ${labTestId}
          AND collected = ${result.collected}
          AND value IS ${result.value}
          AND value_text = ${result.value_text}
          AND unit = ${result.unit}
          AND removed_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      `.pipe(failedIn("fileLabs:findSame"));
      if (same[0] !== undefined) {
        filed.push(same[0].id);
        continue;
      }
      const id = yield* newId;
      yield* sql`
        INSERT INTO labs ${sql.insert({
          id,
          patient_id: patientId,
          lab_test_id: labTestId,
          ...result,
          status: "draft",
          source_note_id: sourceNoteId,
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("fileLabs:insert"));
      filed.push(id);
      added.add(labTestId);
    }
    if (filed.length === 0) return [];
    if (added.size > 0) yield* touchNote(sourceNoteId, at);
    for (const labTestId of added) {
      yield* recomputeBaseline(patientId, labTestId);
    }
    const labs = yield* selectLabs(sql`l.id IN ${sql.in(filed)}`);
    return filed.flatMap((id) => labs.filter((lab) => lab.id === id));
  });

  const insertPlans = Effect.fn("PatientStore.insertPlans")(function* (
    patientId: string | null,
    sourceNoteId: string,
    plans: ReadonlyArray<PlanInput>,
    at: string,
  ) {
    const ids: Array<string> = [];
    let added = false;
    for (const plan of plans) {
      const title = plan.title.trim();
      const same = yield* sql<{ readonly id: string }>`
        SELECT id AS "id" FROM plans
        WHERE source_note_id = ${sourceNoteId}
          AND title = ${title}
          AND due = ${plan.due}
          AND removed_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      `.pipe(failedIn("filePlans:findSame"));
      if (same[0] !== undefined) {
        ids.push(same[0].id);
        continue;
      }
      const id = yield* newId;
      yield* sql`
        INSERT INTO plans ${sql.insert({
          id,
          patient_id: patientId,
          title,
          due: plan.due,
          type: plan.type,
          status: "draft",
          source_note_id: sourceNoteId,
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("filePlans:insert"));
      ids.push(id);
      added = true;
    }
    if (ids.length === 0) return [];
    if (added) yield* touchNote(sourceNoteId, at);
    const rows = yield* selectPlans(sql`id IN ${sql.in(ids)}`);
    return ids.flatMap((id) => rows.filter((row) => row.id === id));
  });

  const selectNoteFiles = (where: Fragment) =>
    sql<NoteFile>`
      SELECT f.id AS "id", f.note_id AS "noteId", f.name AS "name", f.path AS "path"
      FROM note_files f
      WHERE ${where}
      ORDER BY f.id ASC
    `.pipe(failedIn("selectNoteFiles:query"));

  const insertNoteFiles = Effect.fn("PatientStore.insertNoteFiles")(function* (
    noteId: string,
    files: ReadonlyArray<NoteFileInput>,
    at: string,
  ) {
    const known = new Set((yield* selectNoteFiles(sql`f.note_id = ${noteId}`)).map((f) => f.path));
    const added = files.filter((file) => !known.has(file.path.trim()));
    for (const file of added) {
      known.add(file.path.trim());
      yield* sql`
        INSERT INTO note_files ${sql.insert({
          id: yield* newId,
          note_id: noteId,
          name: file.name.trim(),
          path: file.path.trim(),
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("addNoteFiles:insert"));
    }
    if (added.length > 0) yield* touchNote(noteId, at);
    return yield* selectNoteFiles(sql`f.note_id = ${noteId}`);
  });

  const writeThreadLink = (threadId: string, patientId: string, at: string) =>
    sql`
      INSERT INTO thread_patients ${sql.insert({
        thread_id: threadId,
        patient_id: patientId,
        created_at: at,
        updated_at: at,
      })}
      ON CONFLICT (thread_id)
      DO UPDATE SET patient_id = excluded.patient_id, updated_at = excluded.updated_at
    `.pipe(failedIn("linkThread:upsert"));

  const readThreadPatient = Effect.fn("PatientStore.readThreadPatient")(function* (
    threadId: string,
  ) {
    const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns}
      FROM thread_patients t
      JOIN patients p ON p.id = t.patient_id
      WHERE t.thread_id = ${threadId}
    `.pipe(failedIn("getThreadPatient:query"));
    return Option.map(Option.fromNullishOr(rows[0]), toPatient);
  });

  // Links the thread, and returns the patient it was linked to when that was another one.
  const linkThreadTo = Effect.fn("PatientStore.linkThreadTo")(function* (
    threadId: string,
    patientId: string,
    at: string,
  ) {
    const previous = yield* readThreadPatient(threadId);
    yield* writeThreadLink(threadId, patientId, at);
    return Option.filter(previous, (patient) => patient.id !== patientId);
  });

  const moveNote = Effect.fn("PatientStore.moveNote")(function* (
    noteId: string,
    patientId: string,
    at: string,
  ) {
    const note = yield* readNote(noteId);
    if (note.patientId !== null) return yield* new NoteNotInInboxError({ noteId });
    yield* readPatient(patientId);
    // A thread keeps one note per patient, so a second one is merged into the first.
    const kept =
      note.threadId === null ? undefined : (yield* threadNoteOf(note.threadId, patientId))[0];
    const keptId = kept?.id ?? noteId;
    if (kept === undefined) {
      yield* sql`
        UPDATE notes SET patient_id = ${patientId}, updated_at = ${at} WHERE id = ${noteId}
      `.pipe(failedIn("moveNoteToPatient:updateNote"));
    } else {
      yield* sql`
        UPDATE notes SET ${sql.update({
          summary: joinText(kept.summary, note.summary),
          needs_you: joinText(kept.needsYou, note.needsYou),
          updated_at: at,
        })}
        WHERE id = ${keptId}
      `.pipe(failedIn("moveNoteToPatient:mergeNote"));
      yield* sql`
        UPDATE note_files SET note_id = ${keptId}, updated_at = ${at} WHERE note_id = ${noteId}
      `.pipe(failedIn("moveNoteToPatient:updateFiles"));
    }
    yield* sql`
      UPDATE plans
      SET patient_id = ${patientId}, source_note_id = ${keptId}, updated_at = ${at}
      WHERE source_note_id = ${noteId}
    `.pipe(failedIn("moveNoteToPatient:updatePlans"));
    const tests = yield* sql<{ readonly labTestId: string }>`
      UPDATE labs
      SET patient_id = ${patientId}, source_note_id = ${keptId}, updated_at = ${at}
      WHERE source_note_id = ${noteId}
      RETURNING lab_test_id AS "labTestId"
    `.pipe(failedIn("moveNoteToPatient:updateLabs"));
    if (kept !== undefined) {
      yield* sql`DELETE FROM notes WHERE id = ${noteId}`.pipe(
        failedIn("moveNoteToPatient:deleteNote"),
      );
    }
    for (const labTestId of new Set(tests.map((lab) => lab.labTestId))) {
      yield* recomputeBaseline(patientId, labTestId);
    }
    const relinkedFrom =
      note.threadId === null
        ? Option.none<Patient>()
        : yield* linkThreadTo(note.threadId, patientId, at);
    return { note: yield* readNote(keptId), relinkedFrom };
  });

  const requireThreadNote = Effect.fn("PatientStore.requireThreadNote")(function* (
    threadId: string,
    patientId: string | null,
  ) {
    const note = (yield* threadNoteOf(threadId, patientId))[0];
    return note?.id ?? (yield* new ThreadNoteNotFoundError({ patientId }));
  });

  const returnNote = Effect.fn("PatientStore.returnNote")(function* (noteId: string, at: string) {
    const note = yield* readNote(noteId);
    const { patientId } = note;
    if (patientId === null) return yield* new NoteAlreadyInInboxError({ noteId });
    // A thread keeps one note in the Inbox, so a second one is merged into the first.
    const kept = note.threadId === null ? undefined : (yield* threadNoteOf(note.threadId, null))[0];
    const keptId = kept?.id ?? noteId;
    if (kept === undefined) {
      yield* sql`
        UPDATE notes SET patient_id = NULL, updated_at = ${at} WHERE id = ${noteId}
      `.pipe(failedIn("moveNoteToInbox:updateNote"));
    } else {
      yield* sql`
        UPDATE notes SET ${sql.update({
          summary: joinText(kept.summary, note.summary),
          needs_you: joinText(kept.needsYou, note.needsYou),
          updated_at: at,
        })}
        WHERE id = ${keptId}
      `.pipe(failedIn("moveNoteToInbox:mergeNote"));
      yield* sql`
        UPDATE note_files SET note_id = ${keptId}, updated_at = ${at} WHERE note_id = ${noteId}
      `.pipe(failedIn("moveNoteToInbox:updateFiles"));
    }
    // Nothing in the Inbox is confirmed: whose it is has just become unknown again.
    yield* sql`
      UPDATE plans
      SET
        patient_id = NULL,
        source_note_id = ${keptId},
        status = CASE status WHEN 'planned' THEN 'draft' ELSE status END,
        reopens_as = CASE reopens_as WHEN 'planned' THEN 'draft' ELSE reopens_as END,
        updated_at = ${at}
      WHERE source_note_id = ${noteId}
    `.pipe(failedIn("moveNoteToInbox:updatePlans"));
    const tests = yield* sql<{ readonly labTestId: string }>`
      UPDATE labs
      SET
        patient_id = NULL,
        source_note_id = ${keptId},
        status = 'draft',
        is_baseline = 0,
        value_in_baseline_unit = NULL,
        change_from_baseline = NULL,
        change_percent = NULL,
        updated_at = ${at}
      WHERE source_note_id = ${noteId}
      RETURNING lab_test_id AS "labTestId"
    `.pipe(failedIn("moveNoteToInbox:updateLabs"));
    yield* sql`
      UPDATE lab_revisions SET status = 'draft'
      WHERE lab_id IN (SELECT id FROM labs WHERE source_note_id = ${keptId})
    `.pipe(failedIn("moveNoteToInbox:updateRevisions"));
    if (kept !== undefined) {
      yield* sql`DELETE FROM notes WHERE id = ${noteId}`.pipe(
        failedIn("moveNoteToInbox:deleteNote"),
      );
    }
    for (const labTestId of new Set(tests.map((lab) => lab.labTestId))) {
      yield* recomputeBaseline(patientId, labTestId);
    }
    return yield* readNote(keptId);
  });

  interface StoredLab {
    readonly id: string;
    readonly patientId: string | null;
    readonly labTestId: string;
    readonly testAsWritten: string;
    readonly value: number | null;
    readonly valueText: string;
    readonly unit: string;
    readonly referenceRange: string;
    readonly flag: LabFlag | null;
    readonly collected: string;
    readonly status: "draft" | "verified";
    readonly sourceNoteId: string;
    readonly removedAt: string | null;
  }

  // The row itself, removed or not: what a write starts from.
  const readLabRow = Effect.fn("PatientStore.readLabRow")(function* (labId: string) {
    const rows = yield* sql<StoredLab>`
      SELECT
        id AS "id",
        patient_id AS "patientId",
        lab_test_id AS "labTestId",
        test_as_written AS "testAsWritten",
        value AS "value",
        value_text AS "valueText",
        unit AS "unit",
        reference_range AS "referenceRange",
        flag AS "flag",
        collected AS "collected",
        status AS "status",
        source_note_id AS "sourceNoteId",
        removed_at AS "removedAt"
      FROM labs
      WHERE id = ${labId}
    `.pipe(failedIn("readLabRow:query"));
    return rows[0] ?? (yield* new LabNotFoundError({ labId }));
  });

  // A removed result is not there for anything but putting it back.
  const readLiveLab = Effect.fn("PatientStore.readLiveLab")(function* (labId: string) {
    const lab = yield* readLabRow(labId);
    return lab.removedAt === null ? lab : yield* new LabNotFoundError({ labId });
  });

  const readPlanRow = Effect.fn("PatientStore.readPlanRow")(function* (planId: string) {
    const rows = yield* sql<
      Pick<Plan, "id" | "patientId" | "title" | "due" | "status" | "doneOn" | "sourceNoteId"> & {
        readonly reopensAs: "draft" | "planned" | null;
        readonly removedAt: string | null;
      }
    >`
      SELECT
        id AS "id",
        patient_id AS "patientId",
        title AS "title",
        due AS "due",
        status AS "status",
        done_on AS "doneOn",
        reopens_as AS "reopensAs",
        source_note_id AS "sourceNoteId",
        removed_at AS "removedAt"
      FROM plans
      WHERE id = ${planId}
    `.pipe(failedIn("readPlanRow:query"));
    return rows[0] ?? (yield* new PlanNotFoundError({ planId }));
  });

  const readLivePlan = Effect.fn("PatientStore.readLivePlan")(function* (planId: string) {
    const plan = yield* readPlanRow(planId);
    return plan.removedAt === null ? plan : yield* new PlanNotFoundError({ planId });
  });

  // An agent changes what is filed for its thread's patient, or what its thread's own notes
  // filed, and nothing else. The doctor's controls pass no thread and reach every row.
  const requireReach = Effect.fn("PatientStore.requireReach")(function* (
    threadId: string | undefined,
    row: "lab" | "plan",
    owned: {
      readonly id: string;
      readonly patientId: string | null;
      readonly sourceNoteId: string;
    },
  ) {
    if (threadId === undefined) return;
    const linked = yield* readThreadPatient(threadId);
    if (owned.patientId !== null && Option.getOrUndefined(linked)?.id === owned.patientId) return;
    const notes = yield* sql<{ readonly threadId: string | null }>`
      SELECT thread_id AS "threadId" FROM notes WHERE id = ${owned.sourceNoteId}
    `.pipe(failedIn("requireReach:query"));
    if (notes[0]?.threadId === threadId) return;
    return yield* new RowOutOfReachError({ row, id: owned.id });
  });

  // One result with its comparison, after a write in this transaction.
  const readLab = Effect.fn("PatientStore.readLab")(function* (labId: string) {
    const labs = yield* selectLabs(sql`l.id = ${labId}`);
    return labs[0] ?? (yield* Effect.die(new LabNotFoundError({ labId })));
  });

  // The doctor confirming anything filed for a new patient confirms the patient too.
  const activatePatient = Effect.fn("PatientStore.activatePatient")(function* (
    patientId: string,
    at: string,
  ) {
    const patients = yield* sql`
      UPDATE patients SET status = 'active', updated_at = ${at}
      WHERE id = ${patientId} AND status = 'new'
      RETURNING id
    `.pipe(failedIn("verifyNote:updatePatient"));
    return patients.length > 0;
  });

  const verify = Effect.fn("PatientStore.verify")(function* (noteId: string, at: string) {
    const { patientId } = yield* readNote(noteId);
    if (patientId === null) return yield* new NoteInInboxError({ noteId });
    const labs = yield* sql`
      UPDATE labs SET status = 'verified', updated_at = ${at}
      WHERE source_note_id = ${noteId} AND status = 'draft' AND removed_at IS NULL
      RETURNING id
    `.pipe(failedIn("verifyNote:updateLabs"));
    const plans = yield* sql`
      UPDATE plans SET status = 'planned', updated_at = ${at}
      WHERE source_note_id = ${noteId} AND status = 'draft' AND removed_at IS NULL
      RETURNING id
    `.pipe(failedIn("verifyNote:updatePlans"));
    const patientActivated = yield* activatePatient(patientId, at);
    if (labs.length + plans.length > 0 || patientActivated) yield* touchNote(noteId, at);
    return { labsVerified: labs.length, plansPlanned: plans.length, patientActivated };
  });

  const searchPatients: PatientStore["Service"]["searchPatients"] = Effect.fn(
    "PatientStore.searchPatients",
  )(function* (query) {
    // Filtered here, not with LIKE: SQLite folds case for ASCII letters only.
    const wanted = spellingKey(query);
    const patients = yield* listPatients();
    return patients.filter((patient) =>
      [patient.name, ...patient.alsoWrittenAs].some((spelling) =>
        spellingKey(spelling).includes(wanted),
      ),
    );
  });

  const findPatient: PatientStore["Service"]["findPatient"] = Effect.fn("PatientStore.findPatient")(
    function* (query) {
      const urn = query.urn?.trim() ?? "";
      const name = query.name?.trim() ?? "";
      if (urn === "" && name === "") return yield* new BlankFieldError({ field: "urn or name" });
      const match = yield* readPatientByUrnKey(urnKey(urn));
      const candidates = Option.isSome(match) || name === "" ? [] : yield* searchPatients(name);
      return { match, candidates };
    },
  );

  const checkPatientInput = Effect.fn("PatientStore.checkPatientInput")(function* (
    input: PatientInput,
  ) {
    yield* requireText("name", input.name);
    const sex = input.sex ?? null;
    if (sex !== null) yield* requireChoice("sex", sex, PATIENT_SEXES);
    const dateOfBirth = input.dateOfBirth ?? null;
    if (dateOfBirth !== null) yield* requireIsoDate("dateOfBirth", dateOfBirth);
    const name = tidy(input.name);
    return {
      name,
      urn: input.urn ?? null,
      sex,
      date_of_birth: dateOfBirth,
      diagnoses: input.diagnoses ?? "",
      also_written_as: (input.alsoWrittenAs ?? [])
        .reduce<ReadonlyArray<string>>((known, spelling) => addSpelling(known, name, spelling), [])
        .join("\n"),
    };
  });

  const insertPatient = Effect.fn("PatientStore.insertPatient")(function* (
    { urn, ...columns }: Effect.Success<ReturnType<typeof checkPatientInput>>,
    at: string,
  ) {
    const id = yield* newId;
    yield* sql`
      INSERT INTO patients ${sql.insert({
        id,
        ...columns,
        ...(yield* urnColumns(urn)),
        status: "new",
        created_at: at,
        updated_at: at,
      })}
    `.pipe(failedIn("createPatient:insert"));
    // The row was written in this transaction, so only its absence is a defect.
    return yield* readPatient(id).pipe(
      Effect.catchTags({ PatientNotFoundError: (error) => Effect.die(error) }),
    );
  });

  return PatientStore.of({
    findPatientByUrn: Effect.fn("PatientStore.findPatientByUrn")(function* (urn) {
      return yield* readPatientByUrnKey(urnKey(urn));
    }),

    findPatient,

    findPatientFromThread: Effect.fn("PatientStore.findPatientFromThread")(function* ({
      threadId,
      ...query
    }) {
      yield* requireText("threadId", threadId);
      const asksNothing = (query.urn ?? "").trim() === "" && (query.name ?? "").trim() === "";
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const found = asksNothing
          ? { match: Option.none<Patient>(), candidates: [] }
          : yield* findPatient(query);
        if (Option.isNone(found.match)) {
          const linked = yield* readThreadPatient(threadId);
          return { ...found, relinkedFrom: Option.none<Patient>(), linked };
        }
        const relinkedFrom = yield* linkThreadTo(threadId, found.match.value.id, at);
        return { ...found, relinkedFrom, linked: found.match };
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("findPatientFromThread")));
    }),

    getPatient: Effect.fn("PatientStore.getPatient")(function* (patientId) {
      return yield* readPatient(patientId);
    }),

    getPatientRecord: Effect.fn("PatientStore.getPatientRecord")(function* (input) {
      const patient = yield* readPatient(input.patientId);
      const ofPatient = sql`l.patient_id = ${patient.id}`;
      const tests = input.test === undefined ? undefined : yield* testsNamed(input.test);
      const labs =
        tests === undefined
          ? yield* selectLabs(ofPatient)
          : tests.length === 0
            ? []
            : yield* selectLabs(sql.and([ofPatient, sql`l.lab_test_id IN ${sql.in(tests)}`]));
      const notes = yield* sql<Note>`
        SELECT ${noteColumns} FROM notes WHERE patient_id = ${patient.id}
        ORDER BY date DESC, id DESC
      `.pipe(failedIn("getPatientRecord:notes"));
      const files = yield* selectNoteFiles(
        sql`f.note_id IN (SELECT id FROM notes WHERE patient_id = ${patient.id})`,
      );
      return {
        patient,
        labs,
        plans: yield* selectPlans(sql`patient_id = ${patient.id}`),
        notes: notes.map((note) => ({
          ...note,
          files: files.filter((file) => file.noteId === note.id),
        })),
      };
    }),

    listPatients,

    getPatientHome: Effect.fn("PatientStore.getPatientHome")(function* (patientId) {
      const patient = yield* readPatient(patientId);
      const notes = yield* sql<WaitingNote>`
        SELECT
          ${noteColumns},
          ${draftLabsOfNote} AS "draftLabs",
          ${draftPlansOfNote} AS "draftPlans"
        FROM notes n
        WHERE n.patient_id = ${patient.id}
        ORDER BY n.date DESC, n.id DESC
      `.pipe(failedIn("getPatientHome:notes"));
      const threads = yield* sql<LinkedThread>`
        SELECT thread_id AS "threadId", updated_at AS "linkedAt"
        FROM thread_patients
        WHERE patient_id = ${patient.id}
        ORDER BY updated_at DESC, thread_id ASC
      `.pipe(failedIn("getPatientHome:threads"));
      const drafts = yield* sql<{ readonly labs: number; readonly plans: number }>`
        SELECT
          (
            SELECT COUNT(*) FROM labs
            WHERE patient_id = ${patient.id} AND status = 'draft' AND removed_at IS NULL
          ) AS "labs",
          (
            SELECT COUNT(*) FROM plans
            WHERE patient_id = ${patient.id} AND status = 'draft' AND removed_at IS NULL
          ) AS "plans"
      `.pipe(failedIn("getPatientHome:drafts"));
      return {
        patient,
        notes,
        threads,
        draftLabs: drafts[0]?.labs ?? 0,
        draftPlans: drafts[0]?.plans ?? 0,
        upcomingPlans: yield* selectPlans(
          sql`pl.patient_id = ${patient.id} AND pl.status IN ('draft', 'planned')`,
        ),
      };
    }),

    searchPatients,

    createPatient: Effect.fn("PatientStore.createPatient")(function* (input) {
      const checked = yield* checkPatientInput(input);
      const at = yield* now;
      return yield* insertPatient(checked, at).pipe(
        sql.withTransaction,
        Effect.catchTags(transactionFailure("createPatient")),
      );
    }),

    createPatientFromThread: Effect.fn("PatientStore.createPatientFromThread")(function* ({
      threadId,
      ...input
    }) {
      yield* requireText("threadId", threadId);
      // A URN with no letter or digit has no key, so nothing could ever match it.
      if (typeof input.urn !== "string" || urnKey(input.urn) === "") {
        return yield* new BlankFieldError({ field: "urn" });
      }
      const checked = yield* checkPatientInput(input);
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const patient = yield* insertPatient(checked, at);
        return { patient, relinkedFrom: yield* linkThreadTo(threadId, patient.id, at) };
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("createPatientFromThread")));
    }),

    updatePatient: Effect.fn("PatientStore.updatePatient")(function* (patientId, fields) {
      if (fields.name !== undefined) yield* requireText("name", fields.name);
      if (fields.status !== undefined) {
        yield* requireChoice("status", fields.status, PATIENT_STATUSES);
      }
      const sex = fields.sex ?? null;
      if (sex !== null) yield* requireChoice("sex", sex, PATIENT_SEXES);
      const dateOfBirth = fields.dateOfBirth ?? null;
      if (dateOfBirth !== null) yield* requireIsoDate("dateOfBirth", dateOfBirth);
      const at = yield* now;
      const name = fields.name === undefined ? undefined : tidy(fields.name);
      return yield* Effect.gen(function* () {
        const patient = yield* readPatient(patientId);
        const listed = fields.alsoWrittenAs?.reduce<ReadonlyArray<string>>(
          (known, spelling) => addSpelling(known, name ?? patient.name, spelling),
          [],
        );
        const renamed =
          listed ??
          (name === undefined ? patient.alsoWrittenAs : spellingsAfterRename(patient, name));
        const spellings =
          fields.addSpelling === undefined
            ? renamed
            : addSpelling(renamed, name ?? patient.name, fields.addSpelling);
        yield* sql`
          UPDATE patients SET ${sql.update({
            ...(name === undefined ? {} : { name }),
            ...(spellings === patient.alsoWrittenAs
              ? {}
              : { also_written_as: spellings.join("\n") }),
            ...(fields.urn === undefined ? {} : yield* urnColumns(fields.urn, patientId)),
            ...(fields.status === undefined ? {} : { status: fields.status }),
            ...(fields.sex === undefined ? {} : { sex: fields.sex }),
            ...(fields.dateOfBirth === undefined ? {} : { date_of_birth: fields.dateOfBirth }),
            ...(fields.diagnoses === undefined ? {} : { diagnoses: fields.diagnoses }),
            updated_at: at,
          })}
          WHERE id = ${patientId}
        `.pipe(failedIn("updatePatient:update"));
        return yield* readPatient(patientId);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("updatePatient")));
    }),

    addPatientSpelling: Effect.fn("PatientStore.addPatientSpelling")(
      function* (patientId, spelling) {
        const at = yield* now;
        return yield* Effect.gen(function* () {
          const patient = yield* readPatient(patientId);
          const spellings = addSpelling(patient.alsoWrittenAs, patient.name, spelling);
          if (spellings === patient.alsoWrittenAs) return patient;
          yield* sql`
            UPDATE patients
            SET also_written_as = ${spellings.join("\n")}, updated_at = ${at}
            WHERE id = ${patientId}
          `.pipe(failedIn("addPatientSpelling:update"));
          return yield* readPatient(patientId);
        }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("addPatientSpelling")));
      },
    ),

    upsertThreadNote: Effect.fn("PatientStore.upsertThreadNote")(function* (input) {
      yield* checkThreadNote(input);
      const at = yield* now;
      return yield* writeThreadNote(input, at).pipe(
        sql.withTransaction,
        Effect.catchTags(transactionFailure("upsertThreadNote")),
      );
    }),

    fileLabs: Effect.fn("PatientStore.fileLabs")(function* (input) {
      const { patientId, sourceNoteId } = input;
      yield* requireText("sourceNoteId", sourceNoteId);
      const results = yield* Effect.forEach(input.results, (result, index) =>
        checkLabResult(result, `results[${index}].`),
      );
      const at = yield* now;
      return yield* requireFilingTarget(patientId, sourceNoteId).pipe(
        Effect.andThen(insertLabs(patientId, sourceNoteId, results, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("fileLabs")),
      );
    }),

    listLabs: Effect.fn("PatientStore.listLabs")(function* (filter) {
      return yield* selectLabs(
        sql.and([
          ownedBy(sql`l.patient_id`, filter),
          ...(filter.sourceNoteId === undefined
            ? []
            : [sql`l.source_note_id = ${filter.sourceNoteId}`]),
        ]),
      );
    }),

    listLabTests,

    filePlans: Effect.fn("PatientStore.filePlans")(function* (input) {
      const { patientId, sourceNoteId } = input;
      yield* requireText("sourceNoteId", sourceNoteId);
      yield* Effect.forEach(input.plans, checkPlan);
      const at = yield* now;
      return yield* requireFilingTarget(patientId, sourceNoteId).pipe(
        Effect.andThen(insertPlans(patientId, sourceNoteId, input.plans, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("filePlans")),
      );
    }),

    listPlans: Effect.fn("PatientStore.listPlans")(function* (filter) {
      return yield* selectPlans(
        sql.and([
          ownedBy(sql`patient_id`, filter),
          ...(filter.sourceNoteId === undefined
            ? []
            : [sql`source_note_id = ${filter.sourceNoteId}`]),
        ]),
      );
    }),

    listNeedsYou: Effect.fn("PatientStore.listNeedsYou")(function* () {
      const waiting = yield* sql<WaitingNote>`
        SELECT
          ${noteColumns},
          ${draftLabsOfNote} AS "draftLabs",
          ${draftPlansOfNote} AS "draftPlans"
        FROM notes n
        WHERE n.patient_id IS NULL OR ${asksOrHoldsDrafts}
        ORDER BY n.updated_at DESC, n.id DESC
      `.pipe(failedIn("listNeedsYou:query"));
      const sum = (notes: ReadonlyArray<WaitingNote>, count: "draftLabs" | "draftPlans") =>
        notes.reduce((total, note) => total + note[count], 0);
      const patients = yield* listPatients();
      return {
        inbox: waiting.filter((note) => note.patientId === null),
        patients: patients.flatMap((patient) => {
          const notes = waiting.filter((note) => note.patientId === patient.id);
          return notes.length === 0 || patient.status === "archived"
            ? []
            : [
                {
                  patient,
                  draftLabs: sum(notes, "draftLabs"),
                  draftPlans: sum(notes, "draftPlans"),
                  notes,
                },
              ];
        }),
      };
    }),

    getCounts: Effect.fn("PatientStore.getCounts")(function* () {
      const rows = yield* sql<{
        readonly inbox: number;
        readonly patients: number;
        readonly needsYou: number;
        readonly upcoming: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM notes WHERE patient_id IS NULL) AS "inbox",
          (SELECT COUNT(*) FROM patients WHERE status <> 'archived') AS "patients",
          (
            SELECT COUNT(*) FROM notes n
            JOIN patients p ON p.id = n.patient_id
            WHERE p.status <> 'archived' AND ${asksOrHoldsDrafts}
          ) AS "needsYou",
          (
            SELECT COUNT(*) FROM plans pl
            LEFT JOIN patients p ON p.id = pl.patient_id
            WHERE ${stillAhead}
          ) AS "upcoming"
      `.pipe(failedIn("getCounts:query"));
      return rows[0] ?? { inbox: 0, patients: 0, needsYou: 0, upcoming: 0 };
    }),

    listUpcomingPlans: Effect.fn("PatientStore.listUpcomingPlans")(function* (range = {}) {
      const { from, to } = range;
      if (from !== undefined) yield* requireIsoDate("from", from);
      if (to !== undefined) yield* requireIsoDate("to", to);
      if (from !== undefined && to !== undefined && from > to) return yield* new DateRangeError();
      return yield* sql<UpcomingPlan>`
        SELECT ${planColumns}, p.name AS "patientName", p.urn AS "patientUrn"
        FROM plans pl
        LEFT JOIN patients p ON p.id = pl.patient_id
        WHERE ${sql.and([
          stillAhead,
          ...(from === undefined ? [] : [sql`pl.due >= ${from}`]),
          ...(to === undefined ? [] : [sql`pl.due <= ${to}`]),
        ])}
        ORDER BY pl.due ASC, pl.id ASC
      `.pipe(failedIn("listUpcomingPlans:query"));
    }),

    moveNoteToPatient: Effect.fn("PatientStore.moveNoteToPatient")(function* (input) {
      const at = yield* now;
      return yield* moveNote(input.noteId, input.patientId, at).pipe(
        Effect.map((moved) => moved.note),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("moveNoteToPatient")),
      );
    }),

    moveThreadNoteToPatient: Effect.fn("PatientStore.moveThreadNoteToPatient")(function* (input) {
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const noteId = yield* requireThreadNote(input.threadId, null);
        const moved = yield* moveNote(noteId, input.patientId, at);
        return { ...moved, labs: yield* selectLabs(sql`l.source_note_id = ${moved.note.id}`) };
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("moveThreadNoteToPatient")));
    }),

    verifyNote: Effect.fn("PatientStore.verifyNote")(function* (noteId) {
      const at = yield* now;
      return yield* verify(noteId, at).pipe(
        sql.withTransaction,
        Effect.catchTags(transactionFailure("verifyNote")),
      );
    }),

    verifyThreadNote: Effect.fn("PatientStore.verifyThreadNote")(function* (input) {
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const linked = yield* readThreadPatient(input.threadId);
        if (Option.isNone(linked))
          return yield* new ThreadHasNoPatientError({ before: "verifying" });
        return yield* verify(yield* requireThreadNote(input.threadId, linked.value.id), at);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("verifyThreadNote")));
    }),

    fileFromThread: Effect.fn("PatientStore.fileFromThread")(function* (input) {
      const { threadId, patientId } = input;
      yield* requireText("threadId", threadId);
      yield* checkThreadNote(input);
      const labs = yield* Effect.forEach(input.labs ?? [], (result, index) =>
        checkLabResult(result, `labs[${index}].`),
      );
      const plans = input.plans ?? [];
      yield* Effect.forEach(plans, checkPlan);
      const files = input.files ?? [];
      yield* Effect.forEach(files, checkNoteFile);
      const at = yield* now;
      return yield* Effect.gen(function* () {
        if (patientId !== null) {
          const linked = yield* readThreadPatient(threadId);
          if (Option.getOrUndefined(linked)?.id !== patientId) {
            return yield* new ThreadNotLinkedError({ patientId });
          }
        }
        const note = yield* writeThreadNote(input, at);
        return {
          note,
          labs: yield* insertLabs(patientId, note.id, labs, at),
          plans: yield* insertPlans(patientId, note.id, plans, at),
          files: yield* insertNoteFiles(note.id, files, at),
        };
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("fileFromThread")));
    }),

    correctLab: Effect.fn("PatientStore.correctLab")(function* ({ labId, threadId, ...fields }) {
      // A text sent alone would erase the number, and a pair that disagrees stores two results.
      if (fields.valueText !== undefined && fields.valueText.trim() !== "") {
        const readings = writtenNumberReadings(fields.valueText);
        const value = fields.value ?? null;
        if (value === null && readings.length > 0) {
          return yield* new LabValueMismatchError({ reason: "text_is_a_number" });
        }
        if (value !== null && !readings.includes(value)) {
          return yield* new LabValueMismatchError({ reason: "text_is_not_the_number" });
        }
      }
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const lab = yield* readLiveLab(labId);
        yield* requireReach(threadId, "lab", lab);
        // The number and the text as written say one thing, so neither is replaced alone.
        const replacesValue = fields.value !== undefined || fields.valueText !== undefined;
        const checked = yield* checkLabResult(
          {
            testAsWritten: fields.testAsWritten ?? lab.testAsWritten,
            value: replacesValue ? (fields.value ?? null) : lab.value,
            valueText: replacesValue ? fields.valueText : lab.valueText,
            unit: fields.unit ?? lab.unit,
            referenceRange: fields.referenceRange ?? lab.referenceRange,
            flag: fields.flag === undefined ? lab.flag : fields.flag,
            collected: fields.collected ?? lab.collected,
          },
          "",
        );
        const before = {
          lab_test_id: lab.labTestId,
          test_as_written: lab.testAsWritten,
          value: lab.value,
          value_text: lab.valueText,
          unit: lab.unit,
          reference_range: lab.referenceRange,
          flag: lab.flag,
          collected: lab.collected,
        };
        const after = {
          lab_test_id:
            spellingKey(checked.test_as_written) === spellingKey(lab.testAsWritten)
              ? lab.labTestId
              : yield* catalogueTest(checked.test_as_written, "", at),
          test_as_written: checked.test_as_written,
          value: checked.value,
          value_text: checked.value_text,
          unit: checked.unit,
          reference_range: checked.reference_range,
          flag: checked.flag,
          collected: checked.collected,
        };
        if (
          Object.entries(after).every(([column, value]) =>
            Object.is(value, before[column as keyof typeof before]),
          )
        ) {
          return yield* readLab(labId);
        }
        yield* sql`
          INSERT INTO lab_revisions ${sql.insert({
            id: yield* newId,
            lab_id: labId,
            ...before,
            status: lab.status,
            created_at: at,
          })}
        `.pipe(failedIn("correctLab:insertRevision"));
        yield* sql`
          UPDATE labs SET ${sql.update({ ...after, status: "draft", updated_at: at })}
          WHERE id = ${labId}
        `.pipe(failedIn("correctLab:update"));
        yield* touchNote(lab.sourceNoteId, at);
        for (const labTestId of new Set([before.lab_test_id, after.lab_test_id])) {
          yield* recomputeBaseline(lab.patientId, labTestId);
        }
        return yield* readLab(labId);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("correctLab")));
    }),

    undoLabCorrection: Effect.fn("PatientStore.undoLabCorrection")(function* (labId) {
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const lab = yield* readLiveLab(labId);
        const revisions = yield* sql<{
          readonly id: string;
          readonly lab_test_id: string;
          readonly test_as_written: string;
          readonly value: number | null;
          readonly value_text: string;
          readonly unit: string;
          readonly reference_range: string;
          readonly flag: LabFlag | null;
          readonly collected: string;
          readonly status: "draft" | "verified";
        }>`
          SELECT
            id, lab_test_id, test_as_written, value, value_text, unit, reference_range, flag,
            collected, status
          FROM lab_revisions
          WHERE lab_id = ${labId}
          ORDER BY rowid DESC
          LIMIT 1
        `.pipe(failedIn("undoLabCorrection:query"));
        const last = revisions[0];
        if (last === undefined) return yield* new NoLabCorrectionError({ labId });
        const { id: revisionId, ...restored } = last;
        yield* sql`
          UPDATE labs SET ${sql.update({ ...restored, updated_at: at })} WHERE id = ${labId}
        `.pipe(failedIn("undoLabCorrection:update"));
        yield* sql`DELETE FROM lab_revisions WHERE id = ${revisionId}`.pipe(
          failedIn("undoLabCorrection:deleteRevision"),
        );
        yield* touchNote(lab.sourceNoteId, at);
        for (const labTestId of new Set([lab.labTestId, restored.lab_test_id])) {
          yield* recomputeBaseline(lab.patientId, labTestId);
        }
        return yield* readLab(labId);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("undoLabCorrection")));
    }),

    setRemoved: Effect.fn("PatientStore.setRemoved")(function* ({ row, id, removed, threadId }) {
      const at = yield* now;
      const removedAt = removed ? at : null;
      yield* Effect.gen(function* () {
        if (row === "lab") {
          const lab = yield* readLabRow(id);
          yield* requireReach(threadId, "lab", lab);
          if ((lab.removedAt !== null) === removed) return;
          yield* sql`
            UPDATE labs
            SET
              removed_at = ${removedAt},
              is_baseline = 0,
              value_in_baseline_unit = NULL,
              change_from_baseline = NULL,
              change_percent = NULL,
              updated_at = ${at}
            WHERE id = ${id}
          `.pipe(failedIn("setRemoved:updateLab"));
          yield* recomputeBaseline(lab.patientId, lab.labTestId);
          yield* touchNote(lab.sourceNoteId, at);
          return;
        }
        const plan = yield* readPlanRow(id);
        yield* requireReach(threadId, "plan", plan);
        if ((plan.removedAt !== null) === removed) return;
        yield* sql`
          UPDATE plans SET removed_at = ${removedAt}, updated_at = ${at} WHERE id = ${id}
        `.pipe(failedIn("setRemoved:updatePlan"));
        yield* touchNote(plan.sourceNoteId, at);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("setRemoved")));
    }),

    setVerified: Effect.fn("PatientStore.setVerified")(function* ({ row, id, verified }) {
      const at = yield* now;
      yield* Effect.gen(function* () {
        const { patientId, sourceNoteId } =
          row === "lab" ? yield* readLiveLab(id) : yield* readLivePlan(id);
        if (patientId === null) return yield* new NoteInInboxError({ noteId: sourceNoteId });
        const changed =
          row === "lab"
            ? yield* sql`
                UPDATE labs
                SET status = ${verified ? "verified" : "draft"}, updated_at = ${at}
                WHERE id = ${id} AND status = ${verified ? "draft" : "verified"}
                RETURNING id
              `.pipe(failedIn("setVerified:updateLab"))
            : yield* sql`
                UPDATE plans
                SET status = ${verified ? "planned" : "draft"}, updated_at = ${at}
                WHERE id = ${id} AND status = ${verified ? "draft" : "planned"}
                RETURNING id
              `.pipe(failedIn("setVerified:updatePlan"));
        if (changed.length === 0) return;
        if (verified) yield* activatePatient(patientId, at);
        yield* touchNote(sourceNoteId, at);
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("setVerified")));
    }),

    updatePlan: Effect.fn("PatientStore.updatePlan")(function* ({ planId, threadId, ...fields }) {
      if (fields.title !== undefined) yield* requireText("title", fields.title);
      if (fields.due !== undefined) yield* requireIsoDate("due", fields.due);
      if (fields.doneOn !== undefined) yield* requireIsoDate("doneOn", fields.doneOn);
      if (fields.status !== undefined) yield* requireChoice("status", fields.status, PLAN_MOVES);
      const at = yield* now;
      const day = yield* today;
      return yield* Effect.gen(function* () {
        const plan = yield* readLivePlan(planId);
        yield* requireReach(threadId, "plan", plan);
        const wasOpen = plan.status === "draft" || plan.status === "planned";
        const moved =
          fields.status === "open"
            ? wasOpen
              ? plan.status
              : (plan.reopensAs ?? "planned")
            : (fields.status ?? plan.status);
        if (fields.doneOn !== undefined && moved !== "done") {
          return yield* new PlanNotDoneError({ planId });
        }
        const title = fields.title === undefined ? plan.title : fields.title.trim();
        const due = fields.due ?? plan.due;
        // What an agent wrote waits for the doctor: the plan is a draft now if it is open, and
        // a draft when it is next opened if it is closed, whatever closes or moves it meanwhile.
        const agentWrote = threadId !== undefined && (title !== plan.title || due !== plan.due);
        const closed = moved === "done" || moved === "cancelled";
        const after = {
          title,
          due,
          status: agentWrote && moved === "planned" ? "draft" : moved,
          done_on: moved === "done" ? (fields.doneOn ?? plan.doneOn ?? day) : null,
          reopens_as: !closed
            ? null
            : agentWrote
              ? "draft"
              : wasOpen
                ? plan.status
                : plan.reopensAs,
        };
        const changed =
          after.title !== plan.title ||
          after.due !== plan.due ||
          after.status !== plan.status ||
          after.done_on !== plan.doneOn ||
          after.reopens_as !== plan.reopensAs;
        if (changed) {
          yield* sql`
            UPDATE plans SET ${sql.update({ ...after, updated_at: at })} WHERE id = ${planId}
          `.pipe(failedIn("updatePlan:update"));
          yield* touchNote(plan.sourceNoteId, at);
        }
        const rows = yield* selectPlans(sql`pl.id = ${planId}`);
        return rows[0] ?? (yield* Effect.die(new PlanNotFoundError({ planId })));
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("updatePlan")));
    }),

    moveNoteToInbox: Effect.fn("PatientStore.moveNoteToInbox")(function* (input) {
      const at = yield* now;
      return yield* returnNote(input.noteId, at).pipe(
        sql.withTransaction,
        Effect.catchTags(transactionFailure("moveNoteToInbox")),
      );
    }),

    returnThreadNoteToInbox: Effect.fn("PatientStore.returnThreadNoteToInbox")(function* (input) {
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const linked = yield* readThreadPatient(input.threadId);
        if (Option.isNone(linked)) {
          return yield* new ThreadHasNoPatientError({ before: "returning its note" });
        }
        const noteId = yield* requireThreadNote(input.threadId, linked.value.id);
        const note = yield* returnNote(noteId, at);
        return { note, labs: yield* selectLabs(sql`l.source_note_id = ${note.id}`) };
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("returnThreadNoteToInbox")));
    }),

    addNoteFiles: Effect.fn("PatientStore.addNoteFiles")(function* (input) {
      yield* Effect.forEach(input.files, checkNoteFile);
      const at = yield* now;
      return yield* readNote(input.noteId).pipe(
        Effect.andThen(insertNoteFiles(input.noteId, input.files, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("addNoteFiles")),
      );
    }),

    linkThread: Effect.fn("PatientStore.linkThread")(function* (input) {
      const at = yield* now;
      yield* readPatient(input.patientId).pipe(
        Effect.andThen(writeThreadLink(input.threadId, input.patientId, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("linkThread")),
      );
    }),

    getThreadPatient: Effect.fn("PatientStore.getThreadPatient")(function* (threadId) {
      return yield* readThreadPatient(threadId);
    }),
  });
});

export const layer = Layer.effect(PatientStore, make);
