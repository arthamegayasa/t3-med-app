import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The directory reads the threads linked to each patient, and the patient's page lists them.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX thread_patients_patient ON thread_patients (patient_id, updated_at)`;
});
