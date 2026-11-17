import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as MedDatabase from "./MedDatabase.ts";

const tableNames = Effect.gen(function* () {
  const sql = yield* MedDatabase.MedDatabase;
  const rows = yield* sql<{
    readonly name: string;
  }>`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`;
  return rows.map((row) => row.name);
});

it.layer(NodeServices.layer)("MedDatabase", (it) => {
  it.effect("keeps patient tables in t3med.sqlite beside the server's own database", () =>
    Effect.gen(function* () {
      const { dbPath, stateDir } = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      assert.deepStrictEqual(yield* tableNames, [
        "lab_revisions",
        "lab_tests",
        "labs",
        "note_files",
        "notes",
        "patients",
        "plans",
        "t3med_migrations",
        "thread_patients",
      ]);
      assert.isTrue(yield* fs.exists(path.join(stateDir, "t3med.sqlite")));
      assert.strictEqual(path.dirname(dbPath), stateDir);
      assert.isFalse(yield* fs.exists(dbPath));
    }).pipe(
      Effect.provide(
        MedDatabase.layerConfig.pipe(
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3med-db-test-" })),
        ),
      ),
    ),
  );

  it.effect("reopens an existing file without running its migrations again", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-db-test-" });
      const layer = MedDatabase.layerFromPath(path.join(directory, "t3med.sqlite"));

      yield* Effect.gen(function* () {
        const sql = yield* MedDatabase.MedDatabase;
        yield* sql`
          INSERT INTO patients (id, name, created_at, updated_at)
          VALUES ('p1', 'Wayan', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        `;
      }).pipe(Effect.provide(layer));

      const names = yield* Effect.gen(function* () {
        const sql = yield* MedDatabase.MedDatabase;
        return yield* sql<{ readonly name: string }>`SELECT name FROM patients`;
      }).pipe(Effect.provide(layer));
      assert.deepStrictEqual(names, [{ name: "Wayan" }]);
    }),
  );

  it.effect("names the file when it cannot be opened or migrated", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-db-test-" });
      const notADatabase = path.join(directory, "t3med.sqlite");
      yield* fs.writeFileString(notADatabase, "This is a text file, not a database.\n".repeat(200));
      const isADirectory = path.join(directory, "folder.sqlite");
      yield* fs.makeDirectory(isADirectory);

      for (const dbPath of [notADatabase, isADirectory]) {
        const error = yield* MedDatabase.MedDatabase.pipe(
          Effect.provide(MedDatabase.layerFromPath(dbPath)),
          Effect.flip,
        );
        assert.strictEqual(error._tag, "MedDatabaseOpenError");
        assert.strictEqual(
          error.message,
          `The patient database at ${dbPath} could not be opened or migrated.`,
        );
      }
    }),
  );

  // The service checks its inputs first, so only direct writes show what the schema itself refuses.
  it.effect("refuses duplicate keys and values outside a column's choices", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-db-test-" });
      const at = "2026-01-01T00:00:00.000Z";
      const rows = {
        patients: { id: "p1", name: "Wayan", urn_key: "A1", created_at: at, updated_at: at },
        lab_tests: { id: "t1", name: "LDL", test_id: "ldl", created_at: at, updated_at: at },
        notes: { id: "n1", date: "2026-01-01", kind: "chat", created_at: at, updated_at: at },
        labs: {
          id: "l1",
          lab_test_id: "t1",
          test_as_written: "LDL",
          collected: "2026-01-01",
          source_note_id: "n1",
          created_at: at,
          updated_at: at,
        },
        plans: {
          id: "q1",
          title: "Clinic visit",
          due: "2026-01-01",
          type: "follow_up",
          source_note_id: "n1",
          created_at: at,
          updated_at: at,
        },
      };
      const refusals: ReadonlyArray<readonly [keyof typeof rows, Record<string, unknown>, string]> =
        [
          ["patients", {}, "UniqueViolation"],
          ["patients", { urn_key: null }, "stored"],
          ["patients", { urn_key: null, status: "deleted" }, "ConstraintError"],
          ["patients", { urn_key: null, sex: "unknown" }, "ConstraintError"],
          ["lab_tests", {}, "UniqueViolation"],
          ["lab_tests", { test_id: null }, "stored"],
          ["notes", { kind: "letter" }, "ConstraintError"],
          ["labs", {}, "stored"],
          ["labs", { status: "final" }, "ConstraintError"],
          ["labs", { flag: "critical" }, "ConstraintError"],
          ["labs", { source_note_id: null }, "ConstraintError"],
          ["plans", {}, "stored"],
          ["plans", { type: "surgery" }, "ConstraintError"],
          ["plans", { status: "late" }, "ConstraintError"],
          ["plans", { source_note_id: null }, "ConstraintError"],
        ];

      yield* Effect.gen(function* () {
        const sql = yield* MedDatabase.MedDatabase;
        for (const [table, row] of Object.entries(rows)) {
          yield* sql`INSERT INTO ${sql(table)} ${sql.insert(row)}`;
        }
        // Each row is a stored one again under a new id, with the columns named changed.
        for (const [index, [table, change, expected]] of refusals.entries()) {
          const row = { ...rows[table], id: `again-${index}`, ...change };
          const outcome = yield* sql`INSERT INTO ${sql(table)} ${sql.insert(row)}`.pipe(
            Effect.match({ onFailure: (error) => error.reason._tag, onSuccess: () => "stored" }),
          );
          assert.strictEqual(outcome, expected, `${table} ${JSON.stringify(change)}`);
        }
      }).pipe(Effect.provide(MedDatabase.layerFromPath(path.join(directory, "t3med.sqlite"))));
    }),
  );
});
