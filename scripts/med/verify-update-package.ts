/**
 * T3 Med: checks a built installer before the release workflow publishes it, from what is in
 * the package and not from source: the `app-update.yml` taken out of the installer, the only
 * place an installed app reads its feed from, and the `latest.yml` it verifies a download by.
 */
// @effect-diagnostics nodeBuiltinImport:off - A command-line entry point with no Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { MED_RELEASE_OWNER, MED_RELEASE_REPO } from "@t3tools/shared/medRelease";

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
