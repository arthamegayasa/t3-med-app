import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The ways back: a removed row stays for undo, a corrected result keeps what it said before,
// and a closed plan remembers the day it was done and what reopening returns it to.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE labs ADD COLUMN removed_at TEXT`;
  yield* sql`ALTER TABLE plans ADD COLUMN removed_at TEXT`;
  yield* sql`ALTER TABLE plans ADD COLUMN done_on TEXT`;
  yield* sql`
    ALTER TABLE plans ADD COLUMN reopens_as TEXT CHECK (reopens_as IN ('draft', 'planned'))
  `;

  yield* sql`
    CREATE TABLE lab_revisions (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL REFERENCES labs (id) ON DELETE CASCADE,
      lab_test_id TEXT NOT NULL REFERENCES lab_tests (id),
      test_as_written TEXT NOT NULL,
      value REAL,
      value_text TEXT NOT NULL,
      unit TEXT NOT NULL,
      reference_range TEXT NOT NULL,
      flag TEXT CHECK (flag IN ('low', 'normal', 'high')),
      collected TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'verified')),
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX lab_revisions_lab ON lab_revisions (lab_id)`;
});
