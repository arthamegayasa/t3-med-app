import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as MedDatabase from "./MedDatabase.ts";
import * as PatientStore from "./PatientStore.ts";

const layerStore = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-store-test-" });
    return PatientStore.layer.pipe(
      Layer.provideMerge(MedDatabase.layerFromPath(path.join(directory, "t3med.sqlite"))),
    );
  }),
);

const failureTag = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "succeeded" as const }),
  );

// The tag of a refused input and the field it names.
const refusedField = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => [error._tag, "field" in error ? error.field : undefined],
      onSuccess: () => ["succeeded", undefined],
    }),
  );

const chatNote = (
  store: PatientStore.PatientStore["Service"],
  patientId: string | null,
  threadId = "thread-1",
) => store.upsertThreadNote({ threadId, patientId, title: "Visit", date: "2026-11-11" });

type Store = PatientStore.PatientStore["Service"];

// Filing needs the thread linked to the patient; the doctor's own link stands in for a URN here.
const fileLinked = (
  store: Store,
  input: Parameters<Store["fileFromThread"]>[0] & { readonly patientId: string },
) =>
  store
    .linkThread({ threadId: input.threadId, patientId: input.patientId })
    .pipe(Effect.andThen(store.fileFromThread(input)));

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("PatientStore", (it) => {
  it("builds the same URN key however the URN is punctuated", () => {
    assert.strictEqual(PatientStore.urnKey("00-12-34-56"), "00123456");
    assert.strictEqual(PatientStore.urnKey("00123456"), "00123456");
    assert.strictEqual(PatientStore.urnKey(" rm.12/ab "), "RM12AB");
  });

  it.effect("finds a patient by URN on an exact key match only", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan Sudarma", urn: "00-12-34-56" });

      assert.strictEqual(wayan.status, "new");
      assert.strictEqual(wayan.urn, "00-12-34-56");
      assert.strictEqual(wayan.urnKey, "00123456");
      assert.deepStrictEqual(
        Option.map(yield* store.findPatientByUrn("00123456"), (patient) => patient.id),
        Option.some(wayan.id),
      );
      assert.isTrue(Option.isNone(yield* store.findPatientByUrn("0012345")));
      assert.isTrue(Option.isNone(yield* store.findPatientByUrn("001234567")));
      assert.isTrue(Option.isNone(yield* store.findPatientByUrn("Wayan Sudarma")));
      assert.isTrue(Option.isNone(yield* store.findPatientByUrn("--")));
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("refuses a second patient with the same URN key and allows many without a URN", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      yield* store.createPatient({ name: "Wayan Sudarma", urn: "00-12-34-56" });
      const made = yield* store.createPatient({ name: "Made" });
      yield* store.createPatient({ name: "Ketut" });

      assert.strictEqual(
        yield* failureTag(store.createPatient({ name: "Someone else", urn: "00 12 34 56" })),
        "PatientUrnTakenError",
      );
      assert.strictEqual(
        yield* failureTag(store.updatePatient(made.id, { urn: "00123456" })),
        "PatientUrnTakenError",
      );
      assert.strictEqual(made.urnKey, null);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("searches by name and by other spellings without regard to case", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({
        name: "I Wayan Sudarma",
        alsoWrittenAs: ["Pak Yan"],
      });
      yield* store.createPatient({ name: "Ni Made Ayu" });
      const ids = (query: string) =>
        store
          .searchPatients(query)
          .pipe(Effect.map((patients) => patients.map((patient) => patient.id)));

      assert.deepStrictEqual(yield* ids("sudar"), [wayan.id]);
      assert.deepStrictEqual(yield* ids("PAK YAN"), [wayan.id]);
      assert.deepStrictEqual(yield* ids("  wayan "), [wayan.id]);
      assert.deepStrictEqual(yield* ids("ketut"), []);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("matches a patient by URN only and offers a name's patients as candidates", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({
        name: "I Wayan Sudarma",
        urn: "00-12-34-56",
        alsoWrittenAs: ["Pak Yan"],
      });
      const arta = yield* store.createPatient({ name: "Wayan Arta" });
      const found = (query: Parameters<typeof store.findPatient>[0]) =>
        store.findPatient(query).pipe(
          Effect.map(({ match, candidates }) => ({
            match: Option.getOrNull(Option.map(match, (patient) => patient.id)),
            candidates: candidates.map((patient) => patient.id),
          })),
        );

      assert.deepStrictEqual(yield* found({ urn: "00123456" }), {
        match: wayan.id,
        candidates: [],
      });
      assert.deepStrictEqual(yield* found({ urn: "00123456", name: "Arta" }), {
        match: wayan.id,
        candidates: [],
      });
      assert.deepStrictEqual(yield* found({ urn: "99", name: "wayan" }), {
        match: null,
        candidates: [wayan.id, arta.id],
      });
      assert.deepStrictEqual(yield* found({ name: "pak yan" }), {
        match: null,
        candidates: [wayan.id],
      });
      assert.deepStrictEqual(yield* found({ urn: "99" }), { match: null, candidates: [] });
      assert.deepStrictEqual(yield* refusedField(store.findPatient({ urn: " ", name: "" })), [
        "BlankFieldError",
        "urn or name",
      ]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("lists patients by their latest note, falling back to when they were created", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const first = yield* store.createPatient({ name: "First" });
      yield* TestClock.adjust(Duration.minutes(1));
      yield* store.createPatient({ name: "Second" });
      yield* TestClock.adjust(Duration.minutes(1));
      yield* store.createPatient({ name: "Third" });
      const names = store
        .listPatients()
        .pipe(Effect.map((patients) => patients.map((patient) => patient.name)));
      assert.deepStrictEqual(yield* names, ["Third", "Second", "First"]);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* store.upsertThreadNote({
        threadId: "thread-1",
        patientId: first.id,
        title: "Follow-up",
        date: "2026-11-11",
      });
      assert.deepStrictEqual(yield* names, ["First", "Third", "Second"]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("updates only the fields given and keeps the URN key in step with the URN", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const created = yield* store.createPatient({ name: "Wayan", urn: "A-1", sex: "male" });
      const updated = yield* store.updatePatient(created.id, {
        name: "I Wayan Sudarma",
        urn: "b 22",
        dateOfBirth: "1961-03-04",
        diagnoses: "Ischaemic stroke",
        status: "archived",
      });

      assert.deepInclude(updated, {
        id: created.id,
        name: "I Wayan Sudarma",
        urn: "b 22",
        urnKey: "B22",
        sex: "male",
        dateOfBirth: "1961-03-04",
        diagnoses: "Ischaemic stroke",
        status: "archived",
      });
      assert.isTrue(Option.isNone(yield* store.findPatientByUrn("A1")));
      assert.deepInclude(yield* store.updatePatient(created.id, { urn: null }), {
        urn: null,
        urnKey: null,
      });
      assert.deepStrictEqual(
        (yield* store.updatePatient(created.id, { name: "Wayan Sudarma", addSpelling: "Pak Yan" }))
          .alsoWrittenAs,
        ["Wayan", "I Wayan Sudarma", "Pak Yan"],
      );
      assert.strictEqual(
        yield* failureTag(store.updatePatient("missing", { name: "Nobody" })),
        "PatientNotFoundError",
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("adds a spelling once, whatever its case, and never the name itself", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan Sudarma" });
      yield* store.addPatientSpelling(patient.id, "W. Sudarma");
      yield* store.addPatientSpelling(patient.id, " w. sudarma ");
      yield* store.addPatientSpelling(patient.id, "WAYAN SUDARMA");
      const spelled = yield* store.addPatientSpelling(patient.id, "Pak Yan");

      assert.deepStrictEqual(spelled.alsoWrittenAs, ["W. Sudarma", "Pak Yan"]);
      assert.deepStrictEqual((yield* store.getPatient(patient.id)).alsoWrittenAs, [
        "W. Sudarma",
        "Pak Yan",
      ]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("marks a patient's first result as baseline and compares later ones with it", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const target = {
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
      };
      const [first] = yield* store.fileLabs({
        ...target,
        results: [{ testAsWritten: "LDL", value: 162, unit: "mg/dL", collected: "2026-01-10" }],
      });
      const [later] = yield* store.fileLabs({
        ...target,
        results: [
          { testAsWritten: "Kolesterol LDL", value: 78, unit: "mg/dl", collected: "2026-04-10" },
        ],
      });

      assert.deepInclude(first, {
        patientId: patient.id,
        testId: "ldl",
        status: "draft",
        isBaseline: true,
        valueInBaselineUnit: null,
        changeFromBaseline: null,
        changePercent: null,
      });
      assert.deepInclude(later, {
        labTestId: first!.labTestId,
        testAsWritten: "Kolesterol LDL",
        unit: "mg/dl",
        status: "draft",
        isBaseline: false,
        valueInBaselineUnit: 78,
      });
      // Worked by hand: 78 - 162 = -84; -84 / 162 = -51.9 %.
      assert.closeTo(later!.changeFromBaseline!, -84, 1e-9);
      assert.closeTo(later!.changePercent!, -51.9, 0.1);
      assert.deepStrictEqual(
        (yield* store.listLabTests()).map(({ name, testId, alsoWrittenAs }) => ({
          name,
          testId,
          alsoWrittenAs,
        })),
        [{ name: "LDL", testId: "ldl", alsoWrittenAs: ["Kolesterol LDL"] }],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("converts a later result to the baseline's unit before comparing", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const [, later] = yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
        results: [
          { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" },
          { testAsWritten: "LDL", value: 2.6, unit: "mmol/L", collected: "2026-04-10" },
        ],
      });

      // Published pair: 2.6 mmol/L is 100 mg/dL; 100 - 190 = -90; -90 / 190 = -47.4 %.
      assert.closeTo(later!.valueInBaselineUnit!, 100, 1);
      assert.closeTo(later!.changeFromBaseline!, -90, 1);
      assert.closeTo(later!.changePercent!, -47.4, 0.6);
      assert.strictEqual(later!.value, 2.6);
      assert.strictEqual(later!.unit, "mmol/L");
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("leaves the comparison empty when no verified conversion exists", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const labs = yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
        results: [
          { testAsWritten: "LDL", value: 162, unit: "mg/dL", collected: "2026-01-10" },
          { testAsWritten: "LDL", value: 2.0, unit: "g/L", collected: "2026-02-10" },
          { testAsWritten: "Kreatinin (urin)", value: 100, unit: "mg/dL", collected: "2026-01-10" },
          {
            testAsWritten: "Kreatinin (urin)",
            value: 8.8,
            unit: "mmol/L",
            collected: "2026-02-10",
          },
          {
            testAsWritten: "kreatinin  (URIN)",
            value: 120,
            unit: "mg/dL",
            collected: "2026-03-10",
          },
        ],
      });
      const comparison = labs.map((lab) => [
        lab.isBaseline,
        lab.valueInBaselineUnit,
        lab.changeFromBaseline,
        lab.changePercent,
      ]);

      assert.deepStrictEqual(comparison, [
        [true, null, null, null],
        [false, null, null, null],
        [true, null, null, null],
        [false, null, null, null],
        [false, 120, 20, 20],
      ]);
      assert.strictEqual(labs[2]!.testId, null);
      assert.strictEqual(labs[4]!.labTestId, labs[2]!.labTestId);
      assert.notStrictEqual(labs[2]!.labTestId, labs[0]!.labTestId);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("lets an older result take over as baseline and recomputes the other rows", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const target = {
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
      };
      yield* store.fileLabs({
        ...target,
        results: [
          { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" },
          { testAsWritten: "LDL", value: 80, unit: "mg/dL", collected: "2026-06-10" },
        ],
      });
      const [older] = yield* store.fileLabs({
        ...target,
        results: [{ testAsWritten: "LDL", value: 200, unit: "mg/dL", collected: "2026-01-10" }],
      });

      assert.isTrue(older!.isBaseline);
      assert.deepStrictEqual(
        (yield* store.listLabs({ patientId: patient.id })).map((lab) => [
          lab.collected,
          lab.isBaseline,
          lab.valueInBaselineUnit,
          lab.changeFromBaseline,
          lab.changePercent,
        ]),
        [
          ["2026-01-10", true, null, null, null],
          ["2026-04-10", false, 100, -100, -50],
          ["2026-06-10", false, 80, -120, -60],
        ],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("takes the earliest numeric result of one batch as baseline", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const labs = yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
        results: [
          { testAsWritten: "LDL", value: null, valueText: "hemolysed", collected: "2026-03-01" },
          { testAsWritten: "LDL", value: 150, unit: "mg/dL", collected: "2026-05-01" },
          {
            testAsWritten: "LDL",
            value: 160,
            valueText: "160.0",
            unit: "mg/dL",
            collected: "2026-04-01",
          },
        ],
      });

      assert.deepStrictEqual(
        labs.map((lab) => [
          lab.valueText,
          lab.isBaseline,
          lab.changeFromBaseline,
          lab.changePercent,
        ]),
        [
          ["hemolysed", false, null, null],
          ["150", false, -10, -6.25],
          ["160.0", true, null, null],
        ],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("never shares a baseline between tests or between patients", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const filed = yield* store.fileLabs({
        patientId: wayan.id,
        sourceNoteId: (yield* chatNote(store, wayan.id)).id,
        results: [
          { testAsWritten: "GDP", value: 100, unit: "mg/dL", collected: "2026-01-10" },
          { testAsWritten: "GDS", value: 180, unit: "mg/dL", collected: "2026-02-10" },
        ],
      });
      const [other] = yield* store.fileLabs({
        patientId: made.id,
        sourceNoteId: (yield* chatNote(store, made.id)).id,
        results: [{ testAsWritten: "GDP", value: 90, unit: "mg/dL", collected: "2026-03-10" }],
      });

      assert.deepStrictEqual(
        filed.map((lab) => [lab.testId, lab.isBaseline]),
        [
          ["glucose_fasting", true],
          ["glucose_random", true],
        ],
      );
      assert.isTrue(other!.isBaseline);
      assert.strictEqual(other!.labTestId, filed[0]!.labTestId);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files Inbox results as written, with no baseline", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const note = yield* store.upsertThreadNote({
        threadId: "thread-1",
        patientId: null,
        title: "Unknown patient",
        date: "2026-11-11",
      });
      const [lab] = yield* store.fileLabs({
        patientId: null,
        sourceNoteId: note.id,
        results: [
          {
            testAsWritten: "HbA1c",
            value: 6.5,
            valueText: "6.50",
            unit: "%",
            referenceRange: "< 5.7",
            flag: "high",
            collected: "2026-11-10",
            lab: "Prodia",
          },
        ],
      });

      assert.deepInclude(lab, {
        patientId: null,
        testId: "hba1c",
        testName: "HbA1c",
        value: 6.5,
        valueText: "6.50",
        unit: "%",
        referenceRange: "< 5.7",
        flag: "high",
        collected: "2026-11-10",
        lab: "Prodia",
        sourceNoteId: note.id,
        status: "draft",
        isBaseline: false,
        valueInBaselineUnit: null,
        changeFromBaseline: null,
        changePercent: null,
      });
      assert.deepStrictEqual(yield* store.listLabs({ inbox: true, sourceNoteId: note.id }), [lab!]);

      // Two Inbox sheets may be two patients': the same test in both never shares a baseline.
      yield* store.fileLabs({
        patientId: null,
        sourceNoteId: (yield* chatNote(store, null, "thread-2")).id,
        results: [{ testAsWritten: "HbA1c", value: 9.1, unit: "%", collected: "2026-11-01" }],
      });
      assert.deepStrictEqual(
        (yield* store.listLabs({ inbox: true })).map((row) => [
          row.collected,
          row.isBaseline,
          row.valueInBaselineUnit,
          row.changeFromBaseline,
          row.changePercent,
        ]),
        [
          ["2026-11-01", false, null, null, null],
          ["2026-11-10", false, null, null, null],
        ],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files nothing when one result of the batch is refused, and names the field", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const note = yield* chatNote(store, patient.id);
      const inbox = yield* chatNote(store, null);
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-01-10" };
      const target = { patientId: patient.id, sourceNoteId: note.id };
      const filing = (input: object) =>
        refusedField(store.fileLabs({ ...target, results: [ldl], ...input }));
      const second = (result: object) => filing({ results: [ldl, { ...ldl, ...result }] });

      assert.deepStrictEqual(yield* second({ flag: "critical" }), [
        "InvalidChoiceError",
        "results[1].flag",
      ]);
      assert.deepStrictEqual(yield* second({ collected: "10/01/2026" }), [
        "InvalidDateError",
        "results[1].collected",
      ]);
      for (const testAsWritten of ["", "   "]) {
        assert.deepStrictEqual(yield* second({ testAsWritten }), [
          "BlankFieldError",
          "results[1].testAsWritten",
        ]);
      }
      for (const result of [
        { value: null },
        { value: null, valueText: "  " },
        { value: Number.NaN },
        { value: Number.POSITIVE_INFINITY, valueText: "> 1000" },
        { value: "100" },
      ]) {
        assert.deepStrictEqual(yield* second(result), ["InvalidLabValueError", "results[1].value"]);
      }
      for (const sourceNoteId of [undefined, " "]) {
        assert.deepStrictEqual(yield* filing({ sourceNoteId }), [
          "BlankFieldError",
          "sourceNoteId",
        ]);
      }
      assert.strictEqual((yield* filing({ patientId: "missing" }))[0], "PatientNotFoundError");
      assert.strictEqual((yield* filing({ sourceNoteId: "missing" }))[0], "NoteNotFoundError");
      assert.strictEqual(
        (yield* filing({ sourceNoteId: inbox.id }))[0],
        "NotePatientMismatchError",
      );
      assert.deepStrictEqual(yield* store.listLabs({ patientId: patient.id }), []);
      assert.deepStrictEqual(yield* store.listLabTests(), []);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("keeps a result that is not a number as the sheet writes it", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const labs = yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id)).id,
        results: [
          {
            testAsWritten: "HBsAg",
            value: null,
            valueText: "Non-reactive",
            collected: "2026-01-10",
          },
          {
            testAsWritten: "LDL",
            value: 100,
            valueText: " ",
            unit: "mg/dL",
            collected: "2026-01-10",
          },
        ],
      });

      assert.deepStrictEqual(
        labs.map((lab) => [lab.value, lab.valueText]),
        [
          [null, "Non-reactive"],
          [100, "100"],
        ],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("refuses a patient without a name or with a value outside its choices", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const updating = (fields: object) => refusedField(store.updatePatient(patient.id, fields));

      for (const name of ["", "  "]) {
        assert.deepStrictEqual(yield* refusedField(store.createPatient({ name })), [
          "BlankFieldError",
          "name",
        ]);
        assert.deepStrictEqual(yield* updating({ name }), ["BlankFieldError", "name"]);
      }
      assert.deepStrictEqual(
        yield* refusedField(store.createPatient({ name: "Made", sex: "unknown" as never })),
        ["InvalidChoiceError", "sex"],
      );
      assert.deepStrictEqual(yield* updating({ sex: "unknown" }), ["InvalidChoiceError", "sex"]);
      assert.deepStrictEqual(yield* updating({ status: "deleted" }), [
        "InvalidChoiceError",
        "status",
      ]);
      assert.deepStrictEqual(
        (yield* store.listPatients()).map(({ name, status, sex }) => ({ name, status, sex })),
        [{ name: "Wayan", status: "new", sex: null }],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("keeps the old name as a spelling when a patient is renamed", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({
        name: "Wayan",
        alsoWrittenAs: ["I Wayan Sudarma", "Pak Yan"],
      });
      const renamed = yield* store.updatePatient(patient.id, { name: " i wayan  sudarma " });

      assert.strictEqual(renamed.name, "i wayan sudarma");
      assert.deepStrictEqual(renamed.alsoWrittenAs, ["Pak Yan", "Wayan"]);
      // A change of case alone is the same spelling, and a field left out renames nothing.
      assert.deepStrictEqual(
        (yield* store.updatePatient(patient.id, { name: "I Wayan Sudarma" })).alsoWrittenAs,
        ["Pak Yan", "Wayan"],
      );
      assert.deepStrictEqual(
        (yield* store.updatePatient(patient.id, { diagnoses: "Stroke" })).alsoWrittenAs,
        ["Pak Yan", "Wayan"],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("keeps one chat note per thread and patient", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const note = { threadId: "thread-1", title: "Follow-up", date: "2026-11-11" };
      const first = yield* store.upsertThreadNote({
        ...note,
        patientId: wayan.id,
        summary: "LDL down on statin.",
        needsYou: "Confirm the LDL unit.",
      });
      yield* TestClock.adjust(Duration.minutes(1));
      const again = yield* store.upsertThreadNote({
        ...note,
        patientId: wayan.id,
        title: "Follow-up and labs",
        summary: "LDL down on statin; HbA1c stable.",
      });
      const inbox = yield* store.upsertThreadNote({ ...note, patientId: null });
      const other = yield* store.upsertThreadNote({ ...note, patientId: made.id });

      assert.deepInclude(first, { kind: "chat", patientId: wayan.id, threadId: "thread-1" });
      assert.deepInclude(again, {
        id: first.id,
        title: "Follow-up and labs",
        summary: "LDL down on statin; HbA1c stable.",
        needsYou: "Confirm the LDL unit.",
        createdAt: first.createdAt,
      });
      assert.notStrictEqual(again.updatedAt, first.updatedAt);
      assert.deepInclude(inbox, { patientId: null, summary: "", needsYou: "" });
      assert.strictEqual(new Set([first.id, inbox.id, other.id]).size, 3);
      assert.strictEqual(
        (yield* store.upsertThreadNote({ ...note, patientId: null, summary: "Still unknown." })).id,
        inbox.id,
      );
      assert.strictEqual(
        yield* failureTag(store.upsertThreadNote({ ...note, patientId: "missing" })),
        "PatientNotFoundError",
      );
      assert.strictEqual(
        yield* failureTag(store.upsertThreadNote({ ...note, patientId: null, date: "today" })),
        "InvalidDateError",
      );

      // The kind says what the thread brought; it never makes a second note.
      assert.deepInclude(
        yield* store.upsertThreadNote({ ...note, patientId: made.id, kind: "lab_sheet" }),
        { id: other.id, kind: "lab_sheet" },
      );
      assert.strictEqual(
        (yield* store.upsertThreadNote({ ...note, patientId: made.id })).kind,
        "lab_sheet",
      );
      assert.deepStrictEqual(
        yield* refusedField(
          store.upsertThreadNote({ ...note, patientId: made.id, kind: "memo" as never }),
        ),
        ["InvalidChoiceError", "kind"],
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files plans as drafts", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const note = yield* store.upsertThreadNote({
        threadId: "thread-1",
        patientId: patient.id,
        title: "Follow-up",
        date: "2026-11-11",
      });
      const filed = yield* store.filePlans({
        patientId: patient.id,
        sourceNoteId: note.id,
        plans: [
          { title: "Repeat lipid panel", due: "2026-12-01", type: "lab" },
          { title: "Clinic visit", due: "2026-11-25", type: "follow_up" },
        ],
      });

      assert.deepStrictEqual(
        filed.map(({ title, due, type, status, patientId, sourceNoteId }) => ({
          title,
          due,
          type,
          status,
          patientId,
          sourceNoteId,
        })),
        [
          {
            title: "Repeat lipid panel",
            due: "2026-12-01",
            type: "lab",
            status: "draft",
            patientId: patient.id,
            sourceNoteId: note.id,
          },
          {
            title: "Clinic visit",
            due: "2026-11-25",
            type: "follow_up",
            status: "draft",
            patientId: patient.id,
            sourceNoteId: note.id,
          },
        ],
      );
      assert.deepStrictEqual(
        (yield* store.listPlans({ patientId: patient.id })).map((plan) => plan.title),
        ["Clinic visit", "Repeat lipid panel"],
      );
      const mri = { title: "MRI", due: "2026-12-10", type: "imaging" } as const;
      const filing = (input: object) =>
        refusedField(
          store.filePlans({ patientId: patient.id, sourceNoteId: note.id, plans: [mri], ...input }),
        );
      assert.deepStrictEqual(yield* filing({ plans: [mri, { ...mri, due: "next month" }] }), [
        "InvalidDateError",
        "plans[1].due",
      ]);
      assert.deepStrictEqual(yield* filing({ plans: [{ ...mri, type: "surgery" }] }), [
        "InvalidChoiceError",
        "plans[0].type",
      ]);
      assert.deepStrictEqual(yield* filing({ plans: [{ ...mri, title: " " }] }), [
        "BlankFieldError",
        "plans[0].title",
      ]);
      assert.deepStrictEqual(yield* filing({ sourceNoteId: undefined }), [
        "BlankFieldError",
        "sourceNoteId",
      ]);
      assert.strictEqual((yield* filing({ patientId: null }))[0], "NotePatientMismatchError");
      assert.strictEqual((yield* store.listPlans({ patientId: patient.id })).length, 2);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("moves an Inbox note to a patient with its labs and plans, then sets baselines", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: (yield* chatNote(store, patient.id, "thread-0")).id,
        results: [{ testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" }],
      });
      const inbox = { patientId: null, title: "Unknown patient", date: "2026-11-11" };
      const note = yield* store.upsertThreadNote({ ...inbox, threadId: "thread-1" });
      const stays = yield* store.upsertThreadNote({ ...inbox, threadId: "thread-2" });
      yield* store.fileLabs({
        patientId: null,
        sourceNoteId: note.id,
        results: [
          { testAsWritten: "LDL", value: 200, unit: "mg/dL", collected: "2026-01-10" },
          { testAsWritten: "HbA1c", value: 6.5, unit: "%", collected: "2026-01-10" },
        ],
      });
      yield* store.filePlans({
        patientId: null,
        sourceNoteId: note.id,
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab" }],
      });
      yield* store.fileLabs({
        patientId: null,
        sourceNoteId: stays.id,
        results: [{ testAsWritten: "LDL", value: 50, unit: "mg/dL", collected: "2025-01-10" }],
      });

      const moved = yield* store.moveNoteToPatient({ noteId: note.id, patientId: patient.id });

      assert.deepInclude(moved, { id: note.id, patientId: patient.id });
      // The doctor's move is what links a thread that named no URN.
      assert.deepStrictEqual(
        Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id),
        Option.some(patient.id),
      );
      assert.isTrue(Option.isNone(yield* store.getThreadPatient("thread-2")));
      assert.deepStrictEqual(
        (yield* store.listLabs({ patientId: patient.id })).map((lab) => [
          lab.testId,
          lab.collected,
          lab.isBaseline,
          lab.changeFromBaseline,
          lab.changePercent,
        ]),
        [
          ["ldl", "2026-01-10", true, null, null],
          ["hba1c", "2026-01-10", true, null, null],
          ["ldl", "2026-04-10", false, -100, -50],
        ],
      );
      assert.deepStrictEqual(
        (yield* store.listPlans({ patientId: patient.id })).map((plan) => plan.sourceNoteId),
        [note.id],
      );
      assert.deepStrictEqual(
        (yield* store.listLabs({ inbox: true, sourceNoteId: stays.id })).map((lab) => [
          lab.patientId,
          lab.isBaseline,
        ]),
        [[null, false]],
      );

      const moving = (input: Parameters<typeof store.moveNoteToPatient>[0]) =>
        failureTag(store.moveNoteToPatient(input));
      assert.strictEqual(
        yield* moving({ noteId: note.id, patientId: patient.id }),
        "NoteNotInInboxError",
      );
      assert.strictEqual(
        yield* moving({ noteId: "missing", patientId: patient.id }),
        "NoteNotFoundError",
      );
      assert.strictEqual(
        yield* moving({ noteId: stays.id, patientId: "missing" }),
        "PatientNotFoundError",
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("merges an Inbox note into the chat note its thread already has for the patient", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const sql = yield* MedDatabase.MedDatabase;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const note = { threadId: "thread-1", title: "Visit", date: "2026-11-11" };
      const existing = yield* store.upsertThreadNote({
        ...note,
        patientId: patient.id,
        summary: "LDL down on statin.",
        needsYou: "Confirm the LDL unit.",
      });
      yield* store.fileLabs({
        patientId: patient.id,
        sourceNoteId: existing.id,
        results: [{ testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" }],
      });
      yield* store.verifyNote(existing.id);
      const inbox = yield* store.upsertThreadNote({
        ...note,
        patientId: null,
        summary: "An older sheet was found.",
        needsYou: "Whose sheet is this?",
      });
      yield* store.fileLabs({
        patientId: null,
        sourceNoteId: inbox.id,
        results: [{ testAsWritten: "LDL", value: 200, unit: "mg/dL", collected: "2026-01-10" }],
      });
      yield* store.filePlans({
        patientId: null,
        sourceNoteId: inbox.id,
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab" }],
      });
      yield* sql`
        INSERT INTO note_files (id, note_id, name, path, created_at, updated_at)
        VALUES ('f1', ${inbox.id}, 'sheet.pdf', 'sheet.pdf', '2026-11-11', '2026-11-11')
      `;

      const merged = yield* store.moveNoteToPatient({ noteId: inbox.id, patientId: patient.id });

      assert.deepInclude(merged, {
        id: existing.id,
        patientId: patient.id,
        summary: "LDL down on statin.\n\nAn older sheet was found.",
        needsYou: "Confirm the LDL unit.\n\nWhose sheet is this?",
      });
      assert.deepStrictEqual(
        (yield* store.listLabs({ patientId: patient.id })).map((lab) => [
          lab.collected,
          lab.sourceNoteId,
          lab.status,
          lab.isBaseline,
          lab.changeFromBaseline,
          lab.changePercent,
        ]),
        [
          ["2026-01-10", existing.id, "draft", true, null, null],
          ["2026-04-10", existing.id, "verified", false, -100, -50],
        ],
      );
      assert.deepStrictEqual(
        (yield* store.listPlans({ patientId: patient.id })).map((plan) => plan.sourceNoteId),
        [existing.id],
      );
      assert.deepStrictEqual(yield* sql`SELECT note_id AS "noteId" FROM note_files`, [
        { noteId: existing.id },
      ]);
      assert.deepStrictEqual(yield* sql`SELECT id FROM notes`, [{ id: existing.id }]);
      assert.deepStrictEqual(yield* store.listLabs({ inbox: true }), []);
      assert.deepStrictEqual(yield* store.listPlans({ inbox: true }), []);
      assert.deepStrictEqual(yield* store.verifyNote(existing.id), {
        labsVerified: 1,
        plansPlanned: 1,
        patientActivated: false,
      });
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("lists the labs and plans of one patient or of the Inbox, never of everyone", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const plan = { title: "Clinic visit", due: "2026-11-25", type: "follow_up" } as const;
      const notes: Array<string> = [];
      for (const [threadId, patientId] of [
        ["thread-1", wayan.id],
        ["thread-2", wayan.id],
        ["thread-3", made.id],
        ["thread-4", null],
      ] as const) {
        const target = {
          patientId,
          sourceNoteId: (yield* chatNote(store, patientId, threadId)).id,
        };
        yield* store.fileLabs({ ...target, results: [ldl] });
        yield* store.filePlans({ ...target, plans: [plan] });
        notes.push(target.sourceNoteId);
      }
      const listed = (filter: Parameters<typeof store.listLabs>[0]) =>
        Effect.all([store.listLabs(filter), store.listPlans(filter)]).pipe(
          Effect.map((lists) => lists.map((rows) => rows.map((row) => row.sourceNoteId))),
          Effect.orElseSucceed(() => [[], []]),
        );

      assert.deepStrictEqual(yield* listed({ patientId: wayan.id }), [
        [notes[0], notes[1]],
        [notes[0], notes[1]],
      ]);
      assert.deepStrictEqual(yield* listed({ patientId: wayan.id, sourceNoteId: notes[1] }), [
        [notes[1]],
        [notes[1]],
      ]);
      assert.deepStrictEqual(yield* listed({ patientId: made.id }), [[notes[2]], [notes[2]]]);
      assert.deepStrictEqual(yield* listed({ inbox: true }), [[notes[3]], [notes[3]]]);
      assert.deepStrictEqual(yield* listed({ patientId: wayan.id, sourceNoteId: notes[2] }), [
        [],
        [],
      ]);
      // A caller that leaves the scope out is given nothing, never every patient's rows.
      assert.deepStrictEqual(yield* listed({} as never), [[], []]);
      assert.deepStrictEqual(yield* listed({ sourceNoteId: notes[0] } as never), [[], []]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("counts filing, verifying and moving as a patient's latest activity", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const ofWayan = { patientId: wayan.id, sourceNoteId: (yield* chatNote(store, wayan.id)).id };
      yield* TestClock.adjust(Duration.minutes(1));
      const ofMade = { patientId: made.id, sourceNoteId: (yield* chatNote(store, made.id)).id };
      const inbox = yield* chatNote(store, null);
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const plan = { title: "Clinic visit", due: "2026-11-25", type: "follow_up" } as const;
      yield* store.fileLabs({ patientId: null, sourceNoteId: inbox.id, results: [ldl] });
      const latest = Effect.gen(function* () {
        yield* TestClock.adjust(Duration.minutes(1));
        return (yield* store.listPatients())[0]?.name;
      });
      assert.strictEqual(yield* latest, "Made");

      yield* store.fileLabs({ ...ofWayan, results: [ldl] });
      assert.strictEqual(yield* latest, "Wayan");
      yield* store.filePlans({ ...ofMade, plans: [plan] });
      assert.strictEqual(yield* latest, "Made");
      yield* store.verifyNote(ofWayan.sourceNoteId);
      assert.strictEqual(yield* latest, "Wayan");
      yield* store.moveNoteToPatient({ noteId: inbox.id, patientId: made.id });
      assert.strictEqual(yield* latest, "Made");
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("keeps a failed query a typed failure that names the step", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const sql = yield* MedDatabase.MedDatabase;
      const failedStep = <A, R>(effect: Effect.Effect<A, { readonly _tag: string }, R>) =>
        effect.pipe(
          Effect.match({
            onFailure: (error) => [error._tag, "operation" in error ? error.operation : undefined],
            onSuccess: () => ["succeeded", undefined],
          }),
        );

      // Each write below succeeds and the read of the new row after it fails.
      yield* sql`ALTER TABLE notes DROP COLUMN local_file`;
      assert.deepStrictEqual(yield* failedStep(chatNote(store, null)), [
        "PatientStoreError",
        "readNote:query",
      ]);
      yield* sql`DROP TABLE notes`;
      assert.deepStrictEqual(yield* failedStep(store.createPatient({ name: "Wayan" })), [
        "PatientStoreError",
        "readPatient:query",
      ]);
      assert.deepStrictEqual(yield* sql`SELECT id FROM patients`, []);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("verifies the drafts of one note and makes a new patient active", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const plan = { title: "Clinic visit", due: "2026-11-25", type: "follow_up" } as const;
      const noteOf = (threadId: string, patientId: string | null) =>
        store.upsertThreadNote({ threadId, patientId, title: "Visit", date: "2026-11-11" });
      const first = yield* noteOf("thread-1", patient.id);
      const second = yield* noteOf("thread-2", patient.id);
      const inbox = yield* noteOf("thread-3", null);
      const target = { patientId: patient.id, sourceNoteId: first.id };
      yield* store.fileLabs({ ...target, results: [ldl, { ...ldl, testAsWritten: "HDL" }] });
      yield* store.filePlans({ ...target, plans: [plan] });
      yield* store.fileLabs({ ...target, sourceNoteId: second.id, results: [ldl] });
      yield* store.filePlans({ ...target, sourceNoteId: second.id, plans: [plan] });
      const statuses = Effect.gen(function* () {
        const labs = yield* store.listLabs({ patientId: patient.id });
        const plans = yield* store.listPlans({ patientId: patient.id });
        return {
          patient: (yield* store.getPatient(patient.id)).status,
          first: [...labs, ...plans]
            .filter((row) => row.sourceNoteId === first.id)
            .map((row) => row.status),
          second: [...labs, ...plans]
            .filter((row) => row.sourceNoteId === second.id)
            .map((row) => row.status),
        };
      });

      assert.deepStrictEqual(yield* store.verifyNote(first.id), {
        labsVerified: 2,
        plansPlanned: 1,
        patientActivated: true,
      });
      assert.deepStrictEqual(yield* statuses, {
        patient: "active",
        first: ["verified", "verified", "planned"],
        second: ["draft", "draft"],
      });
      assert.deepStrictEqual(yield* store.verifyNote(first.id), {
        labsVerified: 0,
        plansPlanned: 0,
        patientActivated: false,
      });

      yield* store.updatePatient(patient.id, { status: "archived" });
      assert.deepStrictEqual(yield* store.verifyNote(second.id), {
        labsVerified: 1,
        plansPlanned: 1,
        patientActivated: false,
      });
      assert.strictEqual((yield* statuses).patient, "archived");
      assert.strictEqual(yield* failureTag(store.verifyNote(inbox.id)), "NoteInInboxError");
      assert.strictEqual(yield* failureTag(store.verifyNote("missing")), "NoteNotFoundError");
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("records each file of a note once and refuses one without a name or a path", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const note = yield* chatNote(store, null);
      const sheet = { name: "lipid-panel.pdf", path: "patient-files/lipid-panel.pdf" };
      const scan = { name: "mri.pdf", path: "patient-files/mri.pdf" };

      const first = yield* store.addNoteFiles({ noteId: note.id, files: [sheet] });
      const again = yield* store.addNoteFiles({ noteId: note.id, files: [sheet, scan] });

      assert.deepStrictEqual(
        first.map((file) => [file.noteId, file.name, file.path]),
        [[note.id, sheet.name, sheet.path]],
      );
      assert.deepStrictEqual(
        again.map((file) => file.path),
        [sheet.path, scan.path],
      );
      assert.strictEqual(again[0]?.id, first[0]?.id);
      assert.deepStrictEqual(
        yield* refusedField(
          store.addNoteFiles({ noteId: note.id, files: [scan, { name: " ", path: "x.pdf" }] }),
        ),
        ["BlankFieldError", "files[1].name"],
      );
      assert.deepStrictEqual(
        yield* refusedField(
          store.addNoteFiles({ noteId: note.id, files: [{ name: "x.pdf", path: "" }] }),
        ),
        ["BlankFieldError", "files[0].path"],
      );
      assert.strictEqual(
        yield* failureTag(store.addNoteFiles({ noteId: "missing", files: [sheet] })),
        "NoteNotFoundError",
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files a linked thread's message in one step: note, labs, plans and files", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { patient } = yield* store.createPatientFromThread({
        threadId: "thread-1",
        name: "Wayan",
        urn: "00-12-34-56",
      });
      const message = { threadId: "thread-1", patientId: patient.id, title: "Lipid follow-up" };
      const sheet = { name: "lipid-panel.pdf", path: "patient-files/lipid-panel.pdf" };

      const filed = yield* store.fileFromThread({
        ...message,
        summary: "LDL down on statin.",
        date: "2026-11-11",
        labs: [
          { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" },
          { testAsWritten: "LDL", value: 2.6, unit: "mmol/L", collected: "2026-04-10" },
        ],
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab" }],
        files: [sheet],
      });

      assert.deepInclude(filed.note, {
        patientId: patient.id,
        threadId: "thread-1",
        kind: "chat",
        title: "Lipid follow-up",
        summary: "LDL down on statin.",
        date: "2026-11-11",
      });
      assert.deepStrictEqual(
        filed.labs.map((lab) => [lab.sourceNoteId, lab.status, lab.isBaseline]),
        [
          [filed.note.id, "draft", true],
          [filed.note.id, "draft", false],
        ],
      );
      // Published pair: 2.6 mmol/L is 100 mg/dL; 100 - 190 = -90; -90 / 190 = -47.4 %.
      assert.closeTo(filed.labs[1]!.valueInBaselineUnit!, 100, 1);
      assert.closeTo(filed.labs[1]!.changeFromBaseline!, -90, 1);
      assert.closeTo(filed.labs[1]!.changePercent!, -47.4, 0.6);
      assert.deepStrictEqual(
        filed.plans.map((plan) => [plan.patientId, plan.sourceNoteId, plan.status, plan.due]),
        [[patient.id, filed.note.id, "draft", "2026-12-01"]],
      );
      assert.deepStrictEqual(
        filed.files.map((file) => [file.noteId, file.path]),
        [[filed.note.id, sheet.path]],
      );
      assert.deepStrictEqual(
        Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id),
        Option.some(patient.id),
      );

      // The thread's next message goes to the same note, which keeps the date it has.
      const next = yield* store.fileFromThread({
        ...message,
        summary: "LDL down on statin; HbA1c stable.",
        kind: "lab_sheet",
        labs: [{ testAsWritten: "HbA1c", value: 6.5, unit: "%", collected: "2026-04-10" }],
        files: [sheet],
      });
      assert.deepInclude(next.note, {
        id: filed.note.id,
        summary: "LDL down on statin; HbA1c stable.",
        kind: "lab_sheet",
        date: "2026-11-11",
      });
      assert.strictEqual(next.files.length, 1);
      assert.strictEqual((yield* store.listLabs({ patientId: patient.id })).length, 3);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files a thread's message to the Inbox, and nothing when a part is refused", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const sql = yield* MedDatabase.MedDatabase;
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const plan = { title: "Clinic visit", due: "2026-11-25", type: "follow_up" } as const;
      const evening = Date.parse("2026-11-11T20:00:00.000Z");
      yield* TestClock.setTime(evening);

      const inbox = yield* store.fileFromThread({
        threadId: "thread-1",
        patientId: null,
        title: "Unknown patient",
        needsYou: "Named only as Wayan; candidates: Wayan Sudarma, Wayan Arta.",
        labs: [ldl],
        plans: [plan],
      });

      assert.deepInclude(inbox.note, {
        patientId: null,
        needsYou: "Named only as Wayan; candidates: Wayan Sudarma, Wayan Arta.",
        // The calendar day where the server runs, which is not UTC's after 16:00 UTC in Bali.
        date: new Intl.DateTimeFormat("en-CA").format(evening),
      });
      assert.deepStrictEqual(
        inbox.labs.map((lab) => [lab.patientId, lab.isBaseline]),
        [[null, false]],
      );
      assert.deepStrictEqual(
        inbox.plans.map((filed) => filed.patientId),
        [null],
      );
      assert.isTrue(Option.isNone(yield* store.getThreadPatient("thread-1")));

      const refused = (input: Partial<Parameters<typeof store.fileFromThread>[0]>) =>
        refusedField(
          store.fileFromThread({ threadId: "thread-2", patientId: null, title: "Visit", ...input }),
        );
      assert.deepStrictEqual(
        yield* refused({ labs: [ldl, { ...ldl, testAsWritten: " " }], plans: [plan] }),
        ["BlankFieldError", "labs[1].testAsWritten"],
      );
      assert.deepStrictEqual(yield* refused({ labs: [ldl], plans: [{ ...plan, due: "soon" }] }), [
        "InvalidDateError",
        "plans[0].due",
      ]);
      assert.deepStrictEqual(yield* refused({ files: [{ name: "x.pdf", path: " " }] }), [
        "BlankFieldError",
        "files[0].path",
      ]);
      assert.deepStrictEqual(yield* refused({ title: " " }), ["BlankFieldError", "title"]);
      assert.deepStrictEqual(yield* refused({ date: "today" }), ["InvalidDateError", "date"]);
      assert.deepStrictEqual(yield* refused({ kind: "memo" as never }), [
        "InvalidChoiceError",
        "kind",
      ]);
      assert.deepStrictEqual(yield* refused({ patientId: "missing", labs: [ldl] }), [
        "ThreadNotLinkedError",
        undefined,
      ]);
      assert.deepStrictEqual(yield* sql`SELECT id FROM notes WHERE thread_id = 'thread-2'`, []);
      assert.strictEqual((yield* store.listLabs({ inbox: true })).length, 1);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("reads one patient's record, with the labs of one test when a test is named", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const other = yield* store.createPatient({ name: "Made" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const sheet = { name: "lipid-panel.pdf", path: "patient-files/lipid-panel.pdf" };
      const first = yield* fileLinked(store, {
        threadId: "thread-1",
        patientId: patient.id,
        title: "First visit",
        date: "2026-01-12",
        labs: [
          { ...ldl, testAsWritten: "Kolesterol LDL", value: 162, collected: "2026-01-10" },
          {
            testAsWritten: "Anti-dsDNA",
            value: null,
            valueText: "negative",
            collected: "2026-01-10",
          },
        ],
        files: [sheet],
      });
      const second = yield* fileLinked(store, {
        threadId: "thread-2",
        patientId: patient.id,
        title: "Follow-up",
        date: "2026-04-12",
        labs: [ldl, { testAsWritten: "HbA1c", value: 6.5, unit: "%", collected: "2026-04-10" }],
        plans: [{ title: "Repeat lipid panel", due: "2026-07-01", type: "lab" }],
      });
      yield* fileLinked(store, {
        threadId: "thread-3",
        patientId: other.id,
        title: "Someone else",
        labs: [ldl],
        plans: [{ title: "Clinic visit", due: "2026-05-01", type: "follow_up" }],
      });
      const labsOf = (test?: string) =>
        store
          .getPatientRecord({ patientId: patient.id, test })
          .pipe(Effect.map((record) => record.labs.map((lab) => [lab.testName, lab.collected])));

      const record = yield* store.getPatientRecord({ patientId: patient.id });

      assert.strictEqual(record.patient.id, patient.id);
      assert.deepStrictEqual(
        record.labs.map((lab) => [lab.testAsWritten, lab.collected]),
        [
          ["Kolesterol LDL", "2026-01-10"],
          ["Anti-dsDNA", "2026-01-10"],
          ["LDL", "2026-04-10"],
          ["HbA1c", "2026-04-10"],
        ],
      );
      assert.deepStrictEqual(
        record.plans.map((plan) => plan.title),
        ["Repeat lipid panel"],
      );
      assert.deepStrictEqual(
        record.notes.map((note) => [note.id, note.files.map((file) => file.path)]),
        [
          [second.note.id, []],
          [first.note.id, [sheet.path]],
        ],
      );
      const ldlHistory = [
        ["Kolesterol LDL", "2026-01-10"],
        ["Kolesterol LDL", "2026-04-10"],
      ];
      assert.deepStrictEqual(yield* labsOf("ldl"), ldlHistory);
      assert.deepStrictEqual(yield* labsOf("LDL-C"), ldlHistory);
      assert.deepStrictEqual(yield* labsOf(" anti-dsdna "), [["Anti-dsDNA", "2026-01-10"]]);
      assert.deepStrictEqual(yield* labsOf("Troponin"), []);
      assert.strictEqual(
        yield* failureTag(store.getPatientRecord({ patientId: "missing" })),
        "PatientNotFoundError",
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("lists the plans still ahead by due date, with the patient's name", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const sql = yield* MedDatabase.MedDatabase;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const verified = yield* fileLinked(store, {
        threadId: "thread-1",
        patientId: wayan.id,
        title: "Visit",
        plans: [
          { title: "Repeat lipid panel", due: "2026-12-01", type: "lab" },
          { title: "MRI brain", due: "2026-11-20", type: "imaging" },
        ],
      });
      yield* store.verifyNote(verified.note.id);
      yield* sql`UPDATE plans SET status = 'done' WHERE title = 'MRI brain'`;
      yield* fileLinked(store, {
        threadId: "thread-2",
        patientId: made.id,
        title: "Visit",
        plans: [{ title: "Clinic visit", due: "2026-11-25", type: "follow_up" }],
      });
      yield* store.fileFromThread({
        threadId: "thread-3",
        patientId: null,
        title: "Unknown patient",
        plans: [{ title: "EEG", due: "2026-11-22", type: "procedure" }],
      });
      const upcoming = (range?: Parameters<typeof store.listUpcomingPlans>[0]) =>
        store
          .listUpcomingPlans(range)
          .pipe(
            Effect.map((plans) =>
              plans.map((plan) => [plan.due, plan.title, plan.patientName, plan.status]),
            ),
          );
      const eeg = ["2026-11-22", "EEG", null, "draft"];
      const visit = ["2026-11-25", "Clinic visit", "Made", "draft"];
      const lipids = ["2026-12-01", "Repeat lipid panel", "Wayan", "planned"];

      assert.deepStrictEqual(yield* upcoming(), [eeg, visit, lipids]);
      assert.deepStrictEqual(yield* upcoming({ from: "2026-11-25" }), [visit, lipids]);
      assert.deepStrictEqual(yield* upcoming({ to: "2026-11-25" }), [eeg, visit]);
      assert.deepStrictEqual(yield* upcoming({ from: "2026-11-23", to: "2026-11-30" }), [visit]);
      assert.deepStrictEqual(yield* refusedField(store.listUpcomingPlans({ from: "next week" })), [
        "InvalidDateError",
        "from",
      ]);
      assert.deepStrictEqual(yield* upcoming({ from: "2026-11-25", to: "2026-11-25" }), [visit]);
      const backwards = yield* store
        .listUpcomingPlans({ from: "2026-12-01", to: "2026-11-01" })
        .pipe(Effect.flip);
      assert.strictEqual(backwards._tag, "DateRangeError");
      assert.strictEqual(backwards.message, "from must not be later than to.");

      yield* store.updatePatient(made.id, { status: "archived" });
      assert.deepStrictEqual(yield* upcoming(), [eeg, lipids]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("lists what waits for the doctor: the Inbox, open questions and drafts", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const quiet = yield* store.createPatient({ name: "Ketut" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const plan = { title: "Clinic visit", due: "2026-11-25", type: "follow_up" } as const;
      const message = { title: "Visit", date: "2026-11-11" };
      const drafts = yield* fileLinked(store, {
        ...message,
        threadId: "thread-1",
        patientId: wayan.id,
        labs: [ldl, { ...ldl, testAsWritten: "HDL" }],
        plans: [plan],
      });
      const cleared = yield* fileLinked(store, {
        ...message,
        threadId: "thread-2",
        patientId: wayan.id,
        labs: [ldl],
      });
      yield* store.verifyNote(cleared.note.id);
      const question = yield* fileLinked(store, {
        ...message,
        threadId: "thread-3",
        patientId: made.id,
        needsYou: "Is the HbA1c unit % or mmol/mol?",
      });
      yield* fileLinked(store, { ...message, threadId: "thread-4", patientId: quiet.id });
      const inbox = yield* store.fileFromThread({
        ...message,
        threadId: "thread-5",
        patientId: null,
        needsYou: "Named only as Wayan.",
        plans: [plan],
      });

      const waiting = yield* store.listNeedsYou();

      assert.deepStrictEqual(
        waiting.inbox.map((note) => [note.id, note.needsYou, note.draftLabs, note.draftPlans]),
        [[inbox.note.id, "Named only as Wayan.", 0, 1]],
      );
      assert.deepStrictEqual(
        waiting.patients
          .map(({ patient, draftLabs, draftPlans, notes }) => ({
            name: patient.name,
            draftLabs,
            draftPlans,
            notes: notes.map((note) => [note.id, note.needsYou, note.draftLabs, note.draftPlans]),
          }))
          .toSorted((a, b) => a.name.localeCompare(b.name)),
        [
          {
            name: "Made",
            draftLabs: 0,
            draftPlans: 0,
            notes: [[question.note.id, "Is the HbA1c unit % or mmol/mol?", 0, 0]],
          },
          {
            name: "Wayan",
            draftLabs: 2,
            draftPlans: 1,
            notes: [[drafts.note.id, "", 2, 1]],
          },
        ],
      );

      yield* store.updatePatient(wayan.id, { status: "archived" });
      const afterArchiving = yield* store.listNeedsYou();
      assert.deepStrictEqual(
        afterArchiving.patients.map(({ patient }) => patient.name),
        ["Made"],
      );
      assert.strictEqual(afterArchiving.inbox.length, 1);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("moves a thread's own Inbox note, and verifies its note for the linked patient", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const other = yield* store.createPatient({ name: "Made" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const inbox = yield* store.fileFromThread({
        threadId: "thread-1",
        patientId: null,
        title: "Unknown patient",
        labs: [{ ...ldl, value: 200, collected: "2026-01-10" }],
      });
      const elsewhere = yield* fileLinked(store, {
        threadId: "thread-2",
        patientId: patient.id,
        title: "Visit",
        labs: [ldl],
      });
      const toPatient = { threadId: "thread-1", patientId: patient.id };

      // Nothing links thread-1 yet, and thread-3 has filed nothing at all.
      const unlinked = yield* store.verifyThreadNote({ threadId: "thread-1" }).pipe(Effect.flip);
      assert.strictEqual(unlinked._tag, "ThreadHasNoPatientError");
      assert.strictEqual(
        unlinked.message,
        "This thread is not linked to a patient; find the patient by URN, or move this thread's Inbox note to a patient, before verifying.",
      );
      assert.strictEqual(
        yield* failureTag(
          store.moveThreadNoteToPatient({ threadId: "thread-3", patientId: patient.id }),
        ),
        "ThreadNoteNotFoundError",
      );
      assert.strictEqual((yield* store.listLabs({ inbox: true })).length, 1);

      const moved = yield* store.moveThreadNoteToPatient(toPatient);
      assert.deepInclude(moved.note, { id: inbox.note.id, patientId: patient.id });
      assert.deepStrictEqual(
        moved.labs.map((lab) => [lab.collected, lab.isBaseline, lab.sourceNoteId]),
        [["2026-01-10", true, inbox.note.id]],
      );
      assert.isTrue(Option.isNone(moved.relinkedFrom));
      assert.deepStrictEqual(
        Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id),
        Option.some(patient.id),
      );
      assert.strictEqual(
        yield* failureTag(store.moveThreadNoteToPatient(toPatient)),
        "ThreadNoteNotFoundError",
      );

      // Only this thread's note is verified: thread-2's result for the same patient stays a draft.
      assert.deepStrictEqual(yield* store.verifyThreadNote({ threadId: "thread-1" }), {
        labsVerified: 1,
        plansPlanned: 0,
        patientActivated: true,
      });
      assert.deepStrictEqual(
        (yield* store.listLabs({ patientId: patient.id })).map((lab) => [
          lab.collected,
          lab.status,
          lab.isBaseline,
          lab.changeFromBaseline,
          lab.sourceNoteId,
        ]),
        [
          ["2026-01-10", "verified", true, null, inbox.note.id],
          ["2026-04-10", "draft", false, -100, elsewhere.note.id],
        ],
      );

      // A thread linked to a patient it has filed nothing for has no note to verify.
      yield* store.linkThread({ threadId: "thread-1", patientId: other.id });
      const noNote = yield* store.verifyThreadNote({ threadId: "thread-1" }).pipe(Effect.flip);
      assert.strictEqual(noNote._tag, "ThreadNoteNotFoundError");
      assert.strictEqual(noNote.message, `This thread has filed no note for patient ${other.id}.`);

      // Moving a later Inbox note says which patient the thread was linked to before.
      yield* store.fileFromThread({ threadId: "thread-1", patientId: null, title: "Another" });
      const again = yield* store.moveThreadNoteToPatient(toPatient);
      assert.deepStrictEqual(
        Option.map(again.relinkedFrom, (previous) => previous.id),
        Option.some(other.id),
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect(
    "links a thread by an exact URN or by a patient created from one, never by a name",
    () =>
      Effect.gen(function* () {
        const store = yield* PatientStore.PatientStore;
        const wayan = yield* store.createPatient({ name: "Wayan Sudarma", urn: "00-12-34-56" });
        const linked = (threadId: string) =>
          store
            .getThreadPatient(threadId)
            .pipe(Effect.map(Option.map((patient: PatientStore.Patient) => patient.id)));
        const find = (query: { readonly urn?: string; readonly name?: string }) =>
          store.findPatientFromThread({ threadId: "thread-1", ...query }).pipe(
            Effect.map((found) => ({
              match: Option.getOrNull(Option.map(found.match, (patient) => patient.id)),
              candidates: found.candidates.map((patient) => patient.id),
              relinkedFrom: Option.getOrNull(
                Option.map(found.relinkedFrom, (patient) => patient.name),
              ),
            })),
          );

        assert.deepStrictEqual(yield* find({ name: "wayan" }), {
          match: null,
          candidates: [wayan.id],
          relinkedFrom: null,
        });
        assert.deepStrictEqual(yield* find({ urn: "99-99", name: "wayan" }), {
          match: null,
          candidates: [wayan.id],
          relinkedFrom: null,
        });
        assert.deepStrictEqual(yield* linked("thread-1"), Option.none());

        const matched = { match: wayan.id, candidates: [], relinkedFrom: null };
        assert.deepStrictEqual(yield* find({ urn: "00123456" }), matched);
        assert.deepStrictEqual(yield* linked("thread-1"), Option.some(wayan.id));
        assert.deepStrictEqual(yield* find({ urn: "00 12 34 56" }), matched);
        assert.deepStrictEqual(
          yield* refusedField(store.findPatientFromThread({ threadId: "t" })),
          ["BlankFieldError", "urn or name"],
        );

        // A patient created from a new URN takes the thread over, and says whom it left.
        const created = yield* store.createPatientFromThread({
          threadId: "thread-1",
          name: "Ni Made Ayu",
          urn: "00-77-88-99",
          sex: "female",
        });
        assert.deepInclude(created.patient, { name: "Ni Made Ayu", status: "new", sex: "female" });
        assert.strictEqual(created.patient.urnKey, "00778899");
        assert.deepStrictEqual(
          Option.map(created.relinkedFrom, (previous) => [previous.id, previous.name]),
          Option.some([wayan.id, "Wayan Sudarma"]),
        );
        assert.deepStrictEqual(yield* linked("thread-1"), Option.some(created.patient.id));
        assert.deepStrictEqual(yield* find({ urn: "00-12-34-56" }), {
          ...matched,
          relinkedFrom: "Ni Made Ayu",
        });

        // Without a URN there is no evidence to create a patient on, and a taken URN names its holder.
        const create = (urn: string) =>
          store.createPatientFromThread({ threadId: "thread-2", name: "Someone", urn });
        assert.deepStrictEqual(yield* refusedField(create(" ")), ["BlankFieldError", "urn"]);
        assert.deepStrictEqual(yield* refusedField(create("--")), ["BlankFieldError", "urn"]);
        const taken = yield* create("00.12.34.56").pipe(Effect.flip);
        assert.deepInclude(taken, {
          _tag: "PatientUrnTakenError",
          patientId: wayan.id,
          patientName: "Wayan Sudarma",
          status: "new",
          urn: "00-12-34-56",
        });
        assert.deepStrictEqual(yield* linked("thread-2"), Option.none());
        assert.strictEqual((yield* store.listPatients()).length, 2);
      }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files to a patient only from a thread linked to that patient, and never links", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan Sudarma", urn: "00-12-34-56" });
      const made = yield* store.createPatient({ name: "Made" });
      const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
      const file = (patientId: string | null) =>
        store.fileFromThread({ threadId: "thread-1", patientId, title: "Visit", labs: [ldl] });
      const refusal = (patientId: string) =>
        `This thread is not linked to patient ${patientId}; find the patient by URN, create them from a URN, or file to the Inbox.`;

      // A name's candidate is not evidence: the thread is linked to nobody.
      const candidate = (yield* store.findPatientFromThread({ threadId: "thread-1", name: "made" }))
        .candidates[0]!;
      const toCandidate = yield* file(candidate.id).pipe(Effect.flip);
      assert.strictEqual(toCandidate._tag, "ThreadNotLinkedError");
      assert.strictEqual(toCandidate.message, refusal(made.id));
      assert.isTrue(Option.isNone(yield* store.getThreadPatient("thread-1")));

      // Linked to Wayan, the thread files to Wayan and is refused for Made.
      yield* store.findPatientFromThread({ threadId: "thread-1", urn: "00-12-34-56" });
      assert.strictEqual((yield* file(wayan.id)).note.patientId, wayan.id);
      const toOther = yield* file(made.id).pipe(Effect.flip);
      assert.strictEqual(toOther.message, refusal(made.id));
      assert.deepStrictEqual(
        Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id),
        Option.some(wayan.id),
      );
      assert.deepStrictEqual(yield* store.listLabs({ patientId: made.id }), []);
      assert.strictEqual((yield* store.listLabs({ patientId: wayan.id })).length, 1);

      // The Inbox is always open, and filing there changes no link.
      assert.strictEqual((yield* file(null)).note.patientId, null);
      assert.deepStrictEqual(
        Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id),
        Option.some(wayan.id),
      );
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("files a repeated lab or plan once and returns the row it already has", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const ldl = { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" };
      const antibody = {
        testAsWritten: "Anti-dsDNA",
        value: null,
        valueText: "negative",
        collected: "2026-01-10",
      };
      const plan = { title: "Repeat lipid panel", due: "2026-12-01", type: "lab" } as const;
      const message = {
        threadId: "thread-1",
        patientId: patient.id,
        title: "Lipid follow-up",
        labs: [ldl, antibody],
        plans: [plan],
      };
      const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((row) => row.id);

      const first = yield* fileLinked(store, message);
      // The same message again, as an agent sends it after a timeout; LDL-C is the same test.
      const retry = yield* store.fileFromThread({
        ...message,
        labs: [{ ...ldl, testAsWritten: "LDL-C" }, antibody],
      });

      assert.deepStrictEqual(ids(retry.labs), ids(first.labs));
      assert.deepStrictEqual(ids(retry.plans), ids(first.plans));
      assert.strictEqual((yield* store.listLabs({ patientId: patient.id })).length, 2);
      assert.strictEqual((yield* store.listPlans({ patientId: patient.id })).length, 1);

      // Another value, text, unit, date or due date is another row; a repeat inside one call is not.
      const changed = yield* store.fileFromThread({
        ...message,
        labs: [
          { ...ldl, value: 191 },
          { ...ldl, valueText: "190,0" },
          { ...ldl, unit: "mg%" },
          { ...ldl, collected: "2026-01-11" },
          { ...ldl, collected: "2026-01-11" },
          { ...antibody, valueText: "positive" },
        ],
        plans: [
          { ...plan, due: "2026-12-02" },
          { ...plan, title: " Repeat lipid panel ", type: "follow_up" },
        ],
      });
      assert.strictEqual(new Set([...ids(first.labs), ...ids(changed.labs)]).size, 7);
      assert.strictEqual(changed.labs[3]!.id, changed.labs[4]!.id);
      assert.strictEqual((yield* store.listLabs({ patientId: patient.id })).length, 7);
      assert.deepStrictEqual(
        (yield* store.listPlans({ patientId: patient.id })).map((filed) => [filed.due, filed.type]),
        [
          ["2026-12-01", "lab"],
          ["2026-12-02", "lab"],
        ],
      );
      assert.strictEqual(changed.plans[1]!.id, first.plans[0]!.id);

      // The same result on another thread's note is that note's own row.
      const elsewhere = yield* fileLinked(store, { ...message, threadId: "thread-2" });
      assert.notStrictEqual(elsewhere.labs[0]!.id, first.labs[0]!.id);
      assert.strictEqual((yield* store.listLabs({ patientId: patient.id })).length, 9);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("adds each filing's question to needsYou, and keeps the title it has", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const file = (input: Partial<Parameters<Store["fileFromThread"]>[0]>) =>
        store
          .fileFromThread({ threadId: "thread-1", patientId: null, ...input })
          .pipe(Effect.map(({ note }) => [note.title, note.summary, note.needsYou]));
      const unit = "Is the HbA1c unit % or mmol/mol?";
      const whose = "Named only as Wayan.";

      assert.deepStrictEqual(yield* refusedField(file({ summary: "No title yet." })), [
        "BlankFieldError",
        "title",
      ]);
      assert.deepStrictEqual(
        yield* file({ title: "Lab sheet", summary: "First.", needsYou: unit }),
        ["Lab sheet", "First.", unit],
      );
      // A later filing without a title or summary changes neither; its question is one more line.
      assert.deepStrictEqual(yield* file({ needsYou: whose }), [
        "Lab sheet",
        "First.",
        `${unit}\n${whose}`,
      ]);
      assert.deepStrictEqual(yield* file({ needsYou: ` ${unit} `, summary: "Second." }), [
        "Lab sheet",
        "Second.",
        `${unit}\n${whose}`,
      ]);
      assert.deepStrictEqual(yield* file({ title: "Lipid sheet" }), [
        "Lipid sheet",
        "Second.",
        `${unit}\n${whose}`,
      ]);
      assert.deepStrictEqual(yield* refusedField(file({ title: " " })), [
        "BlankFieldError",
        "title",
      ]);

      // Only an explicit clear empties it; with a question, the question is all that is left.
      assert.deepStrictEqual(yield* file({ clearNeedsYou: true, needsYou: whose }), [
        "Lipid sheet",
        "Second.",
        whose,
      ]);
      assert.deepStrictEqual(yield* file({ clearNeedsYou: false }), [
        "Lipid sheet",
        "Second.",
        whose,
      ]);
      assert.deepStrictEqual(yield* file({ clearNeedsYou: true }), ["Lipid sheet", "Second.", ""]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("says which baseline a result was compared with, or why it was not compared", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const patient = yield* store.createPatient({ name: "Wayan" });
      const results = [
        { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" },
        { testAsWritten: "LDL", value: 2.6, unit: "mmol/L", collected: "2026-04-10" },
        { testAsWritten: "LDL", value: 2.0, unit: "g/L", collected: "2026-05-10" },
        { testAsWritten: "LDL", value: 150, collected: "2026-06-10" },
        { testAsWritten: "LDL", value: null, valueText: "hemolysed", collected: "2026-07-10" },
        { testAsWritten: "HDL", value: 40, collected: "2026-01-10" },
        { testAsWritten: "HDL", value: 45, unit: "mg%", collected: "2026-04-10" },
        {
          testAsWritten: "Anti-dsDNA",
          value: null,
          valueText: "negative",
          collected: "2026-01-10",
        },
      ];
      const comparison = (labs: ReadonlyArray<PatientStore.Lab>) =>
        labs.map((lab) => [lab.baseline, lab.changeUnit, lab.notCompared]);
      const expected = [
        [null, null, "first_result"],
        [{ value: 190, unit: "mg/dL", collected: "2026-01-10" }, "mg/dL", null],
        [null, null, "no_verified_conversion"],
        [null, null, "result_has_no_unit"],
        [null, null, "result_has_no_number"],
        [null, null, "first_result"],
        [null, null, "baseline_has_no_unit"],
        [null, null, "result_has_no_number"],
      ];

      const filed = yield* fileLinked(store, {
        threadId: "thread-1",
        patientId: patient.id,
        title: "Lipids",
        labs: results,
      });
      assert.deepStrictEqual(comparison(filed.labs), expected);
      // Published pair: 2.6 mmol/L is 100 mg/dL, so the change of -90 is in mg/dL.
      assert.closeTo(filed.labs[1]!.changeFromBaseline!, -90, 1);

      // A record read says the same, and a retried filing returns the rows with their comparison.
      const record = yield* store.getPatientRecord({ patientId: patient.id });
      assert.sameDeepMembers(comparison(record.labs), expected);
      const retry = yield* store.fileFromThread({
        threadId: "thread-1",
        patientId: patient.id,
        labs: results,
      });
      assert.deepStrictEqual(comparison(retry.labs), expected);

      // The baseline's unit is given as it was written; the change is in that unit, spelled out.
      const hemoglobin = yield* store.fileFromThread({
        threadId: "thread-1",
        patientId: patient.id,
        labs: [
          { testAsWritten: "Hb", value: 12, unit: "gr/dl", collected: "2026-01-10" },
          { testAsWritten: "Hb", value: 110, unit: "g/L", collected: "2026-04-10" },
        ],
      });
      assert.deepStrictEqual(comparison(hemoglobin.labs), [
        [null, null, "first_result"],
        [{ value: 12, unit: "gr/dl", collected: "2026-01-10" }, "g/dL", null],
      ]);
      // Worked by hand: 110 g/L is 11 g/dL; 11 - 12 = -1.
      assert.closeTo(hemoglobin.labs[1]!.changeFromBaseline!, -1, 1e-9);

      // Inbox results belong to no patient, so nothing is there to compare them with.
      const inbox = yield* store.fileFromThread({
        threadId: "thread-2",
        patientId: null,
        title: "Unknown patient",
        labs: [results[0]!, results[1]!],
      });
      assert.deepStrictEqual(comparison(inbox.labs), [
        [null, null, "in_inbox"],
        [null, null, "in_inbox"],
      ]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect("links a thread to one patient and reads the link back", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* store.createPatient({ name: "Wayan" });
      const made = yield* store.createPatient({ name: "Made" });
      const linked = (threadId: string) =>
        store
          .getThreadPatient(threadId)
          .pipe(Effect.map(Option.map((patient: PatientStore.Patient) => patient.id)));

      assert.deepStrictEqual(yield* linked("thread-1"), Option.none());
      yield* store.linkThread({ threadId: "thread-1", patientId: wayan.id });
      assert.deepStrictEqual(yield* linked("thread-1"), Option.some(wayan.id));
      yield* store.linkThread({ threadId: "thread-1", patientId: made.id });
      assert.deepStrictEqual(yield* linked("thread-1"), Option.some(made.id));
      assert.deepStrictEqual(yield* linked("thread-2"), Option.none());
      assert.strictEqual(
        yield* failureTag(store.linkThread({ threadId: "thread-2", patientId: "missing" })),
        "PatientNotFoundError",
      );
    }).pipe(Effect.provide(layerStore)),
  );
});
