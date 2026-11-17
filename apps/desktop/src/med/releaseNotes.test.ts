// T3 Med: what the app shows of a release's notes, read through upstream's own parser from the
// notes the release workflow writes (`scripts/lib/med-release-notes.ts`).
import { assert, describe, it } from "@effect/vitest";

import {
  groupReleaseCommits,
  renderReleaseNotes,
} from "../../../../scripts/lib/med-release-notes.ts";
import { normalizeDesktopUpdateReleaseNotes } from "../updates/releaseNotes.ts";

const commit = (subject: string, merge = false) => ({ subject, merge });

const release = {
  version: "2026.11.3",
  previousTag: "med-v2026.11.2",
  installer: "T3-Med-2026.11.3-x64.exe",
  size: "211125951",
  sha256: "9e75b58e288b71f77f66c4378834dab96cde83c8fab41eccb7ae4129c9acc88d",
};

const whatsChanged = (commits: ReadonlyArray<ReturnType<typeof commit>>) =>
  normalizeDesktopUpdateReleaseNotes(
    renderReleaseNotes({ ...release, groups: groupReleaseCommits(commits, "0.1.10") }),
    release.version,
    "latest",
  ).releaseNotes;

describe("an update's What's changed", () => {
  it("is the changes, and never the checksum or the fixed lines below them", () => {
    assert.deepEqual(
      whatsChanged([
        commit("feat(med): the doctor verifies what is listed"),
        commit("fix(med): a retried filing no longer brings back a removed row"),
        commit("Download an update in the background"),
        commit("Merge upstream v0.1.11 into med", true),
        commit("test(med): wait long enough for the first shell snapshot"),
      ]),
      [
        {
          version: "2026.11.3",
          items: [
            "The doctor verifies what is listed",
            "A retried filing no longer brings back a removed row",
            "Download an update in the background",
            "Merged T3 Code 0.1.11",
          ],
          totalItems: 4,
        },
      ],
    );
  });

  it("stays short, and says how many more changes the release page lists", () => {
    const many = Array.from({ length: 20 }, (_, index) => commit(`Change number ${index + 1}`));
    const [shown] = whatsChanged([...many, commit("Merge upstream v0.1.11", true)]);
    assert.equal(shown?.items.length, 12);
    assert.include(shown?.items ?? [], "Merged T3 Code 0.1.11");
    assert.equal(shown?.footer, "Plus 9 more changes on the release page");
  });

  it("says so when a release changes nothing a doctor would notice", () => {
    assert.deepEqual(whatsChanged([commit("docs(med): a typo")])[0]?.items, [
      "Maintenance only: nothing changes in how T3 Med is used.",
    ]);
  });
});
