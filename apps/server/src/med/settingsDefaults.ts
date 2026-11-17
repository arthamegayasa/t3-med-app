/**
 * T3 Med: the server settings that start differently in a patient workspace. A settings file
 * that does not say gets these; what the doctor chooses is written to the file and wins.
 * Upstream's own defaults are untouched (`DEFAULT_SERVER_SETTINGS`).
 */
import { DEFAULT_SERVER_SETTINGS, type RuntimeMode, type ServerSettings } from "@t3tools/contracts";

import type { ManagedSettings } from "../policy/managedSettings.ts";

/** A new thread asks before it runs a command or changes a file. Upstream: Full access. */
export const MED_DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";

const MED_DEFAULTS = {
  defaultRuntimeMode: MED_DEFAULT_RUNTIME_MODE,
  // No agent opens a browser over a patient chat: its off switch is on a hidden Settings page.
  enableAgentBrowserAccess: false,
} as const satisfies Partial<ServerSettings>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Upstream's settings policy with T3 Med's defaults laid under it. A default a managed policy
 * set itself is kept. The settings file omits values equal to `defaults`, so a T3 Med default
 * is never written and upstream's value, when the doctor chooses it, always is.
 */
function medSettings(managed: ManagedSettings): ManagedSettings {
  const mine = Object.fromEntries(
    Object.entries(MED_DEFAULTS).filter(
      ([key]) =>
        managed.defaults[key as keyof ServerSettings] ===
        DEFAULT_SERVER_SETTINGS[key as keyof ServerSettings],
    ),
  );
  if (Object.keys(mine).length === 0) return managed;
  return {
    ...managed,
    defaults: { ...managed.defaults, ...mine },
    withDefaults: (persisted) => {
      const filled = managed.withDefaults(persisted);
      return isRecord(filled) ? { ...mine, ...filled } : filled;
    },
  };
}

/** What `ManagedPolicy.ts` returns from its live layer: the policy it read, with those defaults. */
export const medPolicy = <Policy extends { readonly settings: ManagedSettings }>(
  policy: Policy,
): Policy => ({ ...policy, settings: medSettings(policy.settings) });
