/**
 * T3 Med: the desktop app opens on the patient workspace, as `start-t3-med.cmd` does. The folder
 * is the `workspace` setting in `t3med-desktop.json` in the state directory; `T3MED_WORKSPACE`
 * wins over it. A folder that does not exist is not opened: the server would create it.
 */
// @effect-diagnostics nodeBuiltinImport:off - Read once per backend start, where upstream's seam provides no FileSystem.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import type { DesktopBackendStartConfig } from "../backend/DesktopBackendManager.ts";

export const MED_DEFAULT_WORKSPACE = "D:\\T3 Projects\\T3 Med";
const MED_DESKTOP_SETTINGS_FILE = "t3med-desktop.json";
const WORKSPACE_ENV = "T3MED_WORKSPACE";

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/** The workspace named by the settings file's text, or undefined when it names none. */
export function parseMedWorkspaceSetting(raw: string): string | undefined {
  try {
    // Windows PowerShell 5.1 writes a byte order mark, which JSON.parse refuses.
    const parsed: unknown = JSON.parse(raw.replace(/^﻿/, ""));
    return typeof parsed === "object" && parsed !== null && "workspace" in parsed
      ? nonEmpty(parsed.workspace)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Environment first, then the file, then the default. */
export function resolveMedWorkspace(input: {
  readonly env: string | undefined;
  readonly settingsFile: string | undefined;
}): string {
  return (
    nonEmpty(input.env) ??
    (input.settingsFile === undefined ? undefined : parseMedWorkspaceSetting(input.settingsFile)) ??
    MED_DEFAULT_WORKSPACE
  );
}

/** The server's own flag and folder argument, the ones `start-t3-med.cmd` passes. */
export const withMedWorkspace = <Config extends { readonly args: ReadonlyArray<string> }>(
  config: Config,
  workspace: string | undefined,
): Config =>
  workspace === undefined
    ? config
    : { ...config, args: [...config.args, "--auto-bootstrap-project-from-cwd", workspace] };

const readSettingsFile = (settingsPath: string): string | undefined => {
  try {
    return NodeFS.readFileSync(settingsPath, "utf8");
  } catch {
    return undefined;
  }
};

const isDirectory = (candidate: string): boolean => {
  try {
    return NodeFS.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

// So the setting can be found and changed. Failing to write it changes nothing else.
const writeDefaultSettingsFile = (settingsPath: string): void => {
  try {
    NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
    const text = `${JSON.stringify({ workspace: MED_DEFAULT_WORKSPACE }, null, 2)}\n`;
    NodeFS.writeFileSync(settingsPath, text, { flag: "wx" });
  } catch {}
};

/** Adds the patient workspace to the Windows backend's start. */
export const medPrimaryStart = Effect.fn("med.desktop.primaryStart")(function* (
  config: DesktopBackendStartConfig,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const env = yield* HostProcess.Environment;
  const settingsPath = NodePath.join(environment.stateDir, MED_DESKTOP_SETTINGS_FILE);
  const settingsFile = readSettingsFile(settingsPath);
  if (settingsFile === undefined) writeDefaultSettingsFile(settingsPath);
  const workspace = resolveMedWorkspace({ env: env[WORKSPACE_ENV], settingsFile });
  if (settingsFile !== undefined && parseMedWorkspaceSetting(settingsFile) === undefined) {
    // In JSON a Windows path needs doubled backslashes; a hand edit often forgets.
    yield* Effect.logWarning("T3 Med workspace setting could not be read; using the default", {
      settingsPath,
    });
  }
  if (!isDirectory(workspace)) {
    yield* Effect.logWarning("T3 Med workspace folder not found; starting without a project", {
      workspace,
      settingsPath,
    });
    return config;
  }
  return withMedWorkspace(config, workspace);
});
