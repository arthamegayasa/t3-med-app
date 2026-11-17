// T3 Med: the patient tables: patients, the lab catalogue, notes, labs, plans and note files.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      urn TEXT,
      urn_key TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'active', 'archived')),
      sex TEXT CHECK (sex IN ('female', 'male')),
      date_of_birth TEXT,
      diagnoses TEXT NOT NULL DEFAULT '',
      also_written_as TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE lab_tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      test_id TEXT UNIQUE,
      category TEXT NOT NULL DEFAULT '',
      also_written_as TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      patient_id TEXT REFERENCES patients (id),
      thread_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (
        kind IN ('chat', 'lab_sheet', 'imaging_report', 'clinical_note', 'other')
      ),
      summary TEXT NOT NULL DEFAULT '',
      needs_you TEXT NOT NULL DEFAULT '',
      local_file TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  // A thread has one chat note per patient, and one more while it is still in the Inbox.
  yield* sql`
    CREATE UNIQUE INDEX notes_chat_thread_patient
    ON notes (thread_id, COALESCE(patient_id, ''))
    WHERE kind = 'chat' AND thread_id IS NOT NULL
  `;
  yield* sql`CREATE INDEX notes_patient ON notes (patient_id, updated_at)`;

  yield* sql`
    CREATE TABLE note_files (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX note_files_note ON note_files (note_id)`;

  yield* sql`
    CREATE TABLE labs (
      id TEXT PRIMARY KEY,
      patient_id TEXT REFERENCES patients (id),
      lab_test_id TEXT NOT NULL REFERENCES lab_tests (id),
      test_as_written TEXT NOT NULL,
      value REAL,
      value_text TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      reference_range TEXT NOT NULL DEFAULT '',
      flag TEXT CHECK (flag IN ('low', 'normal', 'high')),
      collected TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified')),
      is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
      value_in_baseline_unit REAL,
      change_from_baseline REAL,
      change_percent REAL,
      lab TEXT NOT NULL DEFAULT '',
      source_note_id TEXT NOT NULL REFERENCES notes (id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX labs_patient_test ON labs (patient_id, lab_test_id, collected)`;
  yield* sql`CREATE INDEX labs_source_note ON labs (source_note_id)`;

  yield* sql`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      patient_id TEXT REFERENCES patients (id),
      title TEXT NOT NULL,
      due TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('follow_up', 'lab', 'imaging', 'procedure', 'other')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'planned', 'done', 'cancelled')
      ),
      source_note_id TEXT NOT NULL REFERENCES notes (id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX plans_patient ON plans (patient_id, due)`;
  yield* sql`CREATE INDEX plans_source_note ON plans (source_note_id)`;

  yield* sql`
    CREATE TABLE thread_patients (
      thread_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients (id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
