/**
 * T3 Med: which version a run of `.github/workflows/med-release.yml` builds, by the rules of
 * `packages/shared/src/medRelease.ts` (docs/t3-med/FORK.md, "Updates"). Takes `--ref`,
 * `--requested` and `--existing`; prints `version=`, `tag=` and `upstream=`, a step's outputs.
 */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - A command-line entry point with no Effect runtime; a version starts with today's year and month.
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import {
  MED_RELEASE_TAG_PREFIX,
  MED_UPSTREAM_VERSION,
  compareMedVersions,
  latestMedVersion,
  medReleaseTag,
  medVersionOfTag,
  nextMedVersion,
  parseMedVersion,
} from "@t3tools/shared/medRelease";

export interface ReleaseVersionInput {
  /** The ref the workflow runs for: `refs/tags/med-v...` for a pushed tag. */
  readonly ref: string;
  /** The version typed into a manual run; empty takes the next one. */
  readonly requested: string;
  /** The tags of the releases that exist, drafts included. */
  readonly existing: ReadonlyArray<string>;
  readonly today: { readonly year: number; readonly month: number };
}

export type ReleaseVersion =
  | { readonly ok: true; readonly version: string; readonly tag: string }
  | { readonly ok: false; readonly problem: string };

const SHAPE = "<year>.<month>.<release>, such as 2026.11.2";

/**
 * A pushed tag names its version. A manual run takes the version it was given, or the next one.
 * Either way the version must be above every release that exists: the installed app only moves
 * to a version semver calls newer, so a release at or below the newest would reach nobody.
 */
export function resolveReleaseVersion(input: ReleaseVersionInput): ReleaseVersion {
  const latest = latestMedVersion(input.existing);
  let version: string;
  if (input.ref.startsWith("refs/tags/")) {
    const tagged = medVersionOfTag(input.ref);
    if (tagged === null) {
      return {
        ok: false,
        problem: `${input.ref} is not a T3 Med release tag. A release tag is ${MED_RELEASE_TAG_PREFIX}${SHAPE}.`,
      };
    }
    version = tagged;
  } else if (input.requested.trim() === "") {
    version = nextMedVersion(latest, input.today);
  } else {
    version = input.requested.trim();
  }

  const parsed = parseMedVersion(version);
  if (parsed === null) {
    return { ok: false, problem: `"${version}" is not a T3 Med version. A version is ${SHAPE}.` };
  }
  const newest = latest === null ? null : parseMedVersion(latest);
  if (newest !== null && compareMedVersions(parsed, newest) <= 0) {
    return {
      ok: false,
      problem: `${version} is not above ${latest}, the newest release. The next version is ${nextMedVersion(latest, input.today)}.`,
    };
  }
  return { ok: true, version, tag: medReleaseTag(version) };
}

function argument(name: string): string {
  const index = NodeProcess.argv.indexOf(`--${name}`);
  return index === -1 ? "" : (NodeProcess.argv[index + 1] ?? "");
}

function main(): void {
  const now = new Date();
  const result = resolveReleaseVersion({
    ref: argument("ref"),
    requested: argument("requested"),
    existing: argument("existing")
      .split(/[\s,]+/)
      .filter((tag) => tag.length > 0),
    today: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
  });
  if (!result.ok) {
    NodeProcess.stderr.write(`${result.problem}\n`);
    NodeProcess.exit(1);
  }
  NodeProcess.stdout.write(
    `version=${result.version}\ntag=${result.tag}\nupstream=${MED_UPSTREAM_VERSION}\n`,
  );
}

if (NodeProcess.argv[1] !== undefined) {
  if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href) main();
}
