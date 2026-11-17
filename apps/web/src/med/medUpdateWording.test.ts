// T3 Med: what an update says to a doctor, and that it says it once.
import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
} from "../components/desktopUpdate.logic";
import { announceMedUpdateReady } from "./medUpdateAnnounce";
import { MED_INSTALL_LABEL, medUpdateRowText } from "./medUpdateWording";

const idle: DesktopUpdateState = {
  enabled: true,
  status: "up-to-date",
  channel: "latest",
  currentVersion: "2026.11.2",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
const found: DesktopUpdateState = { ...idle, status: "available", availableVersion: "2026.11.3" };
const downloaded: DesktopUpdateState = {
  ...found,
  status: "downloaded",
  downloadedVersion: "2026.11.3",
  downloadPercent: 100,
};

describe("the update button's words", () => {
  it("never ask the doctor to download: a found update downloads by itself", () => {
    const tooltip = getDesktopUpdateButtonTooltip(found);
    expect(tooltip).toBe("Update 2026.11.3 found. It downloads by itself.");
    expect(tooltip).not.toMatch(/ready to download/i);
    expect(
      getDesktopUpdateButtonTooltip({ ...found, status: "downloading", downloadPercent: 41.7 }),
    ).toBe("Downloading update 2026.11.3 (41%)");
  });

  it("say what the one click does once the update is downloaded", () => {
    expect(getDesktopUpdateButtonTooltip(downloaded)).toBe("Restart to update to 2026.11.3");
    // A check that failed afterwards leaves the download in place, and the same words.
    expect(
      getDesktopUpdateButtonTooltip({ ...downloaded, status: "error", message: "offline" }),
    ).toBe("Restart to update to 2026.11.3");
    expect(
      getDesktopUpdateButtonTooltip({ ...downloaded, status: "error", errorContext: "install" }),
    ).toBe("Update 2026.11.3 could not be installed. Click to try again.");
  });

  it("warn that a running chat is interrupted before the restart", () => {
    const question = getDesktopUpdateInstallConfirmationMessage(downloaded);
    expect(question).toContain("Restart T3 Med to update to 2026.11.3?");
    expect(question).toContain("A chat that is still running will be interrupted.");
    expect(question).not.toContain("T3 Code");
  });

  it("name T3 Med in a managed policy's sentence", () => {
    expect(getDesktopUpdateDisabledReason(idle, "Example Clinic manages T3 Code updates.")).toBe(
      "Example Clinic manages T3 Med updates.",
    );
  });
});

describe("the Version row of Settings > About", () => {
  it("does not say an update is merely available beside the button that restarts into it", () => {
    expect(MED_INSTALL_LABEL).toBe("Restart to update");
    expect(medUpdateRowText(downloaded, "Update available.")).toBe(
      "Update 2026.11.3 is downloaded. Restart T3 Med to install it.",
    );
    expect(medUpdateRowText(found, "Update available.")).toBe("Update 2026.11.3 is available.");
    expect(medUpdateRowText(null, "Update available.")).toBe("Update available.");
  });
});

describe("the notice that an update is ready", () => {
  const announcer = () => {
    let announced: string | null = null;
    const notices: Array<string> = [];
    return {
      notices,
      read: () => announced,
      write: (version: string) => {
        announced = version;
      },
      notify: (title: string, description: string) => {
        notices.push(`${title}: ${description}`);
      },
    };
  };

  it("is given once for a version, however often the app finds it downloaded", () => {
    const spoken = announcer();
    expect(announceMedUpdateReady(null, spoken)).toBe(false);
    expect(announceMedUpdateReady("2026.11.3", spoken)).toBe(true);
    // After a restart of the app the same download is offered again, quietly.
    expect(announceMedUpdateReady("2026.11.3", spoken)).toBe(false);
    expect(spoken.notices).toHaveLength(1);
    expect(spoken.notices[0]).toContain("Update 2026.11.3 is ready");
    expect(spoken.notices[0]).toContain("Restart to update");
    expect(spoken.notices[0]).not.toContain("T3 Code");

    expect(announceMedUpdateReady("2026.12.1", spoken)).toBe(true);
    expect(spoken.notices).toHaveLength(2);
  });
});
