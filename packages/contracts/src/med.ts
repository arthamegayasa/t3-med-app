/**
 * T3 Med: what the patient pages read and change over `/api/med`. Fork-owned, and imported as
 * `@t3tools/contracts/med` so upstream's barrel, RPC contract and `EnvironmentHttpApi` are
 * not edited. The routes sign in like upstream's own, through `EnvironmentAuthenticatedAuth`.
 */
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";

import {
  AuthGrantScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
} from "./auth.ts";
import { PortSchema } from "./baseSchemas.ts";
import {
  EnvironmentAuthenticatedAuth,
  EnvironmentInternalError,
  EnvironmentScopeRequiredError,
} from "./environmentHttp.ts";

/** The name agents know T3 Med's own MCP server by. Upstream's, never renamed. */
export const MED_MCP_SERVER_NAME = "t3-code";

/**
 * The tools an agent files and reads patient data with. A thread that asks before it acts runs
 * exactly these without asking; `handlers.test.ts` holds the list to the toolkit's.
 */
export const PATIENT_TOOL_NAMES: ReadonlyArray<string> = [
  "patient_find",
  "patient_create",
  "patient_update",
  "patient_file",
  "patient_record",
  "patient_review",
  "patient_upcoming",
  "patient_verify",
  "patient_move_note",
  "patient_correct_lab",
  "patient_remove",
  "patient_update_plan",
  "patient_return_note",
];

/** Whether a call names one of the patient tools on T3 Med's own server, and nothing else. */
export const isPatientToolCall = (server: unknown, tool: unknown): boolean =>
  server === MED_MCP_SERVER_NAME && typeof tool === "string" && PATIENT_TOOL_NAMES.includes(tool);

/**
 * A URN as it is compared: upper case, letters and digits only. The store keys patients by it
 * and the directory searches by it, so both must build it the same way.
 */
export const urnKey = (urn: string): string => urn.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

const WRITTEN_NUMBER = /^[+-]?\d+(?:[.,]\d+)*$/;
const GROUPED_HEAD = /^[+-]?[1-9]\d{0,2}$/;

const readWrittenNumber = (written: string, thousands: string, decimal: string) => {
  const [whole = "", ...fractions] = written.split(decimal);
  const [head = "", ...groups] = whole.split(thousands);
  const grouped = groups.length > 0;
  if (
    fractions.length > 1 ||
    fractions.some((fraction) => fraction.includes(thousands)) ||
    groups.some((group) => group.length !== 3) ||
    (grouped && !GROUPED_HEAD.test(head))
  ) {
    return [];
  }
  return [Number(`${head}${groups.join("")}${fractions.length === 0 ? "" : `.${fractions[0]}`}`)];
};

/**
 * Every number a result as written can stand for: read the English way (`1,234.5`) and the
 * Indonesian way (`1.234,5`). `9.800` has two readings, `2,6` one, `negative` and `<0,5` none.
 * The store checks a correction with it and the correction form fills its number from it, so
 * both must read a text the same way.
 */
export const writtenNumberReadings = (text: string): ReadonlyArray<number> => {
  const written = text.trim();
  if (!WRITTEN_NUMBER.test(written)) return [];
  return [
    ...new Set([...readWrittenNumber(written, ",", "."), ...readWrittenNumber(written, ".", ",")]),
  ];
};

const MedPatientStatus = Schema.Literals(["new", "active", "archived"]);
const MedPatientSex = Schema.Literals(["female", "male"]);

export const MedPatientSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  urn: Schema.NullOr(Schema.String),
  status: MedPatientStatus,
  alsoWrittenAs: Schema.Array(Schema.String),
  /** Null when the patient has no note and no linked thread yet. */
  lastChatAt: Schema.NullOr(Schema.String),
});
export type MedPatientSummary = typeof MedPatientSummary.Type;

export const MedPatientList = Schema.Struct({ patients: Schema.Array(MedPatientSummary) });
export type MedPatientList = typeof MedPatientList.Type;

export const MedNote = Schema.Struct({
  id: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  title: Schema.String,
  date: Schema.String,
  summary: Schema.String,
  /** What the note asks the doctor; it waits while `needsYouHandledAt` is null. */
  needsYou: Schema.String,
  needsYouHandledAt: Schema.NullOr(Schema.String),
});
export type MedNote = typeof MedNote.Type;

/** A draft as a list names it: enough to know which row verifying a note would confirm. */
export const MedDraftLab = Schema.Struct({
  id: Schema.String,
  testName: Schema.String,
  valueText: Schema.String,
  unit: Schema.String,
  collected: Schema.String,
});
export type MedDraftLab = typeof MedDraftLab.Type;

export const MedDraftPlan = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  due: Schema.String,
});
export type MedDraftPlan = typeof MedDraftPlan.Type;

export const MedWaitingNote = Schema.Struct({
  ...MedNote.fields,
  draftLabs: Schema.Number,
  draftPlans: Schema.Number,
  draftLabRows: Schema.Array(MedDraftLab),
  draftPlanRows: Schema.Array(MedDraftPlan),
});
export type MedWaitingNote = typeof MedWaitingNote.Type;

export const MedPlan = Schema.Struct({
  id: Schema.String,
  patientId: Schema.NullOr(Schema.String),
  title: Schema.String,
  due: Schema.String,
  type: Schema.Literals(["follow_up", "lab", "imaging", "procedure", "other"]),
  status: Schema.Literals(["draft", "planned", "done", "cancelled"]),
  /** The day a done plan was done. */
  doneOn: Schema.NullOr(Schema.String),
  /** When the plan last changed: what an undo sends back as `ifUpdatedAt`. */
  updatedAt: Schema.String,
});
export type MedPlan = typeof MedPlan.Type;

export const MedPatientHome = Schema.Struct({
  patient: Schema.Struct({
    ...MedPatientSummary.fields,
    sex: Schema.NullOr(MedPatientSex),
    dateOfBirth: Schema.NullOr(Schema.String),
  }),
  notes: Schema.Array(MedWaitingNote),
  /** Every thread linked to the patient, whether or not it filed a note for them. */
  threads: Schema.Array(Schema.Struct({ threadId: Schema.String, linkedAt: Schema.String })),
  draftLabs: Schema.Number,
  draftPlans: Schema.Number,
  upcomingPlans: Schema.Array(MedPlan),
});
export type MedPatientHome = typeof MedPatientHome.Type;

const MedLabFlag = Schema.Literals(["low", "normal", "high"]);
const MedLabStatus = Schema.Literals(["draft", "verified"]);

/** What a result said before a correction replaced it. */
export const MedLabRevision = Schema.Struct({
  /** Names the correction: an undo sends it, and is refused once a later one exists. */
  id: Schema.String,
  /** Null for a correction made before this was recorded. */
  correctedBy: Schema.NullOr(Schema.Literals(["doctor", "agent"])),
  testAsWritten: Schema.String,
  value: Schema.NullOr(Schema.Number),
  valueText: Schema.String,
  unit: Schema.String,
  referenceRange: Schema.String,
  flag: Schema.NullOr(MedLabFlag),
  collected: Schema.String,
  status: MedLabStatus,
  replacedAt: Schema.String,
});
export type MedLabRevision = typeof MedLabRevision.Type;

export const MedLab = Schema.Struct({
  id: Schema.String,
  /** The catalogue row: results that share it are results of one test. */
  labTestId: Schema.String,
  testId: Schema.NullOr(Schema.String),
  /** English for a known Test ID, else the name as the catalogue first had it written. */
  testName: Schema.String,
  testAsWritten: Schema.String,
  value: Schema.NullOr(Schema.Number),
  valueText: Schema.String,
  unit: Schema.String,
  referenceRange: Schema.String,
  flag: Schema.NullOr(MedLabFlag),
  collected: Schema.String,
  status: MedLabStatus,
  isBaseline: Schema.Boolean,
  /** The store's comparison with the baseline. The client shows these and computes none. */
  valueInBaselineUnit: Schema.NullOr(Schema.Number),
  changeFromBaseline: Schema.NullOr(Schema.Number),
  changePercent: Schema.NullOr(Schema.Number),
  changeUnit: Schema.NullOr(Schema.String),
  notCompared: Schema.NullOr(
    Schema.Literals([
      "in_inbox",
      "first_result",
      "result_has_no_number",
      "result_has_no_unit",
      "baseline_has_no_unit",
      "no_verified_conversion",
    ]),
  ),
  noteId: Schema.String,
  /** Earlier values, the latest correction first; empty for a result never corrected. */
  revisions: Schema.Array(MedLabRevision),
});
export type MedLab = typeof MedLab.Type;

/** All that is filed for one patient: labs oldest first, plans soonest first, notes latest first. */
export const MedPatientDetails = Schema.Struct({
  ...MedPatientSummary.fields,
  sex: Schema.NullOr(MedPatientSex),
  dateOfBirth: Schema.NullOr(Schema.String),
  diagnoses: Schema.String,
});
export type MedPatientDetails = typeof MedPatientDetails.Type;

export const MedPatientRecord = Schema.Struct({
  patient: MedPatientDetails,
  labs: Schema.Array(MedLab),
  plans: Schema.Array(MedPlan),
  notes: Schema.Array(MedNote),
});
export type MedPatientRecord = typeof MedPatientRecord.Type;

export const MedNeedsYou = Schema.Struct({
  inbox: Schema.Array(MedWaitingNote),
  patients: Schema.Array(
    Schema.Struct({
      patient: MedPatientSummary,
      draftLabs: Schema.Number,
      draftPlans: Schema.Number,
      notes: Schema.Array(MedWaitingNote),
    }),
  ),
});
export type MedNeedsYou = typeof MedNeedsYou.Type;

export const MedUpcomingPlan = Schema.Struct({
  ...MedPlan.fields,
  /** Null for a plan still in the Inbox. */
  patientName: Schema.NullOr(Schema.String),
  patientUrn: Schema.NullOr(Schema.String),
});
export type MedUpcomingPlan = typeof MedUpcomingPlan.Type;

export const MedUpcoming = Schema.Struct({ plans: Schema.Array(MedUpcomingPlan) });
export type MedUpcoming = typeof MedUpcoming.Type;

export const MedCounts = Schema.Struct({
  inbox: Schema.Number,
  patients: Schema.Number,
  needsYou: Schema.Number,
  upcoming: Schema.Number,
});
export type MedCounts = typeof MedCounts.Type;

export const MedThreadPatient = Schema.Struct({
  patient: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type MedThreadPatient = typeof MedThreadPatient.Type;

// One answer for every sidebar row, so the thread list never asks once per thread.
export const MedThreadPatientLink = Schema.Struct({
  threadId: Schema.String,
  patientId: Schema.String,
  name: Schema.String,
  urn: Schema.NullOr(Schema.String),
});
export type MedThreadPatientLink = typeof MedThreadPatientLink.Type;
export const MedThreadPatientLinks = Schema.Struct({ links: Schema.Array(MedThreadPatientLink) });
export type MedThreadPatientLinks = typeof MedThreadPatientLinks.Type;

export class MedPatientNotFoundError extends Schema.TaggedError<MedPatientNotFoundError>()(
  "MedPatientNotFoundError",
  { patientId: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return "This patient is not in T3 Med.";
  }
}

/** What the doctor changes of a patient; a field left out stays as it is. */
export const MedPatientEdit = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  urn: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sex: Schema.optionalKey(Schema.NullOr(MedPatientSex)),
  dateOfBirth: Schema.optionalKey(Schema.NullOr(Schema.String)),
  diagnoses: Schema.optionalKey(Schema.String),
  /** The whole list of other spellings, replacing the one the patient has. */
  alsoWrittenAs: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Spellings taken off and put on the list as it stands: what an undo sends. */
  removeSpellings: Schema.optionalKey(Schema.Array(Schema.String)),
  addSpellings: Schema.optionalKey(Schema.Array(Schema.String)),
  /** True archives; false brings the patient back to the status held before. */
  archived: Schema.optionalKey(Schema.Boolean),
});
export type MedPatientEdit = typeof MedPatientEdit.Type;

/** What a correction changes of one result. `value` and `valueText` are replaced together. */
export const MedLabCorrection = Schema.Struct({
  testAsWritten: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  valueText: Schema.optionalKey(Schema.String),
  unit: Schema.optionalKey(Schema.String),
  referenceRange: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.NullOr(MedLabFlag)),
  collected: Schema.optionalKey(Schema.String),
});
export type MedLabCorrection = typeof MedLabCorrection.Type;

/** `open` reopens a plan that is done or cancelled; `doneOn` is the day a plan was done. */
export const MedPlanChange = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  due: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Literals(["done", "cancelled", "open"])),
  doneOn: Schema.optionalKey(Schema.String),
  ifUpdatedAt: Schema.optionalKey(Schema.String),
});
export type MedPlanChange = typeof MedPlanChange.Type;

/**
 * `ifUpdatedAt` is what an undo sends: the `updatedAt` the change it reverses answered with.
 * The row is left alone, with `MedChangedSinceError`, when it changed after that.
 */
export const MedSetRemoved = Schema.Struct({
  removed: Schema.Boolean,
  ifUpdatedAt: Schema.optionalKey(Schema.String),
});
export const MedRemoved = Schema.Struct({ removed: Schema.Boolean, updatedAt: Schema.String });
export const MedSetVerified = Schema.Struct({
  verified: Schema.Boolean,
  ifUpdatedAt: Schema.optionalKey(Schema.String),
});
export const MedVerified = Schema.Struct({ verified: Schema.Boolean, updatedAt: Schema.String });

/** The correction an undo takes back; refused when a later one exists. */
export const MedUndoCorrection = Schema.Struct({ revisionId: Schema.optionalKey(Schema.String) });

/** The draft rows of a note the doctor was shown: verifying confirms these and no others. */
export const MedNoteRows = Schema.Struct({
  labIds: Schema.Array(Schema.String),
  planIds: Schema.Array(Schema.String),
});
export type MedNoteRows = typeof MedNoteRows.Type;

export const MedNoteVerified = Schema.Struct({
  labsVerified: Schema.Number,
  plansPlanned: Schema.Number,
  patientActivated: Schema.Boolean,
  /** The rows this call verified: what its undo returns to draft. */
  labIds: Schema.Array(Schema.String),
  planIds: Schema.Array(Schema.String),
});
export type MedNoteVerified = typeof MedNoteVerified.Type;

export const MedQuestionHandled = Schema.Struct({ handled: Schema.Boolean });

/** What was removed for a patient, the latest removal first, each with what it said. */
export const MedRemovedList = Schema.Struct({
  labs: Schema.Array(Schema.Struct({ ...MedDraftLab.fields, removedAt: Schema.String })),
  plans: Schema.Array(Schema.Struct({ ...MedDraftPlan.fields, removedAt: Schema.String })),
});
export type MedRemovedList = typeof MedRemovedList.Type;

/** The note as it is in the Inbox: another id than the one moved when it was merged into one. */
export const MedNoteMoved = Schema.Struct({ noteId: Schema.String });

export class MedRowNotFoundError extends Schema.TaggedError<MedRowNotFoundError>()(
  "MedRowNotFoundError",
  { row: Schema.Literals(["lab", "plan", "note"]), id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `This ${this.row === "lab" ? "result" : this.row} is no longer in T3 Med.`;
  }
}

/** A change the store refused; `reason` names the field or the row, never a value. */
export class MedRefusedError extends Schema.TaggedError<MedRefusedError>()(
  "MedRefusedError",
  { reason: Schema.String },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return this.reason;
  }
}

/** An undo that came too late: the row changed after the change it would take back. */
export class MedChangedSinceError extends Schema.TaggedError<MedChangedSinceError>()(
  "MedChangedSinceError",
  { row: Schema.Literals(["lab", "plan"]), id: Schema.String },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `This ${this.row === "lab" ? "result" : "plan"} has changed since, so it was not undone.`;
  }
}

/** The URN belongs to another patient, named here for the doctor and in no log. */
export class MedUrnTakenError extends Schema.TaggedError<MedUrnTakenError>()(
  "MedUrnTakenError",
  { patientId: Schema.String, patientName: Schema.String },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return "Another patient already has this URN.";
  }
}

const BearerHeaders = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
  dpop: Schema.optionalKey(Schema.String),
});
const ReadErrors = [EnvironmentScopeRequiredError, EnvironmentInternalError] as const;
const PatientErrors = [MedPatientNotFoundError, ...ReadErrors] as const;
const PatientParams = Schema.Struct({ patientId: Schema.String });
const ThreadParams = Schema.Struct({ threadId: Schema.String });
const LabParams = Schema.Struct({ labId: Schema.String });
const PlanParams = Schema.Struct({ planId: Schema.String });
const NoteParams = Schema.Struct({ noteId: Schema.String });
const ChangeErrors = [
  MedRowNotFoundError,
  MedRefusedError,
  MedChangedSinceError,
  ...ReadErrors,
] as const;

// A thread is linked to a patient by the agent tools, on evidence, and by nothing here: no
// route writes under `/api/med/threads`, and no write below touches a thread's link.
class MedPatientsHttpApi extends HttpApiGroup.make("patients")
  .add(
    // The whole directory: a search in the URL would put a patient's name in the request trace.
    HttpApiEndpoint.get("list", "/api/med/patients", {
      headers: BearerHeaders,
      success: MedPatientList,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("home", "/api/med/patients/:patientId", {
      headers: BearerHeaders,
      params: PatientParams,
      success: MedPatientHome,
      error: PatientErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("record", "/api/med/patients/:patientId/record", {
      headers: BearerHeaders,
      params: PatientParams,
      success: MedPatientRecord,
      error: PatientErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("removed", "/api/med/patients/:patientId/removed", {
      headers: BearerHeaders,
      params: PatientParams,
      success: MedRemovedList,
      error: PatientErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("needsYou", "/api/med/needs-you", {
      headers: BearerHeaders,
      success: MedNeedsYou,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("upcoming", "/api/med/upcoming", {
      headers: BearerHeaders,
      success: MedUpcoming,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("counts", "/api/med/counts", {
      headers: BearerHeaders,
      success: MedCounts,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("threadPatients", "/api/med/thread-patients", {
      headers: BearerHeaders,
      success: MedThreadPatientLinks,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("threadPatient", "/api/med/threads/:threadId/patient", {
      headers: BearerHeaders,
      params: ThreadParams,
      success: MedThreadPatient,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.patch("updatePatient", "/api/med/patients/:patientId", {
      headers: BearerHeaders,
      params: PatientParams,
      payload: MedPatientEdit,
      success: MedPatientDetails,
      error: [MedPatientNotFoundError, MedUrnTakenError, MedRefusedError, ...ReadErrors],
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.patch("correctLab", "/api/med/labs/:labId", {
      headers: BearerHeaders,
      params: LabParams,
      payload: MedLabCorrection,
      success: MedLab,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("undoLabCorrection", "/api/med/labs/:labId/undo-correction", {
      headers: BearerHeaders,
      params: LabParams,
      payload: MedUndoCorrection,
      success: MedLab,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setLabRemoved", "/api/med/labs/:labId/removed", {
      headers: BearerHeaders,
      params: LabParams,
      payload: MedSetRemoved,
      success: MedRemoved,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setLabVerified", "/api/med/labs/:labId/verified", {
      headers: BearerHeaders,
      params: LabParams,
      payload: MedSetVerified,
      success: MedVerified,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.patch("updatePlan", "/api/med/plans/:planId", {
      headers: BearerHeaders,
      params: PlanParams,
      payload: MedPlanChange,
      success: MedPlan,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setPlanRemoved", "/api/med/plans/:planId/removed", {
      headers: BearerHeaders,
      params: PlanParams,
      payload: MedSetRemoved,
      success: MedRemoved,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setPlanVerified", "/api/med/plans/:planId/verified", {
      headers: BearerHeaders,
      params: PlanParams,
      payload: MedSetVerified,
      success: MedVerified,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("verifyNote", "/api/med/notes/:noteId/verify", {
      headers: BearerHeaders,
      params: NoteParams,
      payload: MedNoteRows,
      success: MedNoteVerified,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("unverifyNote", "/api/med/notes/:noteId/unverify", {
      headers: BearerHeaders,
      params: NoteParams,
      payload: MedNoteRows,
      success: MedNoteRows,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setQuestionHandled", "/api/med/notes/:noteId/question-handled", {
      headers: BearerHeaders,
      params: NoteParams,
      payload: MedQuestionHandled,
      success: MedQuestionHandled,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("moveNoteToInbox", "/api/med/notes/:noteId/inbox", {
      headers: BearerHeaders,
      params: NoteParams,
      success: MedNoteMoved,
      error: ChangeErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

export class MedHttpApi extends HttpApi.make("med").add(MedPatientsHttpApi) {}

/**
 * What a browser paired through T3 Med's remote link (docs/t3-med/REMOTE.md) may do: read and
 * work in chats and patient pages. Left out on purpose: access management, the terminal, the
 * filesystem, settings, providers, maintenance, diagnostics, previews and the relay.
 */
export const MED_REMOTE_CLIENT_SCOPES = [
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
] as const satisfies ReadonlyArray<AuthGrantScope>;

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The public address as its origin (`https://med.example.com`), or undefined when the text is
 * not an HTTPS hostname another computer can resolve. A bare hostname gets the scheme. Loopback
 * names and IP addresses are refused: a link to one would not leave this machine, or would name
 * a LAN address, which T3 Med never listens on.
 */
export function normalizeMedRemoteAddress(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
  // `URL` keeps a bare "#" or "?" out of `hash` and `search`.
  if (/[?#]/.test(trimmed)) return undefined;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || IPV4_LITERAL.test(host)) return undefined;
  if (host === "localhost" || host.endsWith(".localhost")) return undefined;
  return url.origin;
}

/** Upstream's pairing link (`/pair#token=…`) on the public address. */
export function medRemotePairingUrl(address: string, credential: string): string {
  const url = new URL("/pair", address);
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
}

/** What the server and the dialog both say to an address they refuse. */
export const MED_REMOTE_ADDRESS_RULE =
  "The address must be an HTTPS hostname, such as https://med.example.com.";

/**
 * The subject of every one-time link T3 Med's remote access makes, and so of every session paired
 * through one. Turning remote access off revokes by it, and the server shortens those sessions
 * by it (`apps/server/src/med/remoteCredentials.ts`).
 */
export const MED_REMOTE_SUBJECT = "t3med-remote";

/** The desktop app's own settings file in the state directory: `workspace` and `remote`. */
export const MED_DESKTOP_SETTINGS_FILE = "t3med-desktop.json";

export interface MedRemoteSetting {
  /** The public address, or null while remote access is off. */
  readonly address: string | null;
  /** The loopback port the desktop app keeps while the address is set; it outlives turning off. */
  readonly port: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPort = Schema.is(PortSchema);

/** The settings file's text as an object, or undefined when it is not a JSON object. */
export function parseMedDesktopSettings(raw: string): Record<string, unknown> | undefined {
  try {
    // Windows PowerShell 5.1 writes a byte order mark, which JSON.parse refuses.
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The `remote` setting of the settings file's text. An address the server would refuse is none. */
export function parseMedRemoteSetting(raw: string): MedRemoteSetting {
  const remote = parseMedDesktopSettings(raw)?.remote;
  if (!isRecord(remote)) return { address: null, port: null };
  return {
    address:
      typeof remote.address === "string"
        ? (normalizeMedRemoteAddress(remote.address) ?? null)
        : null,
    port: isPort(remote.port) ? remote.port : null,
  };
}

export const MedRemoteAccess = Schema.Struct({
  /** The public HTTPS address the tunnel answers at, or null while remote access is not set up. */
  address: Schema.NullOr(Schema.String),
  /** The loopback port this server listens on: the tunnel's target. */
  port: PortSchema,
  /** The port the desktop app was told to keep. Differs from `port` when that one was taken. */
  keptPort: Schema.NullOr(PortSchema),
});
export type MedRemoteAccess = typeof MedRemoteAccess.Type;

export const MedRemoteAddressChange = Schema.Struct({ address: Schema.NullOr(Schema.String) });

/** A one-time link. `url` carries the credential and is returned once, to the laptop only. */
export const MedRemotePairingLink = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  expiresAt: Schema.DateTimeUtc,
  scopes: Schema.Array(AuthGrantScope),
});
export type MedRemotePairingLink = typeof MedRemotePairingLink.Type;

const RemoteErrors = [MedRefusedError, ...ReadErrors] as const;

// Every route here is the laptop's: each asks for `access:write`, which the remote link never
// grants. Its own HttpApi, so the patient routes can be mounted and tested without it.
class MedRemoteGroup extends HttpApiGroup.make("remote")
  .add(
    HttpApiEndpoint.get("read", "/api/med/remote", {
      headers: BearerHeaders,
      success: MedRemoteAccess,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("setAddress", "/api/med/remote", {
      headers: BearerHeaders,
      payload: MedRemoteAddressChange,
      success: MedRemoteAccess,
      error: RemoteErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("createPairingLink", "/api/med/remote/pairing-link", {
      headers: BearerHeaders,
      success: MedRemotePairingLink,
      error: RemoteErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

export class MedRemoteHttpApi extends HttpApi.make("medRemote").add(MedRemoteGroup) {}
