/**
 * T3 Med: what a release's notes say, from the fork's own commit subjects. In `scripts/lib`
 * because the release workflow's script (`scripts/med/release-notes.ts`) writes them and a
 * desktop test reads them back through the app's own parser, and both compile this folder.
 */
import {
  MED_RELEASES_URL,
  compareMedVersions,
  latestMedVersion,
  medReleaseTag,
  medVersionOfTag,
  parseMedVersion,
} from "@t3tools/shared/medRelease";

export interface ReleaseCommit {
  readonly subject: string;
  /** A commit with two parents. Only one that brings upstream in is named in the notes. */
  readonly merge: boolean;
}

export interface ReleaseNoteGroups {
  readonly added: ReadonlyArray<string>;
  readonly fixed: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  /** `Merged T3 Code <version>`: one line for the hundreds of commits such a merge brings. */
  readonly merged: ReadonlyArray<string>;
  /** Tests, documentation and tooling: on the release page, not in the app. */
  readonly housekeeping: ReadonlyArray<string>;
}

const CONVENTIONAL = /^([a-z]+)(?:\([^)]*\))?!?:\s+(.+)$/;
const HOUSEKEEPING_TYPES: ReadonlySet<string> = new Set([
  "test",
  "tests",
  "docs",
  "chore",
  "ci",
  "build",
  "refactor",
  "style",
]);
const HOUSEKEEPING_SUBJECT =
  /^(?:record|write down|document)\b|\b(?:FORK|BRANDING|README|AGENTS)\.md\b/i;
// `v0.1.11` is upstream's tag; `med-v2026.11.3` is the fork's.
export const UPSTREAM_MERGE = /^Merge\b.*(?:\bupstream\b|\bT3 Code\b|(?<!med-)\bv\d+\.\d+\.\d+\b)/i;
const UPSTREAM_VERSION = /(?<!med-)\bv?(\d+\.\d+\.\d+)\b/;

const sentence = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

/**
 * Sorts the fork's own commits, oldest first, into what the notes list. `upstreamVersion` names
 * an upstream merge whose subject does not say which release it took.
 */
export function groupReleaseCommits(
  commits: ReadonlyArray<ReleaseCommit>,
  upstreamVersion: string,
): ReleaseNoteGroups {
  const groups = {
    added: new Set<string>(),
    fixed: new Set<string>(),
    changed: new Set<string>(),
    merged: new Set<string>(),
    housekeeping: new Set<string>(),
  };
  for (const { subject, merge } of commits) {
    if (merge) {
      if (UPSTREAM_MERGE.test(subject)) {
        groups.merged.add(
          `Merged T3 Code ${UPSTREAM_VERSION.exec(subject)?.[1] ?? upstreamVersion}`,
        );
      }
      continue;
    }
    const conventional = CONVENTIONAL.exec(subject);
    const type = conventional?.[1];
    const text = sentence(conventional?.[2] ?? subject);
    if (text === "") continue;
    if (type !== undefined && HOUSEKEEPING_TYPES.has(type)) groups.housekeeping.add(text);
    else if (type === undefined && HOUSEKEEPING_SUBJECT.test(text)) groups.housekeeping.add(text);
    else if (type === "fix" || (type === undefined && /^fix(?:e[sd])?\b/i.test(text))) {
      groups.fixed.add(text);
    } else if (type === "feat") groups.added.add(text);
    else groups.changed.add(text);
  }
  return {
    added: [...groups.added],
    fixed: [...groups.fixed],
    changed: [...groups.changed],
    merged: [...groups.merged],
    housekeeping: [...groups.housekeeping],
  };
}

/** The newest release tag below `version`: where this release's changes start. */
export function previousMedTag(tags: ReadonlyArray<string>, version: string): string | null {
  const current = parseMedVersion(version);
  if (current === null) return null;
  const previous = latestMedVersion(
    tags.filter((tag) => {
      const parsed = parseMedVersion(medVersionOfTag(tag) ?? "");
      return parsed !== null && compareMedVersions(parsed, current) < 0;
    }),
  );
  return previous === null ? null : medReleaseTag(previous);
}

export interface ReleaseNotesInput {
  readonly version: string;
  readonly previousTag: string | null;
  readonly groups: ReleaseNoteGroups;
  readonly installer: string;
  readonly size: string;
  readonly sha256: string;
}

/** As many lines as the app's update popover shows without becoming a page. */
const SHOWN_IN_APP = 12;

export const MED_RELEASE_DISCLAIMER =
  "T3 Med is one doctor's personal project, built on T3 Code. It comes with no warranty, is not a medical device, and is not offered for clinical use by anyone else.";

const list = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items.map((item) => `- ${item}`);

export function renderReleaseNotes(input: ReleaseNotesInput): string {
  const { groups } = input;
  const tag = medReleaseTag(input.version);
  let room = SHOWN_IN_APP;
  const later: Array<string> = [];
  const shown = (items: ReadonlyArray<string>): ReadonlyArray<string> => {
    const kept = items.slice(0, room);
    room -= kept.length;
    later.push(...items.slice(kept.length));
    return kept;
  };
  // An upstream merge is always named: it is the largest change a release can carry.
  const merged = shown(groups.merged);
  const sections: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["New", shown(groups.added)],
    ["Fixed", shown(groups.fixed)],
    ["Changed", [...shown(groups.changed), ...merged]],
  ];
  const lines: Array<string> = [];
  for (const [heading, items] of sections) {
    if (items.length > 0) lines.push(`### ${heading}`, "", ...list(items), "");
  }
  if (lines.length === 0) {
    lines.push("- Maintenance only: nothing changes in how T3 Med is used.", "");
  }
  if (later.length > 0) {
    lines.push(`### Plus ${later.length} more changes on the release page`, "");
  }

  lines.push("<details>", "<summary>Full changelog</summary>", "");
  if (later.length > 0) lines.push("More changes:", "", ...list(later), "");
  if (groups.housekeeping.length > 0) {
    lines.push("Tests, documentation and tooling:", "", ...list(groups.housekeeping), "");
  }
  lines.push(
    input.previousTag === null
      ? `Every commit: ${MED_RELEASES_URL.replace(/\/releases$/, "")}/commits/${tag}`
      : `Every commit: ${MED_RELEASES_URL.replace(/\/releases$/, "")}/compare/${input.previousTag}...${tag}`,
    "",
    "</details>",
    "",
    `An installed T3 Med downloads this release by itself and asks when to restart. To install T3 Med for the first time, download \`${input.installer}\` below; Windows warns that it is unsigned.`,
    "",
    `The installer is not code-signed. SHA-256 of \`${input.installer}\` (${input.size} bytes):`,
    "",
    `\`${input.sha256}\``,
    "",
    MED_RELEASE_DISCLAIMER,
    "",
  );
  return lines.join("\n");
}
