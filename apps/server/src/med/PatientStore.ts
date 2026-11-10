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

export type PatientStatus = "new" | "active" | "archived";
export type PatientSex = "female" | "male";
export type NoteKind = "chat" | "lab_sheet" | "imaging_report" | "clinical_note" | "other";

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
  /** The patient's latest note, or when the patient was created. */
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

export type LabFlag = "low" | "normal" | "high";

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
  readonly sourceNoteId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LabResultInput {
  readonly testAsWritten: string;
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

export type PlanType = "follow_up" | "lab" | "imaging" | "procedure" | "other";

export interface Plan {
  readonly id: string;
  readonly patientId: string | null;
  readonly title: string;
  readonly due: string;
  readonly type: PlanType;
  readonly status: "draft" | "planned" | "done" | "cancelled";
  readonly sourceNoteId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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

export class ThreadNoteExistsError extends Schema.TaggedError<ThreadNoteExistsError>()(
  "ThreadNoteExistsError",
  { noteId: Schema.String },
) {
  override get message(): string {
    return `The thread already has note ${this.noteId} for this patient.`;
  }
}

export class InvalidDateError extends Schema.TaggedError<InvalidDateError>()("InvalidDateError", {
  field: Schema.String,
}) {
  override get message(): string {
    return `${this.field} must be a calendar date written as YYYY-MM-DD.`;
  }
}

/** A URN in upper case with everything but letters and digits removed. */
export const urnKey = (urn: string): string => urn.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

const spellingKey = (spelling: string) => spelling.trim().replace(/\s+/g, " ").toLowerCase();

const splitSpellings = (text: string) => text.split("\n").filter((spelling) => spelling !== "");

const addSpelling = (spellings: ReadonlyArray<string>, name: string, spelling: string) => {
  const written = spelling.trim().replace(/\s+/g, " ");
  const known = new Set([name, ...spellings].map(spellingKey));
  return written === "" || known.has(spellingKey(written)) ? spellings : [...spellings, written];
};

// Round-tripping rejects dates the calendar does not have, such as 2026-02-30.
const isIsoDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Option.exists(
    DateTime.make(`${date}T00:00:00.000Z`),
    (parsed) => DateTime.formatIsoDateUtc(parsed) === date,
  );

const requireIsoDate = (field: string, date: string | null | undefined) =>
  date === null || date === undefined || isIsoDate(date)
    ? Effect.void
    : Effect.fail(new InvalidDateError({ field }));

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
  | InvalidDateError
  | PatientStoreError;

export class PatientStore extends Context.Service<
  PatientStore,
  {
    /** Exact match on the URN key only; a name never finds a patient here. */
    readonly findPatientByUrn: (
      urn: string,
    ) => Effect.Effect<Option.Option<Patient>, PatientStoreError>;
    readonly getPatient: (
      patientId: string,
    ) => Effect.Effect<Patient, PatientNotFoundError | PatientStoreError>;
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
    }) => Effect.Effect<Patient, PatientUrnTakenError | InvalidDateError | PatientStoreError>;
    readonly updatePatient: (
      patientId: string,
      fields: {
        readonly name?: string | undefined;
        readonly urn?: string | null | undefined;
        readonly status?: PatientStatus | undefined;
        readonly sex?: PatientSex | null | undefined;
        readonly dateOfBirth?: string | null | undefined;
        readonly diagnoses?: string | undefined;
      },
    ) => Effect.Effect<
      Patient,
      PatientNotFoundError | PatientUrnTakenError | InvalidDateError | PatientStoreError
    >;
    readonly addPatientSpelling: (
      patientId: string,
      spelling: string,
    ) => Effect.Effect<Patient, PatientNotFoundError | PatientStoreError>;
    /** The chat note of one thread for one patient, or for the Inbox when the patient is null. */
    readonly upsertThreadNote: (input: {
      readonly threadId: string;
      readonly patientId: string | null;
      readonly title: string;
      readonly date: string;
      readonly summary?: string | undefined;
      readonly needsYou?: string | undefined;
    }) => Effect.Effect<Note, PatientNotFoundError | InvalidDateError | PatientStoreError>;
    /**
     * Files results as drafts in one transaction and sets their baseline fields. The baseline is
     * the patient's earliest-collected numeric result for the test; Inbox results have none.
     */
    readonly fileLabs: (input: {
      readonly patientId: string | null;
      readonly sourceNoteId?: string | null | undefined;
      readonly results: ReadonlyArray<LabResultInput>;
    }) => Effect.Effect<ReadonlyArray<Lab>, FilingError>;
    /** Oldest collected first. */
    readonly listLabs: (filter: {
      readonly patientId?: string | undefined;
      readonly sourceNoteId?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<Lab>, PatientStoreError>;
    readonly listLabTests: () => Effect.Effect<ReadonlyArray<LabTest>, PatientStoreError>;
    readonly filePlans: (input: {
      readonly patientId: string | null;
      readonly sourceNoteId?: string | null | undefined;
      readonly plans: ReadonlyArray<{
        readonly title: string;
        readonly due: string;
        readonly type: PlanType;
      }>;
    }) => Effect.Effect<ReadonlyArray<Plan>, FilingError>;
    /** Soonest due first. */
    readonly listPlans: (filter: {
      readonly patientId?: string | undefined;
      readonly sourceNoteId?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<Plan>, PatientStoreError>;
    /** Gives the note, and the labs and plans filed from it, to a patient; the labs get baselines. */
    readonly moveNoteToPatient: (input: {
      readonly noteId: string;
      readonly patientId: string;
    }) => Effect.Effect<
      Note,
      | NoteNotFoundError
      | NoteNotInInboxError
      | ThreadNoteExistsError
      | PatientNotFoundError
      | PatientStoreError
    >;
    /** The doctor's confirmation: the note's draft labs and plans, and a new patient, become real. */
    readonly verifyNote: (noteId: string) => Effect.Effect<
      {
        readonly labsVerified: number;
        readonly plansPlanned: number;
        readonly patientActivated: boolean;
      },
      NoteNotFoundError | NoteInInboxError | PatientStoreError
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
  // Version 7 ids sort in the order they were made, which breaks ties between rows of one day.
  const newId = random.uuidV7();

  const sqlFailure = (operation: string) => ({
    SqlError: (cause: SqlError) => Effect.fail(new PatientStoreError({ operation, cause })),
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
    `;
    const row = rows[0];
    return row === undefined ? yield* new PatientNotFoundError({ patientId }) : toPatient(row);
  });

  const readNote = Effect.fn("PatientStore.readNote")(function* (noteId: string) {
    const rows = yield* sql<Note>`SELECT ${noteColumns} FROM notes WHERE id = ${noteId}`;
    return rows[0] ?? (yield* new NoteNotFoundError({ noteId }));
  });

  // Rows filed from a note share its patient, so moving or verifying the note covers them all.
  const requireFilingTarget = Effect.fn("PatientStore.requireFilingTarget")(function* (
    patientId: string | null,
    sourceNoteId: string | null,
  ) {
    if (patientId !== null) yield* readPatient(patientId);
    if (sourceNoteId === null) return;
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

  const selectLabs = (where: Fragment) => sql<LabRow>`
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
  `;

  const selectPlans = (where: Fragment) => sql<Plan>`
    SELECT
      id AS "id",
      patient_id AS "patientId",
      title AS "title",
      due AS "due",
      type AS "type",
      status AS "status",
      source_note_id AS "sourceNoteId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM plans
    WHERE ${where}
    ORDER BY due ASC, id ASC
  `;

  const chatNoteOf = (threadId: string, patientId: string | null) => sql<{ readonly id: string }>`
    SELECT id FROM notes
    WHERE kind = 'chat'
      AND thread_id = ${threadId}
      AND COALESCE(patient_id, '') = ${patientId ?? ""}
  `;

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
    `;
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
      `;
      return id;
    }
    const spellings = addSpelling(known.alsoWrittenAs, known.name, written);
    if (spellings !== known.alsoWrittenAs) {
      yield* sql`
        UPDATE lab_tests
        SET also_written_as = ${spellings.join("\n")}, updated_at = ${at}
        WHERE id = ${known.id}
      `;
    }
    return known.id;
  });

  // Derives the baseline fields of every row one patient has for one test. Running it over all
  // of them is what lets an older result take over as baseline.
  const recomputeBaseline = Effect.fn("PatientStore.recomputeBaseline")(function* (
    patientId: string,
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
    `;
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
      `;
    }
  });

  const readPatientByUrnKey = Effect.fn("PatientStore.readPatientByUrnKey")(function* (
    key: string,
  ) {
    if (key === "") return Option.none<Patient>();
    const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns} FROM patients p WHERE p.urn_key = ${key}
    `;
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

  const listPatients: PatientStore["Service"]["listPatients"] = Effect.fn(
    "PatientStore.listPatients",
  )(
    function* () {
      const rows = yield* sql<PatientRow>`
      SELECT ${patientColumns} FROM patients p ORDER BY "lastActivityAt" DESC, p.name ASC
    `;
      return rows.map(toPatient);
    },
    Effect.catchTags(sqlFailure("listPatients")),
  );

  return PatientStore.of({
    findPatientByUrn: Effect.fn("PatientStore.findPatientByUrn")(
      function* (urn) {
        return yield* readPatientByUrnKey(urnKey(urn));
      },
      Effect.catchTags(sqlFailure("findPatientByUrn")),
    ),

    getPatient: Effect.fn("PatientStore.getPatient")(
      function* (patientId) {
        return yield* readPatient(patientId);
      },
      Effect.catchTags(sqlFailure("getPatient")),
    ),

    listPatients,

    searchPatients: Effect.fn("PatientStore.searchPatients")(function* (query) {
      // Filtered here, not with LIKE: SQLite folds case for ASCII letters only.
      const wanted = spellingKey(query);
      const patients = yield* listPatients();
      return patients.filter((patient) =>
        [patient.name, ...patient.alsoWrittenAs].some((spelling) =>
          spellingKey(spelling).includes(wanted),
        ),
      );
    }),

    createPatient: Effect.fn("PatientStore.createPatient")(function* (input) {
      yield* requireIsoDate("dateOfBirth", input.dateOfBirth);
      const id = yield* newId;
      const at = yield* now;
      const name = input.name.trim().replace(/\s+/g, " ");
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
            sex: input.sex ?? null,
            date_of_birth: input.dateOfBirth ?? null,
            diagnoses: input.diagnoses ?? "",
            also_written_as: spellings.join("\n"),
            created_at: at,
            updated_at: at,
          })}
        `;
        return yield* readPatient(id).pipe(Effect.orDie);
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("createPatient")));
    }),

    updatePatient: Effect.fn("PatientStore.updatePatient")(function* (patientId, fields) {
      yield* requireIsoDate("dateOfBirth", fields.dateOfBirth);
      const at = yield* now;
      return yield* Effect.gen(function* () {
        yield* readPatient(patientId);
        yield* sql`
          UPDATE patients SET ${sql.update({
            ...(fields.name === undefined ? {} : { name: fields.name.trim().replace(/\s+/g, " ") }),
            ...(fields.urn === undefined ? {} : yield* urnColumns(fields.urn, patientId)),
            ...(fields.status === undefined ? {} : { status: fields.status }),
            ...(fields.sex === undefined ? {} : { sex: fields.sex }),
            ...(fields.dateOfBirth === undefined ? {} : { date_of_birth: fields.dateOfBirth }),
            ...(fields.diagnoses === undefined ? {} : { diagnoses: fields.diagnoses }),
            updated_at: at,
          })}
          WHERE id = ${patientId}
        `;
        return yield* readPatient(patientId);
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("updatePatient")));
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
        `;
          return yield* readPatient(patientId);
        }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("addPatientSpelling")));
      },
    ),

    upsertThreadNote: Effect.fn("PatientStore.upsertThreadNote")(function* (input) {
      yield* requireIsoDate("date", input.date);
      const id = yield* newId;
      const at = yield* now;
      return yield* Effect.gen(function* () {
        if (input.patientId !== null) yield* readPatient(input.patientId);
        const existing = yield* chatNoteOf(input.threadId, input.patientId);
        const noteId = existing[0]?.id ?? id;
        if (existing[0] === undefined) {
          yield* sql`
            INSERT INTO notes ${sql.insert({
              id,
              patient_id: input.patientId,
              thread_id: input.threadId,
              title: input.title,
              date: input.date,
              kind: "chat",
              summary: input.summary ?? "",
              needs_you: input.needsYou ?? "",
              created_at: at,
              updated_at: at,
            })}
          `;
        } else {
          yield* sql`
            UPDATE notes SET ${sql.update({
              title: input.title,
              date: input.date,
              ...(input.summary === undefined ? {} : { summary: input.summary }),
              ...(input.needsYou === undefined ? {} : { needs_you: input.needsYou }),
              updated_at: at,
            })}
            WHERE id = ${noteId}
          `;
        }
        return yield* readNote(noteId).pipe(Effect.orDie);
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("upsertThreadNote")));
    }),

    fileLabs: Effect.fn("PatientStore.fileLabs")(function* (input) {
      yield* Effect.forEach(
        input.results,
        (result) => requireIsoDate("collected", result.collected),
        {
          discard: true,
        },
      );
      const at = yield* now;
      const sourceNoteId = input.sourceNoteId ?? null;
      return yield* Effect.gen(function* () {
        yield* requireFilingTarget(input.patientId, sourceNoteId);
        const filed: Array<{ readonly id: string; readonly labTestId: string }> = [];
        for (const result of input.results) {
          const written = result.testAsWritten.trim().replace(/\s+/g, " ");
          const labTestId = yield* catalogueTest(written, result.category ?? "", at);
          const id = yield* newId;
          const value =
            result.value !== null && Number.isFinite(result.value) ? result.value : null;
          yield* sql`
            INSERT INTO labs ${sql.insert({
              id,
              patient_id: input.patientId,
              lab_test_id: labTestId,
              test_as_written: written,
              value,
              value_text: result.valueText ?? (value === null ? "" : String(value)),
              unit: result.unit?.trim() ?? "",
              reference_range: result.referenceRange ?? "",
              flag: result.flag ?? null,
              collected: result.collected,
              status: "draft",
              lab: result.lab ?? "",
              source_note_id: sourceNoteId,
              created_at: at,
              updated_at: at,
            })}
          `;
          filed.push({ id, labTestId });
        }
        if (filed.length === 0) return [];
        if (input.patientId !== null) {
          for (const labTestId of new Set(filed.map((lab) => lab.labTestId))) {
            yield* recomputeBaseline(input.patientId, labTestId);
          }
        }
        const rows = yield* selectLabs(sql`l.id IN ${sql.in(filed.map((lab) => lab.id))}`);
        const byId = new Map(rows.map((row) => [row.id, toLab(row)]));
        return filed.flatMap(({ id }) => {
          const lab = byId.get(id);
          return lab === undefined ? [] : [lab];
        });
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("fileLabs")));
    }),

    listLabs: Effect.fn("PatientStore.listLabs")(
      function* (filter) {
        const rows = yield* selectLabs(
          sql.and([
            sql`1 = 1`,
            ...(filter.patientId === undefined ? [] : [sql`l.patient_id = ${filter.patientId}`]),
            ...(filter.sourceNoteId === undefined
              ? []
              : [sql`l.source_note_id = ${filter.sourceNoteId}`]),
          ]),
        );
        return rows.map(toLab);
      },
      Effect.catchTags(sqlFailure("listLabs")),
    ),

    listLabTests: Effect.fn("PatientStore.listLabTests")(
      function* () {
        const rows = yield* sql<LabTestRow>`
        SELECT ${labTestColumns} FROM lab_tests ORDER BY name ASC, id ASC
      `;
        return rows.map(toLabTest);
      },
      Effect.catchTags(sqlFailure("listLabTests")),
    ),

    filePlans: Effect.fn("PatientStore.filePlans")(function* (input) {
      yield* Effect.forEach(input.plans, (plan) => requireIsoDate("due", plan.due), {
        discard: true,
      });
      const at = yield* now;
      const sourceNoteId = input.sourceNoteId ?? null;
      return yield* Effect.gen(function* () {
        yield* requireFilingTarget(input.patientId, sourceNoteId);
        const ids: Array<string> = [];
        for (const plan of input.plans) {
          const id = yield* newId;
          yield* sql`
            INSERT INTO plans ${sql.insert({
              id,
              patient_id: input.patientId,
              title: plan.title.trim(),
              due: plan.due,
              type: plan.type,
              status: "draft",
              source_note_id: sourceNoteId,
              created_at: at,
              updated_at: at,
            })}
          `;
          ids.push(id);
        }
        if (ids.length === 0) return [];
        const rows = yield* selectPlans(sql`id IN ${sql.in(ids)}`);
        return ids.flatMap((id) => rows.filter((row) => row.id === id));
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("filePlans")));
    }),

    listPlans: Effect.fn("PatientStore.listPlans")(
      function* (filter) {
        return yield* selectPlans(
          sql.and([
            sql`1 = 1`,
            ...(filter.patientId === undefined ? [] : [sql`patient_id = ${filter.patientId}`]),
            ...(filter.sourceNoteId === undefined
              ? []
              : [sql`source_note_id = ${filter.sourceNoteId}`]),
          ]),
        );
      },
      Effect.catchTags(sqlFailure("listPlans")),
    ),

    moveNoteToPatient: Effect.fn("PatientStore.moveNoteToPatient")(function* (input) {
      const { noteId, patientId } = input;
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const note = yield* readNote(noteId);
        if (note.patientId !== null) return yield* new NoteNotInInboxError({ noteId });
        yield* readPatient(patientId);
        if (note.kind === "chat" && note.threadId !== null) {
          const taken = yield* chatNoteOf(note.threadId, patientId);
          if (taken[0] !== undefined) {
            return yield* new ThreadNoteExistsError({ noteId: taken[0].id });
          }
        }
        yield* sql`
          UPDATE notes SET patient_id = ${patientId}, updated_at = ${at} WHERE id = ${noteId}
        `;
        yield* sql`
          UPDATE plans SET patient_id = ${patientId}, updated_at = ${at}
          WHERE source_note_id = ${noteId}
        `;
        const tests = yield* sql<{ readonly labTestId: string }>`
          UPDATE labs SET patient_id = ${patientId}, updated_at = ${at}
          WHERE source_note_id = ${noteId}
          RETURNING lab_test_id AS "labTestId"
        `;
        for (const labTestId of new Set(tests.map((lab) => lab.labTestId))) {
          yield* recomputeBaseline(patientId, labTestId);
        }
        return yield* readNote(noteId);
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("moveNoteToPatient")));
    }),

    verifyNote: Effect.fn("PatientStore.verifyNote")(function* (noteId) {
      const at = yield* now;
      return yield* Effect.gen(function* () {
        const { patientId } = yield* readNote(noteId);
        if (patientId === null) return yield* new NoteInInboxError({ noteId });
        const labs = yield* sql`
          UPDATE labs SET status = 'verified', updated_at = ${at}
          WHERE source_note_id = ${noteId} AND status = 'draft'
          RETURNING id
        `;
        const plans = yield* sql`
          UPDATE plans SET status = 'planned', updated_at = ${at}
          WHERE source_note_id = ${noteId} AND status = 'draft'
          RETURNING id
        `;
        const patients = yield* sql`
          UPDATE patients SET status = 'active', updated_at = ${at}
          WHERE id = ${patientId} AND status = 'new'
          RETURNING id
        `;
        return {
          labsVerified: labs.length,
          plansPlanned: plans.length,
          patientActivated: patients.length > 0,
        };
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("verifyNote")));
    }),

    linkThread: Effect.fn("PatientStore.linkThread")(function* (input) {
      const at = yield* now;
      yield* Effect.gen(function* () {
        yield* readPatient(input.patientId);
        yield* sql`
          INSERT INTO thread_patients ${sql.insert({
            thread_id: input.threadId,
            patient_id: input.patientId,
            created_at: at,
            updated_at: at,
          })}
          ON CONFLICT (thread_id)
          DO UPDATE SET patient_id = excluded.patient_id, updated_at = excluded.updated_at
        `;
      }).pipe(sql.withTransaction, Effect.catchTags(sqlFailure("linkThread")));
    }),

    getThreadPatient: Effect.fn("PatientStore.getThreadPatient")(
      function* (threadId) {
        const rows = yield* sql<PatientRow>`
        SELECT ${patientColumns}
        FROM thread_patients t
        JOIN patients p ON p.id = t.patient_id
        WHERE t.thread_id = ${threadId}
      `;
        return Option.map(Option.fromNullishOr(rows[0]), toPatient);
      },
      Effect.catchTags(sqlFailure("getThreadPatient")),
    ),
  });
});

export const layer = Layer.effect(PatientStore, make);
