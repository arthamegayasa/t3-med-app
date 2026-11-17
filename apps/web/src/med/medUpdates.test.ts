// T3 Med: which of upstream's update controls are shown again, and which stay hidden.
import { describe, expect, it } from "vite-plus/test";

import { hidesSettingsTarget, MED_UPSTREAM_NAMES } from "./medHidden";
import { T3MED } from "./t3med";

// Upstream's own source, as text: each gate below is one line in one of these files.
const sources = import.meta.glob<string>(
  [
    "../components/sidebar/SidebarChrome.tsx",
    "../components/sidebar/useUpdateEverything.ts",
    "../components/settings/SettingsPanels.tsx",
    "../components/settings/ConnectionsSettings.tsx",
    "../components/settings/SavedEnvironmentRows.tsx",
    "../components/chat/useSystemComposerBanners.tsx",
    "../components/ProviderUpdatesAction.tsx",
    "../components/desktopUpdate.logic.ts",
    "../components/desktopUpdate.toast.tsx",
    "../components/sidebar/UpdateEverythingDialog.tsx",
  ],
  { query: "?raw", import: "default" },
);

async function source(path: string): Promise<string> {
  const load = sources[path];
  if (load === undefined) throw new Error(`${path} is not one of upstream's files any more.`);
  return load();
}

describe("the desktop app's own update", () => {
  it("is offered by the sidebar's update button", async () => {
    const chrome = await source("../components/sidebar/SidebarChrome.tsx");
    expect(chrome).toMatch(/^\s*<SidebarUpdatePill \/>$/m);
    expect(chrome).not.toContain("{T3MED ? null : <SidebarUpdatePill />}");
  });

  it("is offered by one labelled button once it is downloaded, and announced once", async () => {
    const chrome = await source("../components/sidebar/SidebarChrome.tsx");
    expect(chrome).toMatch(/^\s*<MedUpdateReady \/>$/m);
    // Upstream's toast follows a click on Download; T3 Med's follows the download itself.
    const toast = await source("../components/desktopUpdate.toast.tsx");
    expect(toast).toContain(
      "if (T3MED) return void announceMedUpdateReady(getDesktopUpdateDownloadedVersion(state));",
    );
  });

  it("is offered by the Version row of Settings > About", async () => {
    const panels = await source("../components/settings/SettingsPanels.tsx");
    expect(panels).toMatch(/\{isElectron \|\| HOSTED_APP_CHANNEL \? \(\s*<AboutVersionSection \/>/);
    // The row's title is the fork's: T3 Med's version and the upstream release under it.
    expect(panels).toContain('import { AboutVersionTitle } from "../../med/MedAboutVersionTitle";');
    expect(hidesSettingsTarget("app-version")).toBe(false);
    expect(panels).toContain('{ download: "Download", install: MED_INSTALL_LABEL };');
    expect(panels).toContain('? medUpdateRowText(updateState, "Update available.")');
  });

  it("links a release to the fork's repository and tag, with no upstream fallback", async () => {
    const logic = await source("../components/desktopUpdate.logic.ts");
    expect(logic).toContain("const DEFAULT_DESKTOP_RELEASE_REPOSITORY = MED_RELEASE_REPOSITORY;");
    expect(logic).not.toContain("pingdotgg");
  });
});

describe("what stays hidden", () => {
  it("has no Stable or Nightly picker: T3 Med has one channel", () => {
    expect(T3MED).toBe(true);
    expect(MED_UPSTREAM_NAMES.settingsTargets.has("update-track")).toBe(true);
    expect(hidesSettingsTarget("update-track")).toBe(true);
  });

  it("never adds a provider's CLI to the app's update", async () => {
    const everything = await source("../components/sidebar/useUpdateEverything.ts");
    expect(everything).toContain("channelSwitch || T3MED ? { machines: [], updateAll:");
    const chrome = await source("../components/sidebar/SidebarChrome.tsx");
    expect(chrome).toContain("{T3MED ? null : <SidebarProviderUpdatePill />}");
    const action = await source("../components/ProviderUpdatesAction.tsx");
    expect(action).toContain("if (T3MED || (machines.length === 0 && !isPending))");
  });

  it("never adds another machine's server to the app's update", async () => {
    const everything = await source("../components/sidebar/useUpdateEverything.ts");
    expect(everything).toContain(
      "collectServerUpdateTargets(T3MED ? [] : machines, targetVersion)",
    );
    // Unreachable with no server and no provider to add, and named T3 Med all the same.
    const dialog = await source("../components/sidebar/UpdateEverythingDialog.tsx");
    expect(dialog).not.toContain("T3 Code");
  });

  it("offers no update of a server, this machine's or another's", async () => {
    const banners = await source("../components/chat/useSystemComposerBanners.tsx");
    expect(banners).toContain("T3MED ? null : resolveServerConfigVersionMismatch(serverConfig)");
    expect(banners).toContain("if (autoBalanceUpdateBanner && !T3MED)");
    const connections = await source("../components/settings/ConnectionsSettings.tsx");
    expect(connections).toContain("if (T3MED) return null");
    const saved = await source("../components/settings/SavedEnvironmentRows.tsx");
    expect(saved).toContain("showUpdateAction && !T3MED");
  });

  it("does not put the `t3` command on PATH from the About page", async () => {
    const panels = await source("../components/settings/SettingsPanels.tsx");
    expect(panels).toContain("{hasDesktopBridge && !T3MED ? <CliCommandSettingsRow /> : null}");
  });
});
