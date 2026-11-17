/**
 * T3 Med: the patient database: a second SQLite file beside the server's own. Fork migrations in the
 * server's database would collide with upstream's numbered migrations, so patient tables live in
 * `t3med.sqlite` with their own migration list and their own tag, apart from `SqlClient`.
 */
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import Migration0001 from "./Migrations/001_PatientStore.ts";
import Migration0002 from "./Migrations/002_ThreadPatientsByPatient.ts";
import Migration0003 from "./Migrations/003_Corrections.ts";
import Migration0004 from "./Migrations/004_WaysBack.ts";

export class MedDatabaseOpenError extends Schema.TaggedError<MedDatabaseOpenError>()(
  "MedDatabaseOpenError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The patient database at ${this.path} could not be opened or migrated.`;
  }
}

export class MedDatabase extends Context.Service<MedDatabase, SqlClient.SqlClient>()(
  "t3/med/MedDatabase",
) {}

const runMigrations = Migrator.make({})({
  loader: Migrator.fromRecord({
    "1_PatientStore": Migration0001,
    "2_ThreadPatientsByPatient": Migration0002,
    "3_Corrections": Migration0003,
    "4_WaysBack": Migration0004,
  }),
  table: "t3med_migrations",
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Synchronous stays at FULL: patient writes are rare, and none may be lost to a power cut.
  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`PRAGMA foreign_keys = ON;`;
  yield* sql`PRAGMA journal_mode = WAL;`;
  yield* runMigrations;
  return sql;
}).pipe(Effect.withSpan("MedDatabase.setup"));

export const layerFromPath = Effect.fn("MedDatabase.layerFromPath")(
  function* (dbPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

    return Layer.effect(MedDatabase, make).pipe(
      Layer.provide(
        NodeSqliteClient.layer({
          filename: dbPath,
          spanAttributes: { "db.name": path.basename(dbPath), "service.name": "t3code-server" },
        }),
      ),
    );
  },
  Layer.unwrap,
  // Startup stops on this failure, so its message has to say which file to look at.
  (layer, dbPath) =>
    Layer.catch(layer, (cause) =>
      Layer.effect(MedDatabase, Effect.fail(new MedDatabaseOpenError({ path: dbPath, cause }))),
    ),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerFromPath(path.join(stateDir, "t3med.sqlite"));
  }),
);
