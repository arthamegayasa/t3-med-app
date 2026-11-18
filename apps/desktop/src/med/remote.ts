/**
 * T3 Med: while remote access is set (docs/t3-med/REMOTE.md) the backend keeps the loopback port
 * a tunnel points at, the `remote.port` the server saved in `t3med-desktop.json`. Without that
 * setting the port is found as upstream finds it. Nothing here listens beyond loopback.
 */
// @effect-diagnostics nodeBuiltinImport:off - Read once per start, where upstream's seam provides no FileSystem.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { MED_DESKTOP_SETTINGS_FILE, parseMedRemoteSetting } from "@t3tools/contracts/med";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

// The hosts upstream's own scan asks about before it takes a port.
const PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::"] as const;

/** The port saved with a usable public address in the settings file's text, or undefined. */
export function medKeptPort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const remote = parseMedRemoteSetting(raw);
  return remote.address === null ? undefined : (remote.port ?? undefined);
}

/** `T3CODE_PORT` first, then the kept port if it is free; none means upstream's scan. */
export function pickMedBackendPort(input: {
  readonly configured: Option.Option<number>;
  readonly kept: number | undefined;
  readonly keptIsFree: boolean;
}): Option.Option<number> {
  if (Option.isSome(input.configured)) return input.configured;
  return input.kept !== undefined && input.keptIsFree ? Option.some(input.kept) : Option.none();
}

const readSettingsFile = (settingsPath: string): string | undefined => {
  try {
    return NodeFS.readFileSync(settingsPath, "utf8");
  } catch {
    return undefined;
  }
};

/** The port to hand upstream's `resolveDesktopBackendPort` in place of the configured one. */
export const medBackendPort = Effect.fn("med.desktop.backendPort")(function* (
  configured: Option.Option<number>,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const net = yield* NetService.NetService;
  const kept = Option.isSome(configured)
    ? undefined
    : medKeptPort(readSettingsFile(NodePath.join(environment.stateDir, MED_DESKTOP_SETTINGS_FILE)));
  let keptIsFree = kept !== undefined;
  if (kept !== undefined) {
    for (const host of PROBE_HOSTS) {
      if (!(yield* net.canListenOnHost(kept, host))) {
        keptIsFree = false;
        break;
      }
    }
    if (!keptIsFree) {
      // The tunnel now points at whatever took the port; Settings > Sharing & access says so.
      yield* Effect.logWarning("T3 Med remote access port is taken; scanning for another", {
        port: kept,
      });
    }
  }
  return pickMedBackendPort({ configured, kept, keptIsFree });
});
