/**
 * T3 Med: a release's notes, written by `.github/workflows/med-release.yml` from the commits
 * since the release before it. The app shows the list above the "Full changelog" fold as an
 * update's "What's changed" (`apps/desktop/src/updates/releaseNotes.ts`), so what a doctor would
 * notice comes first and the checksum, which only the release page needs, last.
 */
// @effect-diagnostics nodeBuiltinImport:off - A command-line entry point with no Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import {
  type ReleaseCommit,
  UPSTREAM_MERGE,
  groupReleaseCommits,
  previousMedTag,
  renderReleaseNotes,
} from "../lib/med-release-notes.ts";

function argument(name: string): string {
  const index = NodeProcess.argv.indexOf(`--${name}`);
  return index === -1 ? "" : (NodeProcess.argv[index + 1] ?? "");
}

const git = (...args: ReadonlyArray<string>): ReadonlyArray<string> =>
  NodeChildProcess.execFileSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((line) => line.length > 0);

/**
 * The fork's commits in `range`, oldest first: the first-parent line, with a merged fork branch
 * replaced by its own commits. An upstream merge stays one commit, never the commits it brings.
 */
function forkCommits(range: string): ReadonlyArray<ReleaseCommit> {
  const commits: Array<ReleaseCommit> = [];
  for (const line of git("log", "--first-parent", "--reverse", "--format=%P%x09%s", range)) {
    const [parents = "", subject = ""] = line.split("\t");
    const [first, second] = parents.split(" ");
    if (first === undefined || second === undefined) {
      commits.push({ subject, merge: false });
    } else if (UPSTREAM_MERGE.test(subject)) {
      commits.push({ subject, merge: true });
    } else {
      for (const merged of git(
        "log",
        "--first-parent",
        "--no-merges",
        "--reverse",
        "--format=%s",
        `${first}..${second}`,
      )) {
        commits.push({ subject: merged, merge: false });
      }
    }
  }
  return commits;
}

function main(): void {
  const version = argument("version");
  const head = argument("head") || "HEAD";
  const previousTag = previousMedTag(git("tag", "--list", "med-v*"), version);
  const commits = forkCommits(previousTag === null ? head : `${previousTag}..${head}`);
  NodeProcess.stdout.write(
    renderReleaseNotes({
      version,
      previousTag,
      groups: groupReleaseCommits(commits, argument("upstream")),
      installer: argument("installer"),
      size: argument("size"),
      sha256: argument("sha256"),
    }),
  );
}

if (NodeProcess.argv[1] !== undefined) {
  if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href) main();
}
