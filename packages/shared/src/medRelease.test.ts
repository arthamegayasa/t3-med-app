// T3 Med: the release repository, the version scheme and its order.
import { assert, describe, it } from "vite-plus/test";

import {
  CLI_RELEASES_PAGE_URL,
  cliReleaseIndexPageUrl,
  desktopUpdateChannelOf,
  newestCliReleaseVersion,
} from "./cliRelease.ts";
import {
  MED_RELEASE_REPOSITORY,
  MED_RELEASES_URL,
  MED_UPDATE_FEED,
  MED_UPSTREAM_VERSION,
  compareMedVersions,
  isMedReleaseVersion,
  latestMedVersion,
  medReleaseTag,
  medReleaseUrl,
  medVersionOfTag,
  nextMedVersion,
  parseMedVersion,
} from "./medRelease.ts";
import { compareSemverVersions, parseSemver } from "./semver.ts";

describe("the release repository", () => {
  it("is the fork's, in the feed and in every address built from it", () => {
    assert.equal(MED_RELEASE_REPOSITORY, "arthamegayasa/t3-med-app");
    assert.deepEqual(MED_UPDATE_FEED, {
      provider: "github",
      owner: "arthamegayasa",
      repo: "t3-med-app",
      releaseType: "release",
    });
    assert.equal(MED_RELEASES_URL, "https://github.com/arthamegayasa/t3-med-app/releases");
    // Upstream's release index, CLI downloads and remote-server update read the same name.
    assert.equal(CLI_RELEASES_PAGE_URL, MED_RELEASES_URL);
    assert.include(cliReleaseIndexPageUrl(1), `/repos/${MED_RELEASE_REPOSITORY}/releases`);
  });

  it("links a release by the fork's tag, and a source build to the list", () => {
    assert.equal(medReleaseUrl("2026.11.2"), `${MED_RELEASES_URL}/tag/med-v2026.11.2`);
    assert.equal(medReleaseUrl("0.1.9"), MED_RELEASES_URL);
  });
});

describe("a T3 Med version", () => {
  it("is year, month and the release of that month", () => {
    assert.deepEqual(parseMedVersion("2026.11.2"), { year: 2026, month: 11, release: 2 });
    assert.deepEqual(parseMedVersion("2027.1.14"), { year: 2027, month: 1, release: 14 });
  });

  it("is nothing else", () => {
    for (const version of [
      "0.1.9", // upstream's manifest version: a build from source
      "0.1.10",
      "2026.11", // two numbers
      "2026.11.0", // releases count from one
      "2026.011.1", // semver refuses a leading zero
      "2026.13.1", // no such month
      "2026.11.1-med.1", // a pre-release sorts below its release and names a channel
      "2026.11.1-nightly.20261118.1",
      "2026.11.1+build",
      "v2026.11.1",
      " 2026.11.1",
    ]) {
      assert.isNull(parseMedVersion(version), version);
      assert.isFalse(isMedReleaseVersion(version), version);
    }
  });

  it("is a semver the updater puts on the stable channel", () => {
    assert.isNotNull(parseSemver("2026.11.2"));
    assert.equal(desktopUpdateChannelOf("2026.11.2"), "latest");
  });
});

describe("the order of releases", () => {
  // Oldest first. The updater offers a release only when semver calls it newer than the app.
  const releases = [
    "2026.11.1",
    "2026.11.2",
    "2026.11.9",
    "2026.11.10", // a number, not text: 10 follows 9
    "2026.12.1", // a new month starts again at 1 and is still newer
    "2027.1.1", // so does a new year
    "2027.1.2",
    "2027.10.1",
  ];

  it("is the order semver gives, for every pair", () => {
    for (const [olderIndex, older] of releases.entries()) {
      for (const newer of releases.slice(olderIndex + 1)) {
        assert.isAbove(compareSemverVersions(newer, older), 0, `${newer} > ${older}`);
        assert.isBelow(compareSemverVersions(older, newer), 0, `${older} < ${newer}`);
        assert.isAbove(
          compareMedVersions(parseMedVersion(newer)!, parseMedVersion(older)!),
          0,
          `${newer} > ${older}`,
        );
      }
    }
  });

  it("puts every release above any version upstream's manifest can hold before year 2026", () => {
    // A build from source, or the installer of 17 November 2026, runs as upstream's version.
    for (const upstream of ["0.1.9", MED_UPSTREAM_VERSION, "0.2.0", "1.0.0", "9.99.99"]) {
      assert.isAbove(compareSemverVersions("2026.11.1", upstream), 0, upstream);
    }
  });
});

describe("the next version", () => {
  const november = { year: 2026, month: 11 };

  it("starts a month at 1 and counts up within it", () => {
    assert.equal(nextMedVersion(null, november), "2026.11.1");
    assert.equal(nextMedVersion("2026.11.1", november), "2026.11.2");
    assert.equal(nextMedVersion("2026.11.9", november), "2026.11.10");
    assert.equal(nextMedVersion("2026.10.4", november), "2026.11.1");
    assert.equal(nextMedVersion("2026.11.3", { year: 2027, month: 1 }), "2027.1.1");
  });

  it("never goes below the newest release, whatever the clock says", () => {
    assert.equal(nextMedVersion("2026.12.2", november), "2026.12.3");
    const next = nextMedVersion("2027.3.1", november);
    assert.isAbove(compareSemverVersions(next, "2027.3.1"), 0);
  });
});

describe("release tags", () => {
  it("carry the fork's prefix", () => {
    assert.equal(medReleaseTag("2026.11.2"), "med-v2026.11.2");
    assert.equal(medVersionOfTag("med-v2026.11.2"), "2026.11.2");
    assert.equal(medVersionOfTag("refs/tags/med-v2026.11.2"), "2026.11.2");
  });

  it("are not upstream's tags, nor a tag of another shape", () => {
    for (const tag of ["v0.1.10", "v2026.11.2", "med-v0.1.10", "med-v2026.11.2-rc.1", "med-v"]) {
      assert.isNull(medVersionOfTag(tag), tag);
    }
  });

  it("are not read as a build of upstream's CLI or server", () => {
    // `t3 update` and the remote-server update look for `v<version>` and a `t3-*` archive.
    const releases = [{ tag_name: "med-v2026.11.2" }, { tag_name: "med-v2026.11.1" }];
    assert.isUndefined(newestCliReleaseVersion(releases, "stable"));
    assert.isUndefined(newestCliReleaseVersion(releases, "nightly"));
  });

  it("give the newest release among them", () => {
    assert.equal(
      latestMedVersion(["med-v2026.11.9", "v0.1.10", "med-v2026.11.10", "med-v2026.10.30"]),
      "2026.11.10",
    );
    assert.isNull(latestMedVersion(["v0.1.10", "v0.1.9-nightly.20261109.4440"]));
  });
});
