// T3 Med: the version Settings > About shows, and where an update's release link leads.
import { MED_UPSTREAM_VERSION } from "@t3tools/shared/medRelease";
import { describe, expect, it } from "vite-plus/test";

import {
  getDesktopUpdateInstallConfirmationMessage,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
} from "../components/desktopUpdate.logic";
import { describeMedVersion } from "./medVersion";

describe("describeMedVersion", () => {
  it("shows a release's own version and the upstream release under it", () => {
    expect(describeMedVersion("2026.11.2")).toEqual({
      label: "2026.11.2",
      builtOn: `built on T3 Code ${MED_UPSTREAM_VERSION}`,
      copyText: `T3 Med 2026.11.2 (built on T3 Code ${MED_UPSTREAM_VERSION})`,
    });
  });

  it("does not pass upstream's manifest version off as a T3 Med version", () => {
    const source = describeMedVersion("0.1.9");
    expect(source.label).toBe("from source");
    expect(source.builtOn).toBe(`built on T3 Code ${MED_UPSTREAM_VERSION}`);
    expect(source.copyText).toContain("manifest 0.1.9");
  });
});

// Twin of upstream's "falls back to upstream for an invalid configured repository", which
// medSkippedTests.ts skips: here the fallback is the fork's repository and the fork's tag.
describe("an update's release links", () => {
  const releases = "https://github.com/arthamegayasa/t3-med-app/releases";

  it("lead to the fork's release, by the fork's tag", () => {
    expect(getDesktopUpdateReleaseUrl("2026.11.2", undefined)).toBe(
      `${releases}/tag/med-v2026.11.2`,
    );
    expect(getDesktopUpdateReleaseUrl("2026.11.2", "")).toBe(`${releases}/tag/med-v2026.11.2`);
    expect(getDesktopUpdateReleaseHistoryUrl(undefined)).toBe(releases);
  });

  it.each(["owner/repo/extra", "owner#notes/repo", "owner/repo?tab=notes"])(
    "fall back to the fork, never to upstream, for an invalid configured repository: %s",
    (repository) => {
      expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(releases);
      expect(getDesktopUpdateReleaseUrl("2026.11.2", repository)).toBe(
        `${releases}/tag/med-v2026.11.2`,
      );
    },
  );

  it("ask to restart T3 Med", () => {
    const message = getDesktopUpdateInstallConfirmationMessage({
      availableVersion: "2026.11.2",
      downloadedVersion: "2026.11.2",
    });
    expect(message).toContain("Install update 2026.11.2 and restart T3 Med?");
    expect(message).not.toContain("T3 Code");
  });
});
