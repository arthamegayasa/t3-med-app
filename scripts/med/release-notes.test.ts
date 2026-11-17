// T3 Med: what a release's notes say. What of them the app shows as "What's changed" is
// tested where the app's parser is: apps/desktop/src/med/releaseNotes.test.ts.
import { assert, describe, it } from "vite-plus/test";

import {
  MED_RELEASE_DISCLAIMER,
  groupReleaseCommits,
  previousMedTag,
  renderReleaseNotes,
} from "../lib/med-release-notes.ts";

const commit = (subject: string, merge = false) => ({ subject, merge });

const commits = [
  commit("feat(med): the doctor verifies what is listed"),
  commit("fix(med): a retried filing no longer brings back a removed row"),
  commit("Fix a tab that replaced the backslash in the app's path"),
  commit("Download an update in the background"),
  commit("Merge upstream v0.1.11 into med", true),
  commit("Merge branch 'med-updates' into med", true),
  commit("test(med): wait long enough for the first shell snapshot"),
  commit("docs(med): FORK.md for the ways back"),
  commit("Record round two in FORK.md and BRANDING.md"),
  commit("Download an update in the background"),
];

describe("groupReleaseCommits", () => {
  const groups = groupReleaseCommits(commits, "0.1.10");

  it("sorts the fork's commits by what a doctor would call them", () => {
    assert.deepEqual(groups.added, ["The doctor verifies what is listed"]);
    assert.deepEqual(groups.fixed, [
      "A retried filing no longer brings back a removed row",
      "Fix a tab that replaced the backslash in the app's path",
    ]);
    assert.deepEqual(groups.changed, ["Download an update in the background"]);
  });

  it("sums an upstream merge up in one line, and passes a fork branch's merge commit over", () => {
    assert.deepEqual(groups.merged, ["Merged T3 Code 0.1.11"]);
    assert.deepEqual(
      groupReleaseCommits([commit("Merge upstream into med", true)], "0.1.10").merged,
      ["Merged T3 Code 0.1.10"],
    );
    assert.deepEqual(
      groupReleaseCommits([commit("Merge branch 'med-v2026.11.3-fix'", true)], "0.1.10").merged,
      [],
    );
  });

  it("keeps tests, documentation and tooling apart from what a doctor would notice", () => {
    assert.deepEqual(groups.housekeeping, [
      "Wait long enough for the first shell snapshot",
      "FORK.md for the ways back",
      "Record round two in FORK.md and BRANDING.md",
    ]);
  });
});

describe("previousMedTag", () => {
  it("is the newest release below this one, whatever else is tagged", () => {
    const tags = ["med-v2026.11.1", "med-v2026.11.2", "med-v2026.11.3", "v0.1.10", "med-v2026.x"];
    assert.equal(previousMedTag(tags, "2026.11.3"), "med-v2026.11.2");
    assert.equal(previousMedTag(tags, "2026.12.1"), "med-v2026.11.3");
    assert.isNull(previousMedTag(tags, "2026.11.1"));
  });
});

describe("renderReleaseNotes", () => {
  const notes = renderReleaseNotes({
    version: "2026.11.3",
    previousTag: "med-v2026.11.2",
    groups: groupReleaseCommits(commits, "0.1.10"),
    installer: "T3-Med-2026.11.3-x64.exe",
    size: "211125951",
    sha256: "9e75b58e288b71f77f66c4378834dab96cde83c8fab41eccb7ae4129c9acc88d",
  });
  const fold = notes.indexOf("<details>");
  const end = notes.indexOf("</details>");

  it("puts the changes first, under plain headings, the upstream merge among them", () => {
    assert.equal(
      notes.slice(0, fold).trim(),
      [
        "### New",
        "",
        "- The doctor verifies what is listed",
        "",
        "### Fixed",
        "",
        "- A retried filing no longer brings back a removed row",
        "- Fix a tab that replaced the backslash in the app's path",
        "",
        "### Changed",
        "",
        "- Download an update in the background",
        "- Merged T3 Code 0.1.11",
      ].join("\n"),
    );
  });

  it("folds the housekeeping and the link to every commit away", () => {
    const folded = notes.slice(fold, end);
    assert.include(folded, "<summary>Full changelog</summary>");
    assert.include(folded, "- Wait long enough for the first shell snapshot");
    assert.include(
      folded,
      "https://github.com/arthamegayasa/t3-med-app/compare/med-v2026.11.2...med-v2026.11.3",
    );
  });

  it("ends with how to install, the checksum and the personal-project statement", () => {
    const rest = notes.slice(end);
    assert.include(rest, "download `T3-Med-2026.11.3-x64.exe` below");
    assert.include(rest, "`9e75b58e288b71f77f66c4378834dab96cde83c8fab41eccb7ae4129c9acc88d`");
    assert.isTrue(notes.trimEnd().endsWith(MED_RELEASE_DISCLAIMER));
    for (const phrase of ["personal project", "no warranty", "not a medical device"]) {
      assert.include(MED_RELEASE_DISCLAIMER, phrase);
    }
    assert.notInclude(notes, "pingdotgg");
  });
});
