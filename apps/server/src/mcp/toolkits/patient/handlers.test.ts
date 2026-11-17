import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Tracer from "effect/Tracer";
import { McpSchema, McpServer, Tool } from "effect/ai";

import * as MedDatabase from "../../../med/MedDatabase.ts";
import * as PatientStore from "../../../med/PatientStore.ts";
import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import { PatientToolkit } from "./tools.ts";

type Tools = typeof PatientToolkit.tools;

// The tools as the server registers them, so a call is decoded and refused as an agent's is.
const layerPatientTools = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3med-tools-test-" });
    return McpHttpServer.layerPatientToolkit.pipe(
      Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
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

const from = (threadId: string) =>
  scope({
    threadId: ThreadId.make(threadId),
    providerSessionId: "provider:patients",
    providerInstanceId: ProviderInstanceId.make("codex"),
  });

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "patient-tools-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "patient-tools-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

interface Refusal {
  readonly code?: string;
  readonly message?: string;
}

/** What the agent of a thread reads back from one call: the result, or a refusal's text. */
const callWith = (
  name: string,
  params: Record<string, unknown>,
  caller: McpInvocationContext.McpInvocationScope,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name, arguments: params })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return { isError: result.isError === true, text };
  });

const call = <Name extends keyof Tools & string>(
  name: Name,
  params: Tool.Parameters<Tools[Name]>,
  caller = from("thread-1"),
) =>
  callWith(name, params, caller).pipe(
    Effect.map(({ text }) => JSON.parse(text) as Tool.SuccessEncoded<Tools[Name]> & Refusal),
  );

/** What the protocol answers a call whose arguments do not fit the tool, before any handler runs. */
const invalidParams = (
  name: keyof Tools & string,
  params: Record<string, unknown>,
  caller = from("thread-1"),
) =>
  callWith(name, params, caller).pipe(
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => "accepted" }),
  );

const linkedPatient = (threadId: string) =>
  PatientStore.PatientStore.pipe(
    Effect.flatMap((store) => store.getThreadPatient(threadId)),
    Effect.map(Option.map((patient) => patient.id)),
    Effect.map(Option.getOrNull),
  );

const ldl = { testAsWritten: "LDL", value: 100, unit: "mg/dL", collected: "2026-04-10" };
const notLinkedTo = (patientId: string) =>
  `This thread is not linked to patient ${patientId}; find the patient by URN, create them from a URN, or file to the Inbox.`;

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("patient tools", (it) => {
  it.effect("patient_find links the thread on a URN match only, and says when it relinks", () =>
    Effect.gen(function* () {
      const wayan = yield* call(
        "patient_create",
        { name: "I Wayan Sudarma", urn: "00-12-34-56", sex: "male" },
        from("thread-0"),
      );
      const made = yield* call(
        "patient_create",
        { name: "Ni Made Ayu", urn: "00-77-88-99" },
        from("thread-0"),
      );
      const summary = {
        patientId: wayan.patientId,
        name: "I Wayan Sudarma",
        urn: "00-12-34-56",
        status: "new",
      };

      const unlinked = { match: null, candidates: [], relinkedFrom: null, linked: null };
      expect(yield* call("patient_find", {})).toEqual(unlinked);
      expect(yield* call("patient_find", { name: "wayan" })).toEqual({
        ...unlinked,
        candidates: [summary],
      });
      expect(yield* call("patient_find", { urn: "99-99" })).toEqual(unlinked);
      expect(yield* linkedPatient("thread-1")).toBeNull();

      const matched = { match: summary, candidates: [], relinkedFrom: null, linked: summary };
      expect(yield* call("patient_find", { urn: "00123456" })).toEqual(matched);
      expect(yield* linkedPatient("thread-1")).toBe(wayan.patientId);
      expect(yield* call("patient_find", { urn: "00 12 34 56" })).toEqual(matched);
      // A name never links, and the reply still says whom the thread is linked to.
      expect(yield* call("patient_find", { name: "made" })).toEqual({
        match: null,
        candidates: [
          { ...summary, patientId: made.patientId, name: "Ni Made Ayu", urn: "00-77-88-99" },
        ],
        relinkedFrom: null,
        linked: summary,
      });
      expect(yield* call("patient_find", { urn: "99-99" })).toEqual({
        ...unlinked,
        linked: summary,
      });

      expect(yield* call("patient_find", { urn: "00-77-88-99" })).toMatchObject({
        match: { patientId: made.patientId },
        relinkedFrom: { patientId: wayan.patientId, name: "I Wayan Sudarma" },
        linked: { patientId: made.patientId },
      });
      expect(yield* linkedPatient("thread-1")).toBe(made.patientId);
      // No arguments: only whom this thread is linked to, and another thread's link is its own.
      const linkedToMade = {
        ...unlinked,
        linked: { ...summary, patientId: made.patientId, name: "Ni Made Ayu", urn: "00-77-88-99" },
      };
      expect(yield* call("patient_find", {})).toEqual(linkedToMade);
      expect(yield* call("patient_find", { urn: " ", name: "" })).toEqual(linkedToMade);
      expect(yield* call("patient_find", {}, from("thread-7"))).toEqual(unlinked);
      expect(yield* linkedPatient("thread-1")).toBe(made.patientId);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_create needs a new URN and links the thread to the patient it creates", () =>
    Effect.gen(function* () {
      const wayan = yield* call("patient_create", { name: "Wayan Sudarma", urn: "00-12-34-56" });
      expect(wayan).toMatchObject({
        name: "Wayan Sudarma",
        urn: "00-12-34-56",
        status: "new",
        alsoWrittenAs: [],
        relinkedFrom: null,
      });
      expect(yield* linkedPatient("thread-1")).toBe(wayan.patientId);

      expect(yield* invalidParams("patient_create", { name: "Made" })).toContain("urn");
      expect(yield* linkedPatient("thread-1")).toBe(wayan.patientId);
      expect(yield* call("patient_create", { name: "Made", urn: " - " })).toMatchObject({
        code: "invalid_request",
        message: "urn must not be blank.",
      });

      const made = yield* call("patient_create", { name: "Made", urn: "00-77-88-99" });
      expect(made.relinkedFrom).toEqual({ patientId: wayan.patientId, name: "Wayan Sudarma" });
      expect(yield* linkedPatient("thread-1")).toBe(made.patientId);

      const taken = {
        code: "invalid_request",
        message: `URN 00-12-34-56 belongs to patient ${wayan.patientId} (Wayan Sudarma, new). Nothing was changed; find that patient by this URN to file for them.`,
      };
      expect(yield* call("patient_create", { name: "Someone", urn: "00 12 34 56" })).toMatchObject(
        taken,
      );
      expect(
        yield* call("patient_update", { patientId: made.patientId, urn: "00123456" }),
      ).toMatchObject(taken);
      expect(yield* linkedPatient("thread-1")).toBe(made.patientId);
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

  it.effect("patient_file files to a patient only from a thread linked to that patient", () =>
    Effect.gen(function* () {
      const wayan = yield* call(
        "patient_create",
        { name: "Wayan Sudarma", urn: "00-12-34-56" },
        from("thread-0"),
      );
      const made = yield* call(
        "patient_create",
        { name: "Made Sudarma", urn: "00-77-88-99" },
        from("thread-0"),
      );
      const file = (patientId: string) =>
        call("patient_file", { patientId, title: "Visit", labs: [ldl] });

      // A name search only offers candidates; filing to one of their ids is refused.
      const { candidates } = yield* call("patient_find", { name: "sudarma" });
      expect(candidates).toHaveLength(2);
      expect(yield* file(wayan.patientId)).toMatchObject({
        code: "invalid_request",
        message: notLinkedTo(wayan.patientId),
      });
      expect(yield* linkedPatient("thread-1")).toBeNull();

      // Linked to Wayan by URN, the thread files to Wayan, and filing to Made is refused.
      yield* call("patient_find", { urn: "00-12-34-56" });
      expect(yield* file(wayan.patientId)).toMatchObject({ patientId: wayan.patientId });
      expect(yield* file(made.patientId)).toMatchObject({
        code: "invalid_request",
        message: notLinkedTo(made.patientId),
      });
      expect(yield* linkedPatient("thread-1")).toBe(wayan.patientId);
      expect(yield* call("patient_record", { patientId: made.patientId })).toMatchObject({
        labs: [],
        notes: [],
      });

      // The Inbox takes a filing from any thread, and leaves the link as it is.
      expect(yield* file("inbox")).toMatchObject({ patientId: null });
      expect(yield* linkedPatient("thread-1")).toBe(wayan.patientId);
      expect(
        yield* call(
          "patient_file",
          { patientId: "inbox", title: "Unknown patient" },
          from("thread-9"),
        ),
      ).toMatchObject({ patientId: null });
      expect(yield* linkedPatient("thread-9")).toBeNull();
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_file files drafts and says what each lab was compared with", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
      const sheet = { name: "lipid-panel.pdf", path: "patient-files/lipid-panel.pdf" };
      const message = {
        patientId,
        title: "Lipid follow-up",
        summary: "LDL down on statin.",
        needsYou: "Is the second LDL fasting?",
        date: "2026-11-11",
        labs: [
          { testAsWritten: "LDL", value: 190, unit: "mg/dL", collected: "2026-01-10" },
          {
            testAsWritten: "LDL",
            value: 2.6,
            valueText: "2,6",
            unit: "mmol/L",
            referenceRange: "< 2,6",
            flag: "normal" as const,
            collected: "2026-04-10",
            lab: "Prodia",
          },
          { testAsWritten: "Anti-dsDNA", valueText: "negative", collected: "2026-04-10" },
        ],
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab" as const }],
        files: [sheet],
      };

      const filed = yield* call("patient_file", message);

      expect(filed).toMatchObject({
        patientId,
        labs: [
          {
            testName: "LDL",
            value: 190,
            status: "draft",
            isBaseline: true,
            changePercent: null,
            baseline: null,
            changeUnit: null,
            notCompared: "first_result",
          },
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
            baseline: { value: 190, unit: "mg/dL", collected: "2026-01-10" },
            changeUnit: "mg/dL",
            notCompared: null,
          },
          {
            value: null,
            valueText: "negative",
            baseline: null,
            notCompared: "result_has_no_number",
          },
        ],
        plans: [{ title: "Repeat lipid panel", due: "2026-12-01", type: "lab", status: "draft" }],
      });
      // Published pair: 2.6 mmol/L is 100 mg/dL; 100 - 190 = -90; -90 / 190 = -47.4 %.
      const later = filed.labs[1];
      expect(Math.abs((later?.valueInBaselineUnit ?? 0) - 100)).toBeLessThan(1);
      expect(Math.abs((later?.changeFromBaseline ?? 0) + 90)).toBeLessThan(1);
      expect(Math.abs((later?.changePercent ?? 0) + 47.4)).toBeLessThan(0.6);

      // The same call again, as after a timeout, files nothing twice.
      const retry = yield* call("patient_file", message);
      expect(retry).toEqual(filed);
      // A later message needs no title; its question is added, until the doctor's answer clears it.
      yield* call("patient_file", { patientId, needsYou: "Confirm the LDL unit." });
      const record = yield* call("patient_record", { patientId });
      expect(record).toMatchObject({
        patient: { patientId, name: "Wayan", status: "new" },
        labs: [{ collected: "2026-01-10" }, { collected: "2026-04-10" }, { value: null }],
        plans: [{ title: "Repeat lipid panel", noteId: filed.noteId }],
        notes: [
          {
            noteId: filed.noteId,
            threadId: "thread-1",
            kind: "chat",
            title: "Lipid follow-up",
            summary: "LDL down on statin.",
            needsYou: "Is the second LDL fasting?\nConfirm the LDL unit.",
            date: "2026-11-11",
            files: [sheet],
          },
        ],
      });
      expect(record.labs).toHaveLength(3);
      expect(record.plans).toHaveLength(1);
      expect((yield* call("patient_record", { patientId, test: "LDL-C" })).labs).toHaveLength(2);
      expect((yield* call("patient_record", { patientId, test: "HbA1c" })).labs).toEqual([]);

      yield* call("patient_file", { patientId, clearNeedsYou: true });
      expect((yield* call("patient_record", { patientId })).notes[0]?.needsYou).toBe("");
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_move_note moves only the calling thread's Inbox note, and links it", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call(
        "patient_create",
        { name: "Wayan Sudarma", urn: "00-12-34-56" },
        from("thread-0"),
      );
      yield* call("patient_file", { patientId, title: "Visit", labs: [ldl] }, from("thread-0"));
      const other = yield* call(
        "patient_file",
        { patientId: "inbox", title: "Another thread's sheet", labs: [ldl] },
        from("thread-2"),
      );

      // Another thread's Inbox note cannot be named, and this thread has none of its own yet.
      expect(
        yield* invalidParams("patient_move_note", { patientId, noteId: other.noteId }),
      ).toContain("noteId");
      expect(yield* call("patient_move_note", { patientId })).toMatchObject({
        code: "invalid_request",
        message: "This thread has no note in the Inbox.",
      });
      expect((yield* call("patient_review", {})).inbox).toMatchObject([{ noteId: other.noteId }]);
      expect(yield* linkedPatient("thread-2")).toBeNull();
      expect(yield* linkedPatient("thread-1")).toBeNull();

      const inbox = yield* call("patient_file", {
        patientId: "inbox",
        title: "Lipid sheet, patient unclear",
        kind: "lab_sheet",
        needsYou: `Named only as Wayan. Candidate: Wayan Sudarma (${patientId}).`,
        labs: [{ ...ldl, value: 200, collected: "2026-01-10" }],
      });
      expect(inbox).toMatchObject({
        patientId: null,
        labs: [{ isBaseline: false, changeFromBaseline: null, notCompared: "in_inbox" }],
      });
      expect(yield* call("patient_review", {})).toMatchObject({
        inbox: [
          {
            noteId: inbox.noteId,
            kind: "lab_sheet",
            needsYou: `Named only as Wayan. Candidate: Wayan Sudarma (${patientId}).`,
            draftLabs: 1,
            draftPlans: 0,
          },
          { noteId: other.noteId },
        ],
        patients: [{ patientId, name: "Wayan Sudarma", draftLabs: 1, draftPlans: 0 }],
      });
      expect(yield* call("patient_verify", {})).toMatchObject({
        code: "invalid_request",
        message:
          "This thread is not linked to a patient; find the patient by URN, or move this thread's Inbox note to a patient, before verifying.",
      });

      expect(yield* call("patient_move_note", { patientId })).toMatchObject({
        noteId: inbox.noteId,
        patientId,
        labs: [{ collected: "2026-01-10", isBaseline: true }],
        relinkedFrom: null,
      });
      expect((yield* call("patient_record", { patientId, test: "ldl" })).labs).toMatchObject([
        { collected: "2026-01-10", value: 200, isBaseline: true, changeFromBaseline: null },
        // Worked by hand: 100 - 200 = -100; -100 / 200 = -50 %.
        { collected: "2026-04-10", value: 100, changeFromBaseline: -100, changePercent: -50 },
      ]);
      expect(yield* linkedPatient("thread-1")).toBe(patientId);
      expect((yield* call("patient_review", {})).inbox).toMatchObject([{ noteId: other.noteId }]);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_verify verifies only the calling thread's note for its linked patient", () =>
    Effect.gen(function* () {
      const wayan = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
      const made = yield* call(
        "patient_create",
        { name: "Made", urn: "00-77-88-99" },
        from("thread-2"),
      );
      const filed = yield* call("patient_file", {
        patientId: wayan.patientId,
        title: "Visit",
        labs: [ldl],
        plans: [{ title: "Clinic visit", due: "2026-11-25", type: "follow_up" }],
      });
      const other = yield* call(
        "patient_file",
        { patientId: made.patientId, title: "Another chat", labs: [ldl] },
        from("thread-2"),
      );
      const madeIsDraft = { patient: { status: "new" }, labs: [{ status: "draft" }] };

      // Another thread's note for another patient cannot be named, by its id or by its patient.
      expect(yield* invalidParams("patient_verify", { noteId: other.noteId })).toContain("noteId");
      expect(yield* invalidParams("patient_verify", { patientId: made.patientId })).toContain(
        "patientId",
      );
      expect(yield* call("patient_record", { patientId: made.patientId })).toMatchObject(
        madeIsDraft,
      );
      expect(yield* call("patient_record", { patientId: wayan.patientId })).toMatchObject({
        patient: { status: "new" },
        labs: [{ status: "draft" }],
      });

      expect(yield* call("patient_verify", {}, from("thread-9"))).toMatchObject({
        code: "invalid_request",
        message:
          "This thread is not linked to a patient; find the patient by URN, or move this thread's Inbox note to a patient, before verifying.",
      });
      expect(yield* call("patient_verify", {})).toEqual({
        labsVerified: 1,
        plansPlanned: 1,
        patientActivated: true,
      });
      expect(yield* call("patient_record", { patientId: wayan.patientId })).toMatchObject({
        patient: { status: "active" },
        labs: [{ testName: "LDL", status: "verified", noteId: filed.noteId }],
        plans: [{ status: "planned" }],
      });
      expect(yield* call("patient_record", { patientId: made.patientId })).toMatchObject(
        madeIsDraft,
      );

      // Linked to Made by URN, this thread has filed nothing for Made, so it verifies nothing.
      yield* call("patient_find", { urn: "00-77-88-99" });
      expect(yield* call("patient_verify", {})).toMatchObject({
        code: "invalid_request",
        message: `This thread has filed no note for patient ${made.patientId}.`,
      });
      expect(yield* call("patient_record", { patientId: made.patientId })).toMatchObject(
        madeIsDraft,
      );
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("patient_upcoming lists plans soonest first, without archived patients", () =>
    Effect.gen(function* () {
      const store = yield* PatientStore.PatientStore;
      const wayan = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
      const made = yield* call(
        "patient_create",
        { name: "Made", urn: "00-77-88-99" },
        from("thread-2"),
      );
      yield* call("patient_file", {
        patientId: wayan.patientId,
        title: "Visit",
        plans: [
          { title: "Repeat lipid panel", due: "2026-12-01", type: "lab" },
          { title: "MRI brain", due: "2026-11-20", type: "imaging" },
        ],
      });
      yield* call("patient_verify", {});
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
      expect(
        yield* call("patient_upcoming", { from: "2026-12-01", to: "2026-11-01" }),
      ).toMatchObject({ code: "invalid_request", message: "from must not be later than to." });

      yield* store.updatePatient(wayan.patientId, { status: "archived" });
      expect((yield* call("patient_upcoming", {})).plans).toMatchObject([eeg, visit]);
      expect((yield* call("patient_review", {})).patients).toMatchObject([{ name: "Made" }]);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("a refused filing is a readable tool error, and nothing of it is filed", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
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
      expect(yield* call("patient_file", { patientId, labs: [ldl] })).toMatchObject({
        code: "invalid_request",
        message: "title must not be blank.",
      });
      expect(
        yield* call("patient_file", { ...filing, patientId: "missing", labs: [ldl] }),
      ).toMatchObject({ code: "invalid_request", message: notLinkedTo("missing") });
      expect(yield* call("patient_record", { patientId })).toMatchObject({
        labs: [],
        plans: [],
        notes: [],
      });
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("every tool refuses a field it does not take, and none serves an outside client", () =>
    Effect.gen(function* () {
      const { patientId } = yield* call("patient_create", { name: "Wayan", urn: "00-12-34-56" });
      const unknownField: ReadonlyArray<readonly [keyof Tools & string, Record<string, unknown>]> =
        [
          ["patient_find", { name: "wayan", nama: "wayan" }],
          ["patient_record", { patientId, tests: "LDL" }],
          ["patient_review", { patientId }],
          ["patient_upcoming", { since: "2026-11-01" }],
          ["patient_file", { patientId, title: "Visit", lab: [ldl] }],
        ];
      for (const [name, params] of unknownField) {
        const extra = Object.keys(params).at(-1) ?? "";
        expect(yield* invalidParams(name, params), name).toContain(extra);
      }
      expect(yield* call("patient_record", { patientId })).toMatchObject({ notes: [] });

      // An outside client is not offered the tools at all: to it they do not exist.
      const outside = scope(undefined);
      const hidden: ReadonlyArray<readonly [keyof Tools & string, Record<string, unknown>]> = [
        ["patient_find", { name: "wayan" }],
        ["patient_review", {}],
        ["patient_create", { name: "Made", urn: "00-77-88-99" }],
        ["patient_file", { patientId: "inbox", title: "Visit" }],
      ];
      for (const [name, params] of hidden) {
        expect(yield* invalidParams(name, params, outside), name).toBe(`Tool '${name}' not found`);
      }
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it.effect("keeps a call's arguments and a refusal's patient out of every span", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const secret = "Ni Luh Sekarwangi";

      // The request span stands in for the HTTP server's, which is the current span of a real call.
      const result = yield* Effect.gen(function* () {
        const created = yield* call("patient_create", { name: secret, urn: "00-55-66-77" });
        yield* call("patient_file", {
          patientId: created.patientId,
          title: `Visit of ${secret}`,
          summary: `${secret} reports headaches.`,
          labs: [{ ...ldl, valueText: `100 (${secret})` }],
        });
        // Arguments the protocol refuses never reach a handler, and are still not recorded.
        yield* invalidParams("patient_find", { name: secret, nama: secret });
        yield* invalidParams("patient_file", {
          patientId: created.patientId,
          labs: [{ ...ldl, value: `high, says ${secret}` }],
        });
        return yield* call("patient_create", { name: secret, urn: "00556677" }, from("thread-2"));
      }).pipe(Effect.withSpan("http.server POST /mcp"), Effect.withTracer(tracer));

      expect(result.message).toContain(secret);
      const recorded = spans.map((span) => ({
        name: span.name,
        attributes: Object.fromEntries(span.attributes),
        events: span.events,
        exit:
          span.status._tag === "Ended" && Exit.isFailure(span.status.exit)
            ? Cause.pretty(span.status.exit.cause)
            : "",
      }));
      const names = recorded.map((span) => span.name);
      expect(names).toContain("mcp.tool.patient_file");
      expect(names).toContain("PatientStore.fileFromThread");
      expect(JSON.stringify(recorded)).not.toContain("Sekarwangi");
      expect(JSON.stringify(recorded)).not.toContain("00-55-66-77");
      expect(recorded.filter((span) => "parameters" in span.attributes)).toEqual([]);
      // Hidden from annotation, the request span is still the parent the store's spans hang from.
      const request = spans.find((span) => span.name === "http.server POST /mcp");
      const filing = spans.find((span) => span.name === "PatientStore.fileFromThread");
      expect(filing?.traceId).toBe(request?.traceId);
      expect(Option.getOrUndefined(filing?.parent ?? Option.none())?.spanId).toBe(request?.spanId);
    }).pipe(Effect.provide(layerPatientTools)),
  );

  it("tells an agent when to call each tool, and how a date is written", () => {
    const dates = new Map<string, ReadonlyArray<string>>();
    const collect = (tool: string, schema: unknown): void => {
      if (typeof schema !== "object" || schema === null) return;
      if ("properties" in schema && typeof schema.properties === "object") {
        for (const [name, property] of Object.entries(schema.properties ?? {})) {
          const description: unknown =
            typeof property === "object" && property !== null && "description" in property
              ? property.description
              : undefined;
          if (typeof description === "string" && description.includes("YYYY-MM-DD")) {
            dates.set(tool, [...(dates.get(tool) ?? []), name]);
          }
        }
      }
      for (const value of Object.values(schema)) collect(tool, value);
    };

    for (const tool of Object.values(PatientToolkit.tools)) {
      const description = Tool.getDescription(tool) ?? "";
      expect(description, tool.name).toMatch(/^Call this /);
      // One or two plain sentences: at most two full stops that end one.
      expect(description.match(/\.(\s|$)/g)?.length ?? 0, tool.name).toBeLessThanOrEqual(2);
      collect(tool.name, advertisedJsonSchema(tool));
    }
    expect(Object.fromEntries(dates)).toEqual({
      patient_create: ["dateOfBirth"],
      patient_update: ["dateOfBirth"],
      patient_file: ["date", "collected", "due"],
      patient_upcoming: ["from", "to"],
    });
  });
});
