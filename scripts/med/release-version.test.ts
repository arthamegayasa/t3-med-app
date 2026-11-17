// T3 Med: the version a release run builds, and the runs it refuses.
import { assert, describe, it } from "vite-plus/test";

import { resolveReleaseVersion } from "./release-version.ts";

const today = { year: 2026, month: 11 };
const existing = ["med-v2026.11.1", "med-v2026.11.2", "v0.1.10"];

describe("resolveReleaseVersion", () => {
  it("takes the version of a pushed tag", () => {
    assert.deepEqual(
      resolveReleaseVersion({ ref: "refs/tags/med-v2026.11.3", requested: "", existing, today }),
      { ok: true, version: "2026.11.3", tag: "med-v2026.11.3" },
    );
  });

  it("takes the next version for a manual run that names none", () => {
    assert.deepEqual(
      resolveReleaseVersion({ ref: "refs/heads/med", requested: "", existing, today }),
      { ok: true, version: "2026.11.3", tag: "med-v2026.11.3" },
    );
    assert.deepEqual(
      resolveReleaseVersion({ ref: "refs/heads/med", requested: " ", existing: [], today }),
      { ok: true, version: "2026.11.1", tag: "med-v2026.11.1" },
    );
  });

  it("takes the version a manual run names", () => {
    assert.deepEqual(
      resolveReleaseVersion({ ref: "refs/heads/med", requested: "2026.12.1", existing, today }),
      { ok: true, version: "2026.12.1", tag: "med-v2026.12.1" },
    );
  });

  it("refuses a version at or below the newest release, which no installed app would take", () => {
    for (const ref of ["refs/tags/med-v2026.11.2", "refs/tags/med-v2026.11.1"]) {
      const result = resolveReleaseVersion({ ref, requested: "", existing, today });
      assert.isFalse(result.ok, ref);
      if (!result.ok) assert.include(result.problem, "The next version is 2026.11.3.");
    }
    assert.isFalse(
      resolveReleaseVersion({ ref: "refs/heads/med", requested: "2026.10.9", existing, today }).ok,
    );
  });

  it("refuses a tag or a version of another shape", () => {
    for (const ref of [
      "refs/tags/v0.1.11",
      "refs/tags/med-v0.1.11",
      "refs/tags/med-v2026.11.3-rc.1",
      "refs/tags/med-v2026.11",
    ]) {
      assert.isFalse(resolveReleaseVersion({ ref, requested: "", existing, today }).ok, ref);
    }
    for (const requested of ["0.1.11", "2026.11.3-beta.1", "v2026.11.3", "2026.011.3"]) {
      assert.isFalse(
        resolveReleaseVersion({ ref: "refs/heads/med", requested, existing, today }).ok,
        requested,
      );
    }
  });
});
