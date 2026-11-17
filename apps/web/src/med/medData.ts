/**
 * T3 Med: patient data for the web client. It belongs to the primary environment and is read
 * over `/api/med` there, with the session this browser already holds, so these queries take no
 * environment id. The client only reads: a thread is linked to a patient by the agent tools.
 */
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { MedHttpApi, type MedThreadPatient } from "@t3tools/contracts/med";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { AsyncResult, Atom } from "effect/reactivity";

import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";
import { useNowMinute } from "../hooks/useNowMinute";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "../state/environments";
import {
  type EnvironmentQueryView,
  useEnvironmentQuery,
  useEnvironmentQuerySelector,
} from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { environmentThreadShells } from "../state/threads";
import { localIsoDate } from "./medLogic";

const medRuntime = Atom.runtime(PrimaryEnvironmentHttpLayer.layer);

const medClient = Effect.suspend(() =>
  HttpApiClient.make(MedHttpApi, { baseUrl: resolvePrimaryEnvironmentHttpUrl("/") }),
);

type MedClient = Effect.Success<typeof medClient>;

const revisionAtom = Atom.make(0).pipe(Atom.withLabel("med:revision"));

// Agents file while a thread works, so the set of working threads changing is the cue that
// patient data may have changed. The server pushes nothing for it.
const workingThreadsAtom = Atom.make((get) =>
  get(environmentThreadShells.threadShellsAtom)
    .filter(isThreadWorking)
    .map((thread) => thread.id)
    .join(),
).pipe(Atom.withLabel("med:working-threads"));

/** Reads every patient query again, on entering a patient page. */
export function refreshMedData(): void {
  appAtomRegistry.set(revisionAtom, appAtomRegistry.get(revisionAtom) + 1);
}

// A query stays loaded for a while after its page closes, so going back shows it at once.
const medQuery = <A, E>(label: string, read: (client: MedClient) => Effect.Effect<A, E>) =>
  medRuntime
    .atom((get) => {
      get(revisionAtom);
      get(workingThreadsAtom);
      return medClient.pipe(Effect.flatMap(read));
    })
    .pipe(
      Atom.refreshOnWindowFocus,
      Atom.setIdleTTL(Duration.minutes(5)),
      Atom.withLabel(`med:${label}`),
    );

export const patientsAtom = medQuery("patients", (client) => client.patients.list({ headers: {} }));

export const needsYouAtom = medQuery("needs-you", (client) =>
  client.patients.needsYou({ headers: {} }),
);

export const upcomingAtom = medQuery("upcoming", (client) =>
  client.patients.upcoming({ headers: {} }),
);

export const countsAtom = medQuery("counts", (client) => client.patients.counts({ headers: {} }));

export const patientHomeAtom = Atom.family((patientId: string) =>
  medQuery(`patient:${patientId}`, (client) =>
    client.patients.home({ headers: {}, params: { patientId } }),
  ),
);

/** All that is filed for one patient: what the right panel's patient surfaces draw. */
export const patientRecordAtom = Atom.family((patientId: string) =>
  medQuery(`patient-record:${patientId}`, (client) =>
    client.patients.record({ headers: {}, params: { patientId } }),
  ),
);

// The test the Labs surface shows for a patient, kept while its tab is closed or behind another.
export const selectedLabTestAtom = Atom.family((patientId: string) =>
  Atom.make<string | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`med:selected-lab-test:${patientId}`),
  ),
);

const threadPatientAtom = Atom.family((threadId: string) =>
  medQuery(`thread-patient:${threadId}`, (client) =>
    client.patients.threadPatient({ headers: {}, params: { threadId } }),
  ),
);

/**
 * The environment patient data belongs to: the primary one, once this session may read there.
 * Null until then, and nothing is asked of any server while it is null.
 */
export function useMedEnvironmentId(): EnvironmentId | null {
  const environmentId = usePrimaryEnvironmentId();
  return useEnvironmentScope(environmentId, AuthOrchestrationReadScope) ? environmentId : null;
}

/** One patient query, read only while `useMedEnvironmentId` names an environment. */
export function useMedQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): EnvironmentQueryView<A, E> {
  return useEnvironmentQuery(useMedEnvironmentId() === null ? null : atom);
}

/** Today on this machine's calendar, moving on at midnight. */
export function useToday(): string {
  return localIsoDate(new Date(`${useNowMinute()}Z`));
}

// Module-level: a new selector on every render would rebuild the derived atom.
const selectThreadPatient = (
  result: AsyncResult.AsyncResult<MedThreadPatient, unknown>,
): MedThreadPatient["patient"] => AsyncResult.getOrElse(result, () => null)?.patient ?? null;

/**
 * The patient a thread is linked to, or null while unknown or when it has none. A thread of
 * another environment has none, and neither has a draft: nothing is asked about either.
 */
export function useThreadPatient(
  environmentId: EnvironmentId | null,
  threadId: string | null,
): MedThreadPatient["patient"] {
  const medEnvironmentId = useMedEnvironmentId();
  return useEnvironmentQuerySelector(
    threadId !== null && medEnvironmentId !== null && medEnvironmentId === environmentId
      ? threadPatientAtom(threadId)
      : null,
    selectThreadPatient,
  );
}

export type ThreadPatientState =
  /** Not known yet: the session, or the read itself, is still on its way. */
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: string; readonly retry: () => void }
  /** Known to have none: an unlinked chat, a draft, or a chat of another environment. */
  | { readonly kind: "none" }
  | { readonly kind: "linked"; readonly patient: NonNullable<MedThreadPatient["patient"]> };

/**
 * Whether a thread has a patient, told apart from not knowing yet and from failing to read:
 * a chat must never be said to have no patient because the answer is late or lost.
 */
export function useThreadPatientState(
  environmentId: EnvironmentId | null,
  threadId: string | null,
): ThreadPatientState {
  const medEnvironmentId = useMedEnvironmentId();
  const asked =
    threadId !== null && medEnvironmentId !== null && medEnvironmentId === environmentId;
  const query = useEnvironmentQuery(asked ? threadPatientAtom(threadId) : null);
  if (medEnvironmentId === null) return { kind: "loading" };
  if (!asked) return { kind: "none" };
  if (query.data === null) {
    return query.error === null
      ? { kind: "loading" }
      : { kind: "failed", error: query.error, retry: query.refresh };
  }
  return query.data.patient === null
    ? { kind: "none" }
    : { kind: "linked", patient: query.data.patient };
}
