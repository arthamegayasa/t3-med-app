/**
 * T3 Med: patient data for the web client, read over `/api/med` on the primary environment
 * with the session this browser already holds. One doctor has one patient store, so these
 * queries do not take an environment id.
 */
import { useAtomValue } from "@effect/atom-react";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { MedHttpApi, type MedThreadPatient } from "@t3tools/contracts/med";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { AsyncResult, Atom } from "effect/reactivity";

import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";
import { useNowMinute } from "../hooks/useNowMinute";
import { appAtomRegistry } from "../rpc/atomRegistry";
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

/** Reads every patient query again: after the doctor's own write, and on entering a page. */
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

const threadPatientAtom = Atom.family((threadId: string) =>
  medQuery(`thread-patient:${threadId}`, (client) =>
    client.patients.threadPatient({ headers: {}, params: { threadId } }),
  ),
);

/**
 * The doctor's own link, made when a chat is started from a patient's page. Kept alive: the
 * page that asked for it has given way to the new chat while the request is still out.
 */
export const linkThreadAtom = medRuntime
  .fn((input: { readonly threadId: string; readonly patientId: string }) =>
    medClient.pipe(
      Effect.flatMap((client) =>
        client.patients.linkThread({
          headers: {},
          params: { threadId: input.threadId },
          payload: { patientId: input.patientId },
        }),
      ),
      Effect.tap(() => Effect.sync(refreshMedData)),
    ),
  )
  .pipe(Atom.keepAlive);

/** Today on this machine's calendar, moving on at midnight. */
export function useToday(): string {
  return localIsoDate(new Date(`${useNowMinute()}Z`));
}

// Module-level: a new selector on every render would rebuild the derived atom.
const selectThreadPatient = (
  result: AsyncResult.AsyncResult<MedThreadPatient, unknown>,
): MedThreadPatient["patient"] => AsyncResult.getOrElse(result, () => null)?.patient ?? null;

/** The patient a thread is linked to, or null while unknown or when it has none. */
export function useThreadPatient(threadId: string): MedThreadPatient["patient"] {
  return useAtomValue(threadPatientAtom(threadId), selectThreadPatient);
}
