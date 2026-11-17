/**
 * T3 Med: checks a built installer before the release workflow publishes it, from the package
 * and not from source: its `app-update.yml` (the feed), the `latest.yml` beside it, the version
 * inside its `app.asar`, and the staged `package.json` electron-builder made the installer
 * from, which is not in the package.
 */
// @effect-diagnostics nodeBuiltinImport:off - A command-line entry point with no Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { extractFile } from "@electron/asar";
import { MED_RELEASE_OWNER, MED_RELEASE_REPO, MED_UPDATE_FEED } from "@t3tools/shared/medRelease";

import { MED_APP_ID, MED_PACKAGE_NAME } from "../lib/med-identity.ts";

/** The top-level `key: value` lines of a file electron-builder wrote. */
function topLevelEntries(text: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) entries.set(match[1], (match[2] ?? "").trim());
  }
  return entries;
}

const unquoted = (value: string | undefined): string | undefined =>
  value?.replace(/^(['"])(.*)\1$/, "$2");

// Everything else in the file would be a second place to fetch from, or a signature to demand.
const APP_UPDATE_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "owner",
  "repo",
  "releaseType",
  "updaterCacheDirName",
]);

/** What is wrong with a packaged `app-update.yml`; empty when the feed is the fork's alone. */
export function checkAppUpdateYml(text: string): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const entries = topLevelEntries(text);
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["provider", "github"],
    ["owner", MED_RELEASE_OWNER],
    ["repo", MED_RELEASE_REPO],
    ["releaseType", "release"],
  ];
  for (const [key, value] of expected) {
    const found = unquoted(entries.get(key));
    if (found !== value) {
      problems.push(`app-update.yml: ${key} is ${found ?? "missing"}, not ${value}.`);
    }
  }
  for (const key of entries.keys()) {
    if (!APP_UPDATE_KEYS.has(key)) {
      problems.push(
        key === "publisherName"
          ? "app-update.yml: publisherName is set, so the updater would refuse every unsigned update."
          : `app-update.yml: unexpected ${key}; the feed must be the fork's GitHub releases and nothing else.`,
      );
    }
  }
  if (/pingdotgg|t3code|t3\.codes/i.test(text)) {
    problems.push("app-update.yml names upstream.");
  }
  return problems;
}

export interface BuiltInstaller {
  readonly version: string;
  readonly fileName: string;
  readonly size: number;
  /** Base64, as electron-builder writes it. */
  readonly sha512: string;
}

/** What is wrong with the `latest.yml` a release publishes for this installer. */
export function checkLatestYml(text: string, installer: BuiltInstaller): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const entries = topLevelEntries(text);
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["version", installer.version],
    ["path", installer.fileName],
    ["sha512", installer.sha512],
  ];
  for (const [key, value] of expected) {
    const found = unquoted(entries.get(key));
    if (found !== value)
      problems.push(`latest.yml: ${key} is ${found ?? "missing"}, not ${value}.`);
  }
  // The `files` list is what the updater downloads; each entry must be this installer.
  const urls = [...text.matchAll(/^\s*-\s*url:\s*(.+)$/gm)].map((match) =>
    unquoted(match[1]!.trim()),
  );
  if (urls.length !== 1 || urls[0] !== installer.fileName) {
    problems.push(
      `latest.yml: files lists ${urls.join(", ") || "nothing"}, not ${installer.fileName}.`,
    );
  }
  const listed = (key: string): ReadonlyArray<string | undefined> =>
    text
      .split(/\r?\n/)
      .filter((line) => line.trimStart() !== line && line.trim().startsWith(`${key}:`))
      .map((line) =>
        unquoted(
          line
            .trim()
            .slice(key.length + 1)
            .trim(),
        ),
      );
  if (listed("sha512").join() !== installer.sha512) {
    problems.push("latest.yml: the listed file's sha512 is not the installer's.");
  }
  if (listed("size").join() !== String(installer.size)) {
    problems.push(
      `latest.yml: the listed file's size is not the installer's ${installer.size} bytes.`,
    );
  }
  if (/https?:\/\//.test(text)) {
    problems.push("latest.yml: a file is given by address; it must be a name in the same release.");
  }
  return problems;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * What is wrong with the manifest inside the packaged `app.asar`: the version the installed app
 * reports, and compares a release with, must be the version being released.
 */
export function checkPackagedManifest(text: string, version: string): ReadonlyArray<string> {
  const manifest = record(JSON.parse(text));
  const problems: Array<string> = [];
  if (manifest.version !== version) {
    problems.push(`The packaged app is version ${String(manifest.version)}, not ${version}.`);
  }
  if (manifest.name !== MED_PACKAGE_NAME) {
    problems.push(`The packaged app is named ${String(manifest.name)}, not ${MED_PACKAGE_NAME}.`);
  }
  return problems;
}

/**
 * What is wrong with the configuration the installer was built from. Patient data is outside
 * every folder the uninstaller knows; the one thing it can delete besides the program is
 * Electron's profile, and only when this configuration says so.
 */
export function checkInstallerConfiguration(text: string, version: string): ReadonlyArray<string> {
  const stage = record(JSON.parse(text));
  const build = record(stage.build);
  const nsis = record(build.nsis);
  const problems: Array<string> = [];
  if (nsis.deleteAppDataOnUninstall !== false) {
    problems.push(
      `The installer's deleteAppDataOnUninstall is ${String(nsis.deleteAppDataOnUninstall)}, not false: an uninstall would delete app data.`,
    );
  }
  if (JSON.stringify(build.publish) !== JSON.stringify([MED_UPDATE_FEED])) {
    problems.push(
      `The installer is published to ${JSON.stringify(build.publish)}, not to the fork's releases alone.`,
    );
  }
  if (build.appId !== MED_APP_ID) {
    problems.push(`The installer's appId is ${String(build.appId)}, not ${MED_APP_ID}.`);
  }
  if (stage.version !== version) {
    problems.push(`The installer was built as version ${String(stage.version)}, not ${version}.`);
  }
  return problems;
}

// The prefix of the folder upstream's packaging script stages a Windows build in.
const STAGE_PREFIX = "t3code-desktop-win-stage-";

/** The one stage folder a build run with `--keep-stage` left in the temp directory. */
function keptStageFolder(): string {
  const temp = NodeOS.tmpdir();
  const stages = NodeFS.readdirSync(temp).filter((name) => name.startsWith(STAGE_PREFIX));
  if (stages.length !== 1) {
    NodeProcess.stderr.write(
      `Expected one ${STAGE_PREFIX}* folder in ${temp}, from a build run with --keep-stage, and found ${stages.length}. Pass --stage <folder>.\n`,
    );
    NodeProcess.exit(2);
  }
  return NodePath.join(temp, stages[0]!);
}

function optionalArgument(name: string): string | undefined {
  const index = NodeProcess.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : NodeProcess.argv[index + 1];
}

function argument(name: string): string {
  const index = NodeProcess.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : NodeProcess.argv[index + 1];
  if (value === undefined || value === "") {
    NodeProcess.stderr.write(`Missing --${name}.\n`);
    NodeProcess.exit(2);
  }
  return value;
}

function main(): void {
  const version = argument("version");
  const installerPath = argument("installer");
  const bytes = NodeFS.readFileSync(installerPath);
  const installer: BuiltInstaller = {
    version,
    fileName: NodePath.basename(installerPath),
    size: bytes.length,
    sha512: NodeCrypto.createHash("sha512").update(bytes).digest("base64"),
  };
  const problems = [
    ...(installer.fileName === `T3-Med-${version}-x64.exe`
      ? []
      : [`The installer is named ${installer.fileName}, not T3-Med-${version}-x64.exe.`]),
    ...checkAppUpdateYml(NodeFS.readFileSync(argument("app-update-yml"), "utf8")),
    ...checkLatestYml(NodeFS.readFileSync(argument("latest-yml"), "utf8"), installer),
    ...checkPackagedManifest(
      extractFile(argument("app-asar"), "package.json").toString("utf8"),
      version,
    ),
    ...checkInstallerConfiguration(
      NodeFS.readFileSync(
        NodePath.join(optionalArgument("stage") ?? keptStageFolder(), "app", "package.json"),
        "utf8",
      ),
      version,
    ),
  ];
  if (problems.length > 0) {
    NodeProcess.stderr.write(`${problems.join("\n")}\n`);
    NodeProcess.exit(1);
  }
  const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  NodeProcess.stdout.write(
    `installer=${installer.fileName}\nsize=${installer.size}\nsha256=${sha256}\n`,
  );
}

if (NodeProcess.argv[1] !== undefined) {
  if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href) main();
}
