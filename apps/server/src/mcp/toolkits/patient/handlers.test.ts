import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as MedDatabase from "../../../med/MedDatabase.ts";
import * as PatientStore from "../../../med/PatientStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as PatientHandlers from "./handlers.ts";
import { PatientToolkit } from "./tools.ts";

type Tools = typeof PatientToolkit.tools;

const layerPatientTools = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-tools-test-" });
    return McpToolAccess.HandlersLayer.layer(PatientHandlers.layer).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          PatientStore.layer.pipe(
            Layer.provide(MedDatabase.layerFromPath(path.join(directory, "t3med.sqlite"))),
          ),
          liveThreadsLayer,
        ),
      ),
    );
  }),
);

const scope = (
  thread: McpInvocationContext.McpInvocationScope["thread"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:patients"),
  requestNamespace: "provider:patients",
  thread,
  client:
    thread === undefined
      ? { sessionId: "session-1", label: "Outside client", access: "full-access" }
      : undefined,
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
});

const threadScope = (threadId: string) =>
  scope({
    threadId: ThreadId.make(threadId),
    providerSessionId: "provider:patients",
    providerInstanceId: ProviderInstanceId.make("codex"),
  });

/** The encoded result of one tool call, made by the agent of `threadId`. */
const call = <Name extends keyof Tools & string>(
  name: Name,
  params: Tool.Parameters<Tools[Name]>,
  caller: McpInvocationContext.McpInvocationScope = threadScope("thread-1"),
) =>
  Effect.gen(function* () {
    const toolkit = yield* PatientToolkit;
    const results = yield* toolkit.handle(name, params).pipe(Stream.unwrap, Stream.runCollect);
    // A refusal carries these two instead of the tool's own fields.
    return results.at(-1)?.result as Tool.SuccessEncoded<Tools[Name]> & {
      readonly code?: string;
      readonly message?: string;
    };
  }).pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, caller));

const from = (threadId: string) => threadScope(threadId);

const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("patient tools", (it) => {
  it.effect("patient_find matches a URN exactly and offers a name's patients as candidates", () =>
    Effect.gen(function* () {
      const created = yield* call("patient_create", {
        name: "I Wayan Sudarma",
        urn: "00-12-34-56",
        sex: "male",
      });
      const summary = {
        patientId: created.patientId,
        name: "I Wayan Sudarma",
        urn: "00-12-34-56",
        status: "new",
      };

      expect(created).toMatchObject({ ...summary, sex: "male", alsoWrittenAs: [] });
      expect(yield* call("patient_find", { urn: "00123456" })).toEqual({
        match: summary,
        candidates: [],
      });
      expect(yield* call("patient_find", { urn: "99-99" })).toEqual({
        match: null,
        candidates: [],
      });
      expect(yield* call("patient_find", { name: "wayan" })).toEqual({
        match: null,
        candidates: [summary],
      });
      expect(yield* call("patient_find", {})).toMatchObject({
        code: "invalid_request",
        message: "urn or name must not be blank.",
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_create and patient_update refuse a URN that belongs to a patient", () =>
    Effect.gen(function* () {
      const wayan = yield* call("patient_create", { name: "Wayan Sudarma", urn: "00-12-34-56" });
      const made = yield* call("patient_create", { name: "Made" });
      const refusal = {
        code: "invalid_request",
        message: `URN 00-12-34-56 belongs to patient ${wayan.patientId} (Wayan Sudarma, new). Nothing was changed; use that patient.`,
      };

      expect(yield* call("patient_create", { name: "Someone", urn: "00 12 34 56" })).toMatchObject(
        refusal,
      );
      expect(
        yield* call("patient_update", { patientId: made.patientId, urn: "00123456" }),
      ).toMatchObject(refusal);
      expect(
        yield* call("patient_update", {
          patientId: made.patientId,
          name: "Ni Made Ayu",
          diagnoses: "Migraine",
          addSpelling: "Bu Made",
        }),
      ).toMatchObject({
        patientId: made.patientId,
        name: "Ni Made Ayu",
        diagnoses: "Migraine",
        alsoWrittenAs: ["Made", "Bu Made"],
      });
      expect(yield* call("patient_update", { patientId: "missing", name: "X" })).toMatchObject({
        code: "invalid_request",
        message: "No patient has the id missing.",
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_file files a message as drafts and returns each lab's change", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { patientId } = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
      const sheet = { name: "lipid-panel.pdf", path: "patient-files/lipid-panel.pdf" };

      const filed = yield* call("patient_file", {
        patientId,
        title: "Lipid follow-up",
        summary: "LDL down on statin.",
        date: "2026-11-11",
        labs: [
          { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" },
          {
            testAsWritten: "LDL",
            value: 2.6,
            valueText: "2,6",
            unit: "mmol/L",
            referenceRange: "< 2,6",
            flag: "normal",
            collected: "2026-04-10",
            lab: "Prodia",
          },
        ],
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab" }],
        files: [sheet],
      });

      expect(filed).toMatchObject({
        patientId,
        labs: [
          { testName: "LDL", value: 190, status: "draft", isBaseline: true, changePercent: null },
          {
            testId: "ldl",
            value: 2.6,
            valueText: "2,6",
            unit: "mmol/L",
            referenceRange: "< 2,6",
            flag: "normal",
            lab: "Prodia",
            status: "draft",
            isBaseline: false,
          },
        ],
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab", status: "draft" }],
      });
      // Published pair: 2.6 mmol/L is 100 mg/dL; 100 - 190 = -90; -90 / 190 = -47.4 %.
      const later = filed.labs[1];
      expect(Math.abs((later?.valueInBaselineUnit ?? 0) - 100)).toBeLessThan(1);
      expect(Math.abs((later?.changeFromBaseline ?? 0) + 90)).toBeLessThan(1);
      expect(Math.abs((later?.changePercent ?? 0) + 47.4)).toBeLessThan(0.6);
      expect(Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id)).toEqual(
        Option.some(patientId),
      );

      const record = yield* call("patient_record", { patientId });
      expect(record).toMatchObject({
        patient: { patientId, name: "Wayan", status: "new" },
        labs: [{ collected: "2026-01-10" }, { collected: "2026-04-10" }],
        plans: [{ title: "Repeat lipid panel", noteId: filed.noteId }],
        notes: [
          {
            noteId: filed.noteId,
            threadId: "thread-1",
            kind: "chat",
            title: "Lipid follow-up",
            summary: "LDL down on statin.",
            date: "2026-11-11",
            files: [sheet],
          },
        ],
      });
      expect((yield* call("patient_record", { patientId, test: "LDL-C" })).labs).toHaveLength(2);
      expect((yield* call("patient_record", { patientId, test: "HbA1c" })).labs).toEqual([]);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("an Inbox filing stays unlinked until patient_move_note, which sets baselines", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { patientId } = yield* call("patient_create", { name: "Wayan Sudarma" });
      yield* call("patient_file", { patientId, title: "Visit", labs: [ldl] }, from("thread-0"));

      const inbox = yield* call("patient_file", {
        patientId: "inbox",
        title: "Lipid sheet, patient unclear",
        kind: "lab_sheet",
        needsYou: `Named only as Wayan. Candidate: Wayan Sudarma (${patientId}).`,
        labs: [{ ...ldl, value: 200, collected: "2026-01-10" }],
      });

      expect(inbox).toMatchObject({
        patientId: null,
        labs: [{ isBaseline: false, changeFromBaseline: null }],
      });
      expect(Option.isNone(yield* store.getThreadPatient("thread-1"))).toBe(true);
      expect(yield* call("patient_review", {})).toMatchObject({
        inbox: [
          {
            noteId: inbox.noteId,
            kind: "lab_sheet",
            needsYou: `Named only as Wayan. Candidate: Wayan Sudarma (${patientId}).`,
            draftLabs: 1,
            draftPlans: 0,
          },
        ],
        patients: [{ patientId, name: "Wayan Sudarma", draftLabs: 1, draftPlans: 0 }],
      });
      expect(yield* call("patient_verify", { noteId: inbox.noteId })).toMatchObject({
        code: "invalid_request",
        message: `Note ${inbox.noteId} is in the Inbox; move it to a patient before verifying it.`,
      });

      expect(yield* call("patient_move_note", { patientId })).toMatchObject({
        noteId: inbox.noteId,
        patientId,
        labs: [{ collected: "2026-01-10", isBaseline: true }],
      });
      expect((yield* call("patient_record", { patientId, test: "ldl" })).labs).toMatchObject([
        { collected: "2026-01-10", value: 200, isBaseline: true, changeFromBaseline: null },
        // Worked by hand: 100 - 200 = -100; -100 / 200 = -50 %.
        { collected: "2026-04-10", value: 100, changeFromBaseline: -100, changePercent: -50 },
      ]);
      expect(Option.map(yield* store.getThreadPatient("thread-1"), (linked) => linked.id)).toEqual(
        Option.some(patientId),
      );
      expect((yield* call("patient_review", {})).inbox).toEqual([]);
      expect(yield* call("patient_move_note", { patientId })).toMatchObject({
        code: "invalid_request",
        message: "This thread has no note in the Inbox.",
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_move_note moves another thread's Inbox note by its id", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const { patientId } = yield* call("patient_create", { name: "Wayan" });
      const inbox = yield* call(
        "patient_file",
        { patientId: "inbox", title: "Unknown patient", labs: [ldl] },
        from("thread-2"),
      );

      expect(yield* call("patient_move_note", { patientId, noteId: inbox.noteId })).toMatchObject({
        noteId: inbox.noteId,
        patientId,
        labs: [{ isBaseline: true }],
      });
      expect(Option.map(yield* store.getThreadPatient("thread-2"), (linked) => linked.id)).toEqual(
        Option.some(patientId),
      );
      expect(Option.isNone(yield* store.getThreadPatient("thread-1"))).toBe(true);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_verify makes the thread's drafts real and a new patient active", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call("patient_create", { name: "Wayan" });
      const filed = yield* call("patient_file", {
        patientId,
        title: "Visit",
        labs: [ldl],
        plans: [{ title: "Clinic visit", due: "2026-11-25", type: "follow_up" }],
      });
      const other = yield* call(
        "patient_file",
        { patientId, title: "Another chat", labs: [{ ...ldl, testAsWritten: "HDL" }] },
        from("thread-2"),
      );

      expect(yield* call("patient_verify", {})).toMatchObject({
        code: "invalid_request",
        message: "Pass `patientId` for this thread's note, or `noteId`.",
      });
      expect(yield* call("patient_verify", { patientId }, from("thread-9"))).toMatchObject({
        code: "invalid_request",
        message: `This thread has filed no note for patient ${patientId}.`,
      });
      expect(yield* call("patient_verify", { patientId })).toEqual({
        labsVerified: 1,
        plansPlanned: 1,
        patientActivated: true,
      });
      expect(yield* call("patient_record", { patientId })).toMatchObject({
        patient: { status: "active" },
        labs: [
          { testName: "LDL", status: "verified", noteId: filed.noteId },
          { testName: "HDL", status: "draft", noteId: other.noteId },
        ],
        plans: [{ status: "planned" }],
      });
      expect(yield* call("patient_verify", { noteId: other.noteId })).toEqual({
        labsVerified: 1,
        plansPlanned: 0,
        patientActivated: false,
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_upcoming lists draft and planned plans soonest first, with the patient", () =>
    Effect.gen(function* () {
      const wayan = yield* call("patient_create", { name: "Wayan" });
      const made = yield* call("patient_create", { name: "Made" });
      yield* call("patient_file", {
        patientId: wayan.patientId,
        title: "Visit",
        plans: [
          { title: "Repeat lipid panel", due: "2026-12-01", type: "lab" },
          { title: "MRI brain", due: "2026-11-20", type: "imaging" },
        ],
      });
      yield* call("patient_verify", { patientId: wayan.patientId });
      yield* call(
        "patient_file",
        {
          patientId: made.patientId,
          title: "Visit",
          plans: [{ title: "Clinic visit", due: "2026-11-25", type: "follow_up" }],
        },
        from("thread-2"),
      );
      yield* call(
        "patient_file",
        {
          patientId: "inbox",
          title: "Unknown patient",
          plans: [{ title: "EEG", due: "2026-11-22", type: "procedure" }],
        },
        from("thread-3"),
      );
      const mri = { due: "2026-11-20", title: "MRI brain", patientName: "Wayan" };
      const eeg = { due: "2026-11-22", title: "EEG", patientId: null, patientName: null };
      const visit = { due: "2026-11-25", title: "Clinic visit", patientName: "Made" };
      const lipids = { due: "2026-12-01", title: "Repeat lipid panel", patientName: "Wayan" };

      expect(yield* call("patient_upcoming", {})).toMatchObject({
        plans: [
          { ...mri, status: "planned", type: "imaging", patientId: wayan.patientId },
          { ...eeg, status: "draft" },
          { ...visit, status: "draft" },
          { ...lipids, status: "planned" },
        ],
      });
      const ranged = yield* call("patient_upcoming", { from: "2026-11-21", to: "2026-11-25" });
      expect(ranged.plans).toHaveLength(2);
      expect(ranged).toMatchObject({ plans: [eeg, visit] });
      expect(yield* call("patient_upcoming", { from: "next week" })).toMatchObject({
        code: "invalid_request",
        message: "from must be a calendar date written as YYYY-MM-DD.",
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("a refused filing is a readable tool error, and nothing of it is filed", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call("patient_create", { name: "Wayan" });
      const filing = { patientId, title: "Visit" };

      expect(
        yield* call("patient_file", {
          ...filing,
          labs: [ldl, { ...ldl, testAsWritten: " " }],
          plans: [{ title: "Clinic visit", due: "2026-11-25", type: "follow_up" }],
        }),
      ).toMatchObject({
        _tag: "OrchestratorMcpFailure",
        code: "invalid_request",
        message: "labs[1].testAsWritten must not be blank.",
      });
      expect(
        yield* call("patient_file", {
          ...filing,
          labs: [{ testAsWritten: "LDL", unit: "mg/dL", collected: "2026-04-10" }],
        }),
      ).toMatchObject({
        code: "invalid_request",
        message:
          "labs[0].value must be a finite number, or null with the result as written in valueText.",
      });
      expect(
        yield* call("patient_file", { ...filing, patientId: "missing", labs: [ldl] }),
      ).toMatchObject({ code: "invalid_request", message: "No patient has the id missing." });
      expect(yield* call("patient_record", { patientId })).toMatchObject({
        labs: [],
        plans: [],
        notes: [],
      });
      expect(
        yield* call("patient_file", {
          ...filing,
          labs: [{ testAsWritten: "Anti-dsDNA", valueText: "negative", collected: "2026-04-10" }],
        }),
      ).toMatchObject({ labs: [{ value: null, valueText: "negative", isBaseline: false }] });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient tools serve only an agent running in a thread", () =>
    Effect.gen(function* () {
      const outside = scope(undefined);
      const refused = { code: "thread_credential_required" };

      expect(yield* call("patient_find", { name: "wayan" }, outside)).toMatchObject(refused);
      expect(yield* call("patient_review", {}, outside)).toMatchObject(refused);
      expect(yield* call("patient_create", { name: "Wayan" }, outside)).toMatchObject(refused);
      expect(
        yield* call("patient_file", { patientId: "inbox", title: "Visit" }, outside),
      ).toMatchObject(refused);
    }).pipe(Effect.provide(layerPatientTools)),
  );
});
