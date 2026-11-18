/**
 * T3 Med: this computer's calls for remote access (docs/t3-med/REMOTE.md), over `/api/med/remote`
 * in the primary environment. The server answers them only for a session that may manage access.
 */
import {
  createRuntimeCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { MedRemoteHttpApi } from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { Atom } from "effect/reactivity";

import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";
import { appAtomRegistry } from "../rpc/atomRegistry";

const remoteRuntime = Atom.runtime(PrimaryEnvironmentHttpLayer.layer);

const remoteClient = Effect.suspend(() =>
  HttpApiClient.make(MedRemoteHttpApi, { baseUrl: resolvePrimaryEnvironmentHttpUrl("/") }),
);

type RemoteClient = Effect.Success<typeof remoteClient>;
type RemoteFailure = Effect.Error<ReturnType<RemoteClient["remote"][keyof RemoteClient["remote"]]>>;
type RemoteSend<A> = (client: RemoteClient["remote"]) => Effect.Effect<A, RemoteFailure>;

const remoteCommand = createRuntimeCommand(remoteRuntime, {
  label: "med:remote",
  execute: (send: RemoteSend<unknown>) =>
    remoteClient.pipe(Effect.flatMap((client) => send(client.remote))),
});

export type MedRemoteResult<A> =
  | { readonly ok: true; readonly value: A }
  /** `message` is the server's own sentence when it refused, else a general one. */
  | { readonly ok: false; readonly message: string };

export async function callMedRemote<A>(send: RemoteSend<A>): Promise<MedRemoteResult<A>> {
  const result = await runAtomCommand(appAtomRegistry, remoteCommand, send, {
    reportFailure: false,
  });
  if (result._tag === "Success") return { ok: true, value: result.value as A };
  const failure = squashAtomCommandFailure(result);
  return {
    ok: false,
    message:
      failure instanceof Error && failure.message.trim() !== ""
        ? failure.message
        : "T3 Med could not do this.",
  };
}
