/**
 * T3 Med: the routes of remote access (docs/t3-med/REMOTE.md). Every one asks for `access:write`,
 * which the remote link never grants, so access is managed from this computer only.
 */
import { AuthAccessWriteScope } from "@t3tools/contracts";
import { MED_REMOTE_CLIENT_SCOPES, MedRemoteHttpApi } from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { layerAuth } from "./httpAuth.ts";
import * as MedRemoteAccess from "./MedRemoteAccess.ts";

// The service logged the step; the cause can carry the file's path.
const failSettingsFile = {
  MedRemoteSettingsFileError: () => failEnvironmentInternal("internal_error"),
};

const layerHandlers = HttpApiBuilder.group(
  MedRemoteHttpApi,
  "remote",
  Effect.fnUntraced(function* (handlers) {
    const remoteAccess = yield* MedRemoteAccess.MedRemoteAccess;

    return handlers
      .handle(
        "read",
        Effect.fn("med.remote.read")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* remoteAccess.read.pipe(Effect.catchTags(failSettingsFile));
        }),
      )
      .handle(
        "setAddress",
        Effect.fn("med.remote.setAddress")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* remoteAccess.setAddress(args.payload.address).pipe(
            Effect.catchTags(failSettingsFile),
            Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
              failEnvironmentInternal("internal_error", error),
            ),
          );
        }),
      )
      .handle(
        "createPairingLink",
        Effect.fn("med.remote.createPairingLink")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          // Upstream's rule for any link: a session hands on only what it holds itself.
          for (const scope of MED_REMOTE_CLIENT_SCOPES) {
            if (!session.scopes.has(scope)) return yield* failEnvironmentScopeRequired(scope);
          }
          return yield* remoteAccess.createPairingLink.pipe(
            Effect.catchTags(failSettingsFile),
            Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
              failEnvironmentInternal("pairing_credential_issuance_failed", error),
            ),
          );
        }),
      );
  }),
);

/** The remote access routes, signed in like the patient routes. */
export const layer = HttpApiBuilder.layer(MedRemoteHttpApi).pipe(
  Layer.provide(layerHandlers),
  Layer.provide(layerAuth),
  Layer.provide(MedRemoteAccess.layer),
);
