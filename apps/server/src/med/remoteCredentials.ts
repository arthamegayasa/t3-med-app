/**
 * T3 Med: what upstream's sign-in stores do differently for a credential of remote access
 * (docs/t3-med/REMOTE.md), which they tell by its subject. A session from a remote link lasts
 * twelve hours, and a remote link cannot approve an agent's sign-in over MCP. Upstream's
 * `EnvironmentAuth.layer` is handed `layerRemoteCredentials`.
 */
import { MED_REMOTE_SUBJECT } from "@t3tools/contracts/med";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PairingGrantStore from "../auth/PairingGrantStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";

/** Upstream's sessions last 30 days. A browser on a computer that is not the doctor's does not. */
const MED_REMOTE_SESSION_TTL = Duration.hours(12);

const layerSessions = Layer.effect(
  SessionStore.SessionStore,
  Effect.gen(function* () {
    const sessions = yield* SessionStore.SessionStore;
    return SessionStore.SessionStore.of({
      ...sessions,
      // Untraced here and below: upstream's own span covers the call.
      issue: Effect.fnUntraced(function* (input) {
        return yield* sessions.issue(
          input?.subject === MED_REMOTE_SUBJECT
            ? {
                ...input,
                ttl: Duration.min(input.ttl ?? MED_REMOTE_SESSION_TTL, MED_REMOTE_SESSION_TTL),
              }
            : input,
        );
      }),
    });
  }),
);

const layerGrants = Layer.effect(
  PairingGrantStore.PairingGrantStore,
  Effect.gen(function* () {
    const grants = yield* PairingGrantStore.PairingGrantStore;
    return PairingGrantStore.PairingGrantStore.of({
      ...grants,
      // An agent's session lasts 30 days under a subject that Turn off does not look for. The
      // subject is known only once the link is spent, so a link offered there is used up.
      consume: Effect.fnUntraced(function* (credential, input) {
        const grant = yield* grants.consume(credential, input);
        if (input?.mcpApproval !== undefined && grant.subject === MED_REMOTE_SUBJECT) {
          return yield* new PairingGrantStore.UnknownBootstrapCredentialError({});
        }
        return grant;
      }),
    });
  }),
);

/** Stands between upstream's `EnvironmentAuth` and the two stores it signs in with. */
export const layerRemoteCredentials = Layer.merge(layerSessions, layerGrants);
