/**
 * T3 Med: a new thread asks before it runs a command or changes a file. The server decides the
 * default (`apps/server/src/med/settingsDefaults.ts`); these are the client's two copies of it,
 * the fallback of a draft made without a mode and the value Settings resets to.
 */
import { DEFAULT_SERVER_SETTINGS as UPSTREAM_SETTINGS, type RuntimeMode } from "@t3tools/contracts";

import { T3MED } from "./t3med";

/** The mode a new thread starts in, given upstream's: what `types.ts` exports as its default. */
export const medRuntimeMode = (upstream: RuntimeMode): RuntimeMode =>
  T3MED ? "approval-required" : upstream;

/** Upstream's server defaults with that mode, for `ProjectDefaultsSettings.tsx`. */
export const DEFAULT_SERVER_SETTINGS: typeof UPSTREAM_SETTINGS = {
  ...UPSTREAM_SETTINGS,
  defaultRuntimeMode: medRuntimeMode(UPSTREAM_SETTINGS.defaultRuntimeMode),
};
