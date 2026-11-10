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
});
