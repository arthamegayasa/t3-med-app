// T3 Med: what the ways back need to be exact. A patient brought back from the archive returns
// to the status held before; a question the doctor dealt with stops waiting and keeps its text;
// a correction says who made it. Rows from before this have none of the three recorded.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE patients ADD COLUMN archived_from TEXT CHECK (archived_from IN ('new', 'active'))
  `;
  yield* sql`ALTER TABLE notes ADD COLUMN needs_you_handled_at TEXT`;
  yield* sql`
    ALTER TABLE lab_revisions
    ADD COLUMN corrected_by TEXT CHECK (corrected_by IN ('doctor', 'agent'))
  `;
});
