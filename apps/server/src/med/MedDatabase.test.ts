import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as MedDatabase from "./MedDatabase.ts";
import Migration0001 from "./Migrations/001_PatientStore.ts";
import Migration0002 from "./Migrations/002_ThreadPatientsByPatient.ts";
import Migration0003 from "./Migrations/003_Corrections.ts";
import * as PatientStore from "./PatientStore.ts";

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

  it.effect("brings a file filed into before corrections existed up to date, rows intact", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-db-test-" });
      const dbPath = path.join(directory, "t3med.sqlite");
      const at = "2026-11-01T00:00:00.000Z";

      // The file as the first two migrations left it, with a verified result and a plan in it.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({
          loader: Migrator.fromRecord({
            "1_PatientStore": Migration0001,
            "2_ThreadPatientsByPatient": Migration0002,
          }),
          table: "t3med_migrations",
        });
        yield* sql`
          INSERT INTO patients (id, name, status, created_at, updated_at)
          VALUES ('p1', 'Wayan', 'active', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO lab_tests (id, name, test_id, created_at, updated_at)
          VALUES ('t1', 'LDL', 'ldl', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO notes (id, patient_id, thread_id, title, date, kind, created_at, updated_at)
          VALUES ('n1', 'p1', 'thread-1', 'Labs', '2026-11-01', 'chat', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO labs (
            id, patient_id, lab_test_id, test_as_written, value, value_text, unit, collected,
            status, is_baseline, source_note_id, created_at, updated_at
          )
          VALUES (
            'l1', 'p1', 't1', 'LDL', 7.8, '7.8', 'mg/dL', '2026-11-01',
            'verified', 1, 'n1', ${at}, ${at}
          )
        `;
        yield* sql`
          INSERT INTO plans (
            id, patient_id, title, due, type, status, source_note_id, created_at, updated_at
          )
          VALUES ('pl1', 'p1', 'Clinic visit', '2026-11-25', 'follow_up', 'planned', 'n1', ${at}, ${at})
        `;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));

      yield* Effect.gen(function* () {
        const store = yield* PatientStore.PatientStore;
        const before = yield* store.getPatientRecord({ patientId: "p1" });
        assert.deepStrictEqual(
          before.labs.map((lab) => [
            lab.id,
            lab.valueText,
            lab.status,
            lab.isBaseline,
            lab.revisions,
          ]),
          [["l1", "7.8", "verified", true, []]],
        );
        assert.deepStrictEqual(
          before.plans.map((plan) => [plan.id, plan.status, plan.doneOn]),
          [["pl1", "planned", null]],
        );

        // The ways back work on rows filed before there were any.
        const corrected = yield* store.correctLab({ labId: "l1", value: 78, valueText: "78" });
        assert.deepStrictEqual(
          [corrected.valueText, corrected.status, corrected.revisions.map((was) => was.valueText)],
          ["78", "draft", ["7.8"]],
        );
        const done = yield* store.updatePlan({
          planId: "pl1",
          status: "done",
          doneOn: "2026-11-20",
        });
        assert.deepStrictEqual([done.status, done.doneOn], ["done", "2026-11-20"]);
        yield* store.setPlanRemoved({ planId: "pl1", removed: true });
        assert.lengthOf(yield* store.listPlans({ patientId: "p1" }), 0);
      }).pipe(
        Effect.provide(
          PatientStore.layer.pipe(
            Layer.provide(MedDatabase.layerFromPath(dbPath)),
            Layer.provide(NodeCrypto.layer),
          ),
        ),
      );
    }),
  );

  it.effect("brings a file from before migration 004 up to date, with nothing made up", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-db-test-" });
      const dbPath = path.join(directory, "t3med.sqlite");
      const at = "2026-11-01T00:00:00.000Z";

      // The file as migration 003 left it: an archived patient, a question, and a correction.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({
          loader: Migrator.fromRecord({
            "1_PatientStore": Migration0001,
            "2_ThreadPatientsByPatient": Migration0002,
            "3_Corrections": Migration0003,
          }),
          table: "t3med_migrations",
        });
        yield* sql`
          INSERT INTO patients (id, name, status, created_at, updated_at)
          VALUES ('p1', 'Wayan', 'archived', ${at}, ${at}), ('p2', 'Made', 'active', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO lab_tests (id, name, test_id, created_at, updated_at)
          VALUES ('t1', 'LDL', 'ldl', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO notes (
            id, patient_id, thread_id, title, date, kind, needs_you, created_at, updated_at
          )
          VALUES ('n2', 'p2', 'thread-2', 'Labs', '2026-11-01', 'chat', 'Which lab?', ${at}, ${at})
        `;
        yield* sql`
          INSERT INTO labs (
            id, patient_id, lab_test_id, test_as_written, value, value_text, unit, collected,
            status, is_baseline, source_note_id, created_at, updated_at
          )
          VALUES (
            'l1', 'p2', 't1', 'LDL', 78, '78', 'mg/dL', '2026-11-01',
            'verified', 1, 'n2', ${at}, ${at}
          )
        `;
        yield* sql`
          INSERT INTO lab_revisions (
            id, lab_id, lab_test_id, test_as_written, value, value_text, unit, reference_range,
            collected, status, created_at
          )
          VALUES ('r1', 'l1', 't1', 'LDL', 7.8, '7.8', 'mg/dL', '', '2026-11-01', 'draft', ${at})
        `;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));

      yield* Effect.gen(function* () {
        const store = yield* PatientStore.PatientStore;
        // Nobody recorded who corrected, so nobody is named.
        const record = yield* store.getPatientRecord({ patientId: "p2" });
        assert.deepStrictEqual(
          record.labs.map((lab) => lab.revisions.map((was) => [was.valueText, was.correctedBy])),
          [[["7.8", null]]],
        );
        // The question still waits.
        assert.deepStrictEqual(
          (yield* store.listNeedsYou()).patients.map((waiting) => waiting.patient.id),
          ["p2"],
        );
        // Archived before the status held was recorded: brought back as active.
        const back = yield* store.updatePatient("p1", { archived: false });
        assert.strictEqual(back.status, "active");
      }).pipe(
        Effect.provide(
          PatientStore.layer.pipe(
            Layer.provide(MedDatabase.layerFromPath(dbPath)),
            Layer.provide(NodeCrypto.layer),
          ),
        ),
      );
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
