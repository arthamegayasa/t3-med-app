/**
 * Patients and what agents file for them. Every row an agent writes is a draft until the doctor
 * verifies it, and a note with no patient sits in the Inbox.
 */
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

import { compareToBaseline, resolveTest } from "./labs.ts";
import * as MedDatabase from "./MedDatabase.ts";

const PATIENT_STATUSES = ["new", "active", "archived"] as const;
const PATIENT_SEXES = ["female", "male"] as const;
const LAB_FLAGS = ["low", "normal", "high"] as const;
const PLAN_TYPES = ["follow_up", "lab", "imaging", "procedure", "other"] as const;
const NOTE_KINDS = ["chat", "lab_sheet", "imaging_report", "clinical_note", "other"] as const;

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
  /** The latest change to a note of the patient or to what it files, else the creation time. */
  readonly lastActivityAt: string;
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
  readonly lab: string;
  readonly sourceNoteId: string;
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
  readonly title: string;
  /** Today when a new note gives none; an existing note keeps its date. */
  readonly date?: string | undefined;
  /** What the thread brought; `chat` when a new note gives none. */
  readonly kind?: NoteKind | undefined;
  readonly summary?: string | undefined;
  readonly needsYou?: string | undefined;
}

export interface Plan {
  readonly id: string;
  readonly patientId: string | null;
  readonly title: string;
  readonly due: string;
  readonly type: PlanType;
  readonly status: "draft" | "planned" | "done" | "cancelled";
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

export class PatientUrnTakenError extends Schema.TaggedError<PatientUrnTakenError>()(
  "PatientUrnTakenError",
  { patientId: Schema.String },
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

type InputError = InvalidDateError | BlankFieldError | InvalidChoiceError | InvalidLabValueError;

/** A URN in upper case with everything but letters and digits removed. */
export const urnKey = (urn: string): string => urn.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

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
  index: number,
  list: string,
) {
  const field = `${list}[${index}]`;
  yield* requireText(`${field}.testAsWritten`, result.testAsWritten);
  yield* requireIsoDate(`${field}.collected`, result.collected);
  const flag = result.flag ?? null;
  if (flag !== null) yield* requireChoice(`${field}.flag`, flag, LAB_FLAGS);
  const { value } = result;
  const valueText = result.valueText ?? "";
  const written = valueText.trim() === "" ? null : valueText;
  // A result is a finite number or, when it is not a number, what the sheet says; never neither.
  if (value === null ? written === null : !Number.isFinite(value)) {
    return yield* new InvalidLabValueError({ field: `${field}.value` });
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

interface LabRow extends Omit<Lab, "isBaseline"> {
  readonly isBaseline: number;
}

const toLab = (row: LabRow): Lab => ({ ...row, isBaseline: row.isBaseline === 1 });

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
    /** Case-insensitive substring over the name and its other spellings. */
    readonly searchPatients: (
      query: string,
    ) => Effect.Effect<ReadonlyArray<Patient>, PatientStoreError>;
    readonly createPatient: (input: {
      readonly name: string;
      readonly urn?: string | null | undefined;
      readonly sex?: PatientSex | null | undefined;
      readonly dateOfBirth?: string | null | undefined;
      readonly diagnoses?: string | undefined;
      readonly alsoWrittenAs?: ReadonlyArray<string> | undefined;
    }) => Effect.Effect<Patient, PatientUrnTakenError | InputError | PatientStoreError>;
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
    ) => Effect.Effect<
      Note,
      PatientNotFoundError | InvalidDateError | InvalidChoiceError | PatientStoreError
    >;
    /**
     * Files results as drafts of one note in one transaction and sets their baseline fields. The
     * baseline is the patient's earliest-collected numeric result for the test; Inbox results
     * have none. `patientId` must be the note's patient, or null for a note in the Inbox.
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
     * labs or plans, each with its draft counts. Latest change first.
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
     * Upcoming: draft and planned plans of every patient and of the Inbox, soonest due first,
     * optionally only those due from `from` to `to`, both included.
     */
    readonly listUpcomingPlans: (range?: {
      readonly from?: string | undefined;
      readonly to?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<UpcomingPlan>, InvalidDateError | PatientStoreError>;
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
    /** `moveNoteToPatient` for the Inbox note of a thread. */
    readonly moveThreadNoteToPatient: (input: {
      readonly threadId: string;
      readonly patientId: string;
    }) => Effect.Effect<
      Note,
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
    /** `verifyNote` for the note a thread has for a patient. */
    readonly verifyThreadNote: (input: {
      readonly threadId: string;
      readonly patientId: string;
    }) => Effect.Effect<
      Verified,
      ThreadNoteNotFoundError | NoteNotFoundError | NoteInInboxError | PatientStoreError
    >;
    /**
     * What an agent files for one message, in one transaction: the thread's note for the patient
     * (or its Inbox note), the results and plans as drafts of that note, the note's files, and
     * the link from the thread to the patient when there is one.
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
      PatientNotFoundError | InputError | PatientStoreError
    >;
    /** Adds the files the note does not have yet, by path, and returns all it has. */
    readonly addNoteFiles: (input: {
      readonly noteId: string;
      readonly files: ReadonlyArray<NoteFileInput>;
    }) => Effect.Effect<
      ReadonlyArray<NoteFile>,
      NoteNotFoundError | BlankFieldError | PatientStoreError
    >;
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
    COALESCE(
      (SELECT MAX(n.updated_at) FROM notes n WHERE n.patient_id = p.id),
      p.created_at
    ) AS "lastActivityAt"
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

  const selectLabs = (where: Fragment) =>
    sql<LabRow>`
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
      l.updated_at AS "updatedAt"
    FROM labs l
    JOIN lab_tests t ON t.id = l.lab_test_id
    WHERE ${where}
    ORDER BY l.collected ASC, l.id ASC
  `.pipe(failedIn("selectLabs:query"));

  const planColumns = sql`
    pl.id AS "id",
    pl.patient_id AS "patientId",
    pl.title AS "title",
    pl.due AS "due",
    pl.type AS "type",
    pl.status AS "status",
    pl.source_note_id AS "sourceNoteId",
    pl.created_at AS "createdAt",
    pl.updated_at AS "updatedAt"
  `;

  const selectPlans = (where: Fragment) =>
    sql<Plan>`
      SELECT ${planColumns} FROM plans pl WHERE ${where} ORDER BY pl.due ASC, pl.id ASC
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
      WHERE l.patient_id = ${patientId} AND l.lab_test_id = ${labTestId}
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
      return yield* new PatientUrnTakenError({ patientId: holder.value.id });
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
    if (existing === undefined) {
      yield* sql`
        INSERT INTO notes ${sql.insert({
          id: noteId,
          patient_id: input.patientId,
          thread_id: input.threadId,
          title: input.title,
          date: input.date ?? (yield* today),
          kind: input.kind ?? "chat",
          summary: input.summary ?? "",
          needs_you: input.needsYou ?? "",
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("upsertThreadNote:insert"));
    } else {
      yield* sql`
        UPDATE notes SET ${sql.update({
          title: input.title,
          ...(input.date === undefined ? {} : { date: input.date }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.needsYou === undefined ? {} : { needs_you: input.needsYou }),
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
    const filed: Array<{ readonly id: string; readonly labTestId: string }> = [];
    for (const { category, ...result } of results) {
      const labTestId = yield* catalogueTest(result.test_as_written, category, at);
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
      filed.push({ id, labTestId });
    }
    if (filed.length === 0) return [];
    yield* touchNote(sourceNoteId, at);
    for (const labTestId of new Set(filed.map((lab) => lab.labTestId))) {
      yield* recomputeBaseline(patientId, labTestId);
    }
    const rows = yield* selectLabs(sql`l.id IN ${sql.in(filed.map((lab) => lab.id))}`);
    const byId = new Map(rows.map((row) => [row.id, toLab(row)]));
    return filed.flatMap(({ id }) => {
      const lab = byId.get(id);
      return lab === undefined ? [] : [lab];
    });
  });

  const insertPlans = Effect.fn("PatientStore.insertPlans")(function* (
    patientId: string | null,
    sourceNoteId: string,
    plans: ReadonlyArray<PlanInput>,
    at: string,
  ) {
    const ids: Array<string> = [];
    for (const plan of plans) {
      const id = yield* newId;
      yield* sql`
        INSERT INTO plans ${sql.insert({
          id,
          patient_id: patientId,
          title: plan.title.trim(),
          due: plan.due,
          type: plan.type,
          status: "draft",
          source_note_id: sourceNoteId,
          created_at: at,
          updated_at: at,
        })}
      `.pipe(failedIn("filePlans:insert"));
      ids.push(id);
    }
    if (ids.length === 0) return [];
    yield* touchNote(sourceNoteId, at);
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
    if (note.threadId !== null) yield* writeThreadLink(note.threadId, patientId, at);
    return yield* readNote(keptId);
  });

  const requireThreadNote = Effect.fn("PatientStore.requireThreadNote")(function* (
    threadId: string,
    patientId: string | null,
  ) {
    const note = (yield* threadNoteOf(threadId, patientId))[0];
    return note?.id ?? (yield* new ThreadNoteNotFoundError({ patientId }));
  });

  const verify = Effect.fn("PatientStore.verify")(function* (noteId: string, at: string) {
    const { patientId } = yield* readNote(noteId);
    if (patientId === null) return yield* new NoteInInboxError({ noteId });
    const labs = yield* sql`
      UPDATE labs SET status = 'verified', updated_at = ${at}
      WHERE source_note_id = ${noteId} AND status = 'draft'
      RETURNING id
    `.pipe(failedIn("verifyNote:updateLabs"));
    const plans = yield* sql`
      UPDATE plans SET status = 'planned', updated_at = ${at}
      WHERE source_note_id = ${noteId} AND status = 'draft'
      RETURNING id
    `.pipe(failedIn("verifyNote:updatePlans"));
    const patients = yield* sql`
      UPDATE patients SET status = 'active', updated_at = ${at}
      WHERE id = ${patientId} AND status = 'new'
      RETURNING id
    `.pipe(failedIn("verifyNote:updatePatient"));
    if (labs.length + plans.length + patients.length > 0) yield* touchNote(noteId, at);
    return {
      labsVerified: labs.length,
      plansPlanned: plans.length,
      patientActivated: patients.length > 0,
    };
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

  return PatientStore.of({
    findPatientByUrn: Effect.fn("PatientStore.findPatientByUrn")(function* (urn) {
      return yield* readPatientByUrnKey(urnKey(urn));
    }),

    findPatient: Effect.fn("PatientStore.findPatient")(function* (query) {
      const urn = query.urn?.trim() ?? "";
      const name = query.name?.trim() ?? "";
      if (urn === "" && name === "") return yield* new BlankFieldError({ field: "urn or name" });
      const match = yield* readPatientByUrnKey(urnKey(urn));
      const candidates = Option.isSome(match) || name === "" ? [] : yield* searchPatients(name);
      return { match, candidates };
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
        labs: labs.map(toLab),
        plans: yield* selectPlans(sql`patient_id = ${patient.id}`),
        notes: notes.map((note) => ({
          ...note,
          files: files.filter((file) => file.noteId === note.id),
        })),
      };
    }),

    listPatients,

    searchPatients,

    createPatient: Effect.fn("PatientStore.createPatient")(function* (input) {
      yield* requireText("name", input.name);
      const sex = input.sex ?? null;
      if (sex !== null) yield* requireChoice("sex", sex, PATIENT_SEXES);
      const dateOfBirth = input.dateOfBirth ?? null;
      if (dateOfBirth !== null) yield* requireIsoDate("dateOfBirth", dateOfBirth);
      const id = yield* newId;
      const at = yield* now;
      const name = tidy(input.name);
      const spellings = (input.alsoWrittenAs ?? []).reduce<ReadonlyArray<string>>(
        (known, spelling) => addSpelling(known, name, spelling),
        [],
      );
      return yield* Effect.gen(function* () {
        yield* sql`
          INSERT INTO patients ${sql.insert({
            id,
            name,
            ...(yield* urnColumns(input.urn ?? null)),
            status: "new",
            sex,
            date_of_birth: dateOfBirth,
            diagnoses: input.diagnoses ?? "",
            also_written_as: spellings.join("\n"),
            created_at: at,
            updated_at: at,
          })}
        `.pipe(failedIn("createPatient:insert"));
        // The row was written in this transaction, so only its absence is a defect.
        return yield* readPatient(id).pipe(
          Effect.catchTags({ PatientNotFoundError: (error) => Effect.die(error) }),
        );
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("createPatient")));
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
        const renamed =
          name === undefined ? patient.alsoWrittenAs : spellingsAfterRename(patient, name);
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
        checkLabResult(result, index, "results"),
      );
      const at = yield* now;
      return yield* requireFilingTarget(patientId, sourceNoteId).pipe(
        Effect.andThen(insertLabs(patientId, sourceNoteId, results, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("fileLabs")),
      );
    }),

    listLabs: Effect.fn("PatientStore.listLabs")(function* (filter) {
      const rows = yield* selectLabs(
        sql.and([
          ownedBy(sql`l.patient_id`, filter),
          ...(filter.sourceNoteId === undefined
            ? []
            : [sql`l.source_note_id = ${filter.sourceNoteId}`]),
        ]),
      );
      return rows.map(toLab);
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
        SELECT * FROM (
          SELECT
            ${noteColumns},
            (SELECT COUNT(*) FROM labs l WHERE l.source_note_id = notes.id AND l.status = 'draft')
              AS "draftLabs",
            (SELECT COUNT(*) FROM plans pl WHERE pl.source_note_id = notes.id AND pl.status = 'draft')
              AS "draftPlans"
          FROM notes
        )
        WHERE "patientId" IS NULL OR TRIM("needsYou") <> '' OR "draftLabs" > 0 OR "draftPlans" > 0
        ORDER BY "updatedAt" DESC, "id" DESC
      `.pipe(failedIn("listNeedsYou:query"));
      const sum = (notes: ReadonlyArray<WaitingNote>, count: "draftLabs" | "draftPlans") =>
        notes.reduce((total, note) => total + note[count], 0);
      const patients = yield* listPatients();
      return {
        inbox: waiting.filter((note) => note.patientId === null),
        patients: patients.flatMap((patient) => {
          const notes = waiting.filter((note) => note.patientId === patient.id);
          return notes.length === 0
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

    listUpcomingPlans: Effect.fn("PatientStore.listUpcomingPlans")(function* (range = {}) {
      const { from, to } = range;
      if (from !== undefined) yield* requireIsoDate("from", from);
      if (to !== undefined) yield* requireIsoDate("to", to);
      return yield* sql<UpcomingPlan>`
        SELECT ${planColumns}, p.name AS "patientName"
        FROM plans pl
        LEFT JOIN patients p ON p.id = pl.patient_id
        WHERE ${sql.and([
          sql`pl.status IN ('draft', 'planned')`,
          ...(from === undefined ? [] : [sql`pl.due >= ${from}`]),
          ...(to === undefined ? [] : [sql`pl.due <= ${to}`]),
        ])}
        ORDER BY pl.due ASC, pl.id ASC
      `.pipe(failedIn("listUpcomingPlans:query"));
    }),

    moveNoteToPatient: Effect.fn("PatientStore.moveNoteToPatient")(function* (input) {
      const at = yield* now;
      return yield* moveNote(input.noteId, input.patientId, at).pipe(
        sql.withTransaction,
        Effect.catchTags(transactionFailure("moveNoteToPatient")),
      );
    }),

    moveThreadNoteToPatient: Effect.fn("PatientStore.moveThreadNoteToPatient")(function* (input) {
      const at = yield* now;
      return yield* requireThreadNote(input.threadId, null).pipe(
        Effect.flatMap((noteId) => moveNote(noteId, input.patientId, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("moveThreadNoteToPatient")),
      );
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
      return yield* requireThreadNote(input.threadId, input.patientId).pipe(
        Effect.flatMap((noteId) => verify(noteId, at)),
        sql.withTransaction,
        Effect.catchTags(transactionFailure("verifyThreadNote")),
      );
    }),

    fileFromThread: Effect.fn("PatientStore.fileFromThread")(function* (input) {
      const { threadId, patientId } = input;
      yield* requireText("threadId", threadId);
      yield* requireText("title", input.title);
      yield* checkThreadNote(input);
      const labs = yield* Effect.forEach(input.labs ?? [], (result, index) =>
        checkLabResult(result, index, "labs"),
      );
      const plans = input.plans ?? [];
      yield* Effect.forEach(plans, checkPlan);
      const files = input.files ?? [];
      yield* Effect.forEach(files, checkNoteFile);
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const note = yield* writeThreadNote(input, at);
        const filed = {
          note,
          labs: yield* insertLabs(patientId, note.id, labs, at),
          plans: yield* insertPlans(patientId, note.id, plans, at),
          files: yield* insertNoteFiles(note.id, files, at),
        };
        if (patientId !== null) yield* writeThreadLink(threadId, patientId, at);
        return filed;
      }).pipe(sql.withTransaction, Effect.catchTags(transactionFailure("fileFromThread")));
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
      const rows = yield* sql<PatientRow>`
        SELECT ${patientColumns}
        FROM thread_patients t
        JOIN patients p ON p.id = t.patient_id
        WHERE t.thread_id = ${threadId}
      `.pipe(failedIn("getThreadPatient:query"));
      return Option.map(Option.fromNullishOr(rows[0]), toPatient);
    }),
  });
});

export const layer = Layer.effect(PatientStore, make);
