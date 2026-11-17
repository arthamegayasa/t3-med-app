/**
 * T3 Med: what the patient pages read over `/api/med`. Fork-owned, and imported as
 * `@t3tools/contracts/med` so upstream's barrel, RPC contract and `EnvironmentHttpApi` are
 * not edited. The routes sign in like upstream's own, through `EnvironmentAuthenticatedAuth`.
 */
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";

import {
  EnvironmentAuthenticatedAuth,
  EnvironmentInternalError,
  EnvironmentScopeRequiredError,
} from "./environmentHttp.ts";

/**
 * A URN as it is compared: upper case, letters and digits only. The store keys patients by it
 * and the directory searches by it, so both must build it the same way.
 */
export const urnKey = (urn: string): string => urn.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

const MedPatientStatus = Schema.Literals(["new", "active", "archived"]);

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
  needsYou: Schema.String,
});
export type MedNote = typeof MedNote.Type;

export const MedWaitingNote = Schema.Struct({
  ...MedNote.fields,
  draftLabs: Schema.Number,
  draftPlans: Schema.Number,
});
export type MedWaitingNote = typeof MedWaitingNote.Type;

export const MedPlan = Schema.Struct({
  id: Schema.String,
  patientId: Schema.NullOr(Schema.String),
  title: Schema.String,
  due: Schema.String,
  type: Schema.Literals(["follow_up", "lab", "imaging", "procedure", "other"]),
  status: Schema.Literals(["draft", "planned", "done", "cancelled"]),
});
export type MedPlan = typeof MedPlan.Type;

export const MedPatientHome = Schema.Struct({
  patient: Schema.Struct({
    ...MedPatientSummary.fields,
    sex: Schema.NullOr(Schema.Literals(["female", "male"])),
    dateOfBirth: Schema.NullOr(Schema.String),
  }),
  notes: Schema.Array(MedNote),
  /** Every thread linked to the patient, whether or not it filed a note for them. */
  threads: Schema.Array(Schema.Struct({ threadId: Schema.String, linkedAt: Schema.String })),
  draftLabs: Schema.Number,
  draftPlans: Schema.Number,
  upcomingPlans: Schema.Array(MedPlan),
});
export type MedPatientHome = typeof MedPatientHome.Type;

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

export class MedPatientNotFoundError extends Schema.TaggedError<MedPatientNotFoundError>()(
  "MedPatientNotFoundError",
  { patientId: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return "This patient is not in T3 Med.";
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

// Reads only. A thread is linked to a patient by the agent tools, on evidence, and by nothing here.
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
    HttpApiEndpoint.get("threadPatient", "/api/med/threads/:threadId/patient", {
      headers: BearerHeaders,
      params: ThreadParams,
      success: MedThreadPatient,
      error: ReadErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

export class MedHttpApi extends HttpApi.make("med").add(MedPatientsHttpApi) {}
