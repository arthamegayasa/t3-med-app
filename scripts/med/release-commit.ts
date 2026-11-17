/**
 * T3 Med: which commit `.github/workflows/med-release.yml` may build. Only what is on `med`
 * is released: a tag pushed on any other commit, and a manual run started on another branch,
 * are refused before anything is built. Takes `--event`, `--ref` and `--sha`.
 */
// @effect-diagnostics nodeBuiltinImport:off - A command-line entry point with no Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const MED_BRANCH_REF = "refs/heads/med";
/** Where the workflow fetches `med` to before it asks. */
const MED_REMOTE_REF = "refs/remotes/origin/med";

export interface ReleaseCommitInput {
  /** `push` for a pushed tag, `workflow_dispatch` for a manual run. */
  readonly event: string;
  readonly ref: string;
  /** Whether the commit is `origin/med`'s head or one of its ancestors. */
  readonly onMed: boolean;
}

/** Why this run must not build, or null when it may. */
export function releaseCommitProblem(input: ReleaseCommitInput): string | null {
  if (input.event === "workflow_dispatch" && input.ref !== MED_BRANCH_REF) {
    return `A manual run builds med. This one was started on ${input.ref}: start it with --ref med.`;
  }
  if (!input.onMed) {
    return `The commit of ${input.ref} is not on med. Merge it into med first, then release from med.`;
  }
  return null;
}

function argument(name: string): string {
  const index = NodeProcess.argv.indexOf(`--${name}`);
  return index === -1 ? "" : (NodeProcess.argv[index + 1] ?? "");
}

function main(): void {
  const sha = argument("sha");
  const ancestry = NodeChildProcess.spawnSync(
    "git",
    ["merge-base", "--is-ancestor", sha, MED_REMOTE_REF],
    { encoding: "utf8" },
  );
  // 0: an ancestor. 1: not one. Anything else: git could not tell, which is not a yes.
  if (ancestry.status !== 0 && ancestry.status !== 1) {
    NodeProcess.stderr.write(
      `Could not compare ${sha} with ${MED_REMOTE_REF}: ${ancestry.stderr || ancestry.error?.message || "git failed"}\n`,
    );
    NodeProcess.exit(2);
  }
  const problem = releaseCommitProblem({
    event: argument("event"),
    ref: argument("ref"),
    onMed: ancestry.status === 0,
  });
  if (problem !== null) {
    NodeProcess.stderr.write(`${problem}\n`);
    NodeProcess.exit(1);
  }
  NodeProcess.stdout.write(`${sha} is on med.\n`);
}

if (NodeProcess.argv[1] !== undefined) {
  if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href) main();
}
