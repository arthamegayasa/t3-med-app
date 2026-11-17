// T3 Med: the upstream release the About page and the release notes name is the one `med` holds.
// @effect-diagnostics nodeBuiltinImport:off - Asks git which upstream tags this checkout holds.
import * as NodeChildProcess from "node:child_process";

import { MED_UPSTREAM_VERSION } from "@t3tools/shared/medRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { assert, it } from "vite-plus/test";

/** Upstream's stable release tags that are ancestors of HEAD; none in a clone without them. */
function mergedUpstreamVersions(): ReadonlyArray<string> {
  const listed = NodeChildProcess.spawnSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", "v[0-9]*"],
    { encoding: "utf8" },
  );
  if (listed.status !== 0) return [];
  return listed.stdout
    .split("\n")
    .map((tag) => tag.trim().slice(1))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
}

it("MED_UPSTREAM_VERSION is the newest upstream release merged into this checkout", () => {
  const merged = mergedUpstreamVersions();
  // Upstream's tags come with `git fetch upstream --tags`; the release runner has none, and
  // upstream's manifest lags its tag (0.1.9 at v0.1.10), so the tags are the only true source.
  if (merged.length === 0) return;
  const newest = merged.toSorted(compareSemverVersions).at(-1);
  assert.equal(
    MED_UPSTREAM_VERSION,
    newest,
    `med holds upstream v${newest}: set MED_UPSTREAM_VERSION in packages/shared/src/medRelease.ts.`,
  );
});
