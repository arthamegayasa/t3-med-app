import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "../hooks/useSettings";
import { useRightPanelStore } from "../rightPanelStore";
import {
  patientClientSettings,
  patientPanelMerge,
  patientProjectScope,
  resolveNewThreadEnvMode,
} from "./medStoredState";

describe("settings saved before their control was hidden", () => {
  afterEach(() => __resetClientSettingsPersistenceForTests());

  // What a browser that used T3 Code's own chrome may still hold.
  const stored = {
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: true,
    sidebarProjectGroupingMode: "separate",
    sidebarProjectSortOrder: "manual",
    persistComposerContextStrip: !DEFAULT_CLIENT_SETTINGS.persistComposerContextStrip,
    proactivePanelsEnabled: true,
    fontSizeTerminal: 20,
    // A setting whose row is still shown.
    chatWidth: "wide",
  } as typeof DEFAULT_CLIENT_SETTINGS;

  it("read as upstream's defaults wherever the app reads client settings", () => {
    __setClientSettingsForTests(stored);
    const read = getClientSettings();
    expect({
      boringSidebarEnabled: read.boringSidebarEnabled,
      sidebarProjectGroupingMode: read.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: read.sidebarProjectSortOrder,
      persistComposerContextStrip: read.persistComposerContextStrip,
      proactivePanelsEnabled: read.proactivePanelsEnabled,
      fontSizeTerminal: read.fontSizeTerminal,
    }).toEqual({
      boringSidebarEnabled: DEFAULT_CLIENT_SETTINGS.boringSidebarEnabled,
      sidebarProjectGroupingMode: DEFAULT_CLIENT_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_CLIENT_SETTINGS.sidebarProjectSortOrder,
      persistComposerContextStrip: DEFAULT_CLIENT_SETTINGS.persistComposerContextStrip,
      proactivePanelsEnabled: DEFAULT_CLIENT_SETTINGS.proactivePanelsEnabled,
      fontSizeTerminal: DEFAULT_CLIENT_SETTINGS.fontSizeTerminal,
    });
    // A setting the doctor can still change is the doctor's.
    expect(read.chatWidth).toBe("wide");
  });

  it("leave what is stored alone, and hand back one object per stored one", () => {
    const shown = patientClientSettings(stored);
    expect(stored.boringSidebarEnabled).toBe(true);
    expect(patientClientSettings(stored)).toBe(shown);
    // Nothing hidden was changed, so nothing is copied.
    expect(patientClientSettings(DEFAULT_CLIENT_SETTINGS)).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("filter the sidebar on no project and start no thread in a worktree", () => {
    expect(patientProjectScope({ sidebarProjectScopeKeys: ["env:project-a"] })).toEqual([]);
    expect(
      resolveNewThreadEnvMode({
        projectSettings: {
          settings: { defaultThreadEnvMode: "worktree" },
          sources: { defaultThreadEnvMode: "environment" },
        } as never,
        workspaceRoot: "D:/T3 Projects/T3 Med",
        newProjectsRoot: null,
        projectHasThreads: true,
      }),
    ).toBe("local");
  });
});

describe("right-panel tabs saved before their surface was hidden", () => {
  const current = { byThreadKey: {}, pendingMaximizeThreadKey: null };
  const saved = (
    surfaces: ReadonlyArray<{ id: string; kind: string }>,
    activeSurfaceId: string,
  ) => ({
    byThreadKey: { "env:thread-1": { isOpen: true, activeSurfaceId, surfaces } },
    threadPanelVisibilityByThreadKey: {},
  });

  it("are dropped when the panel's state is loaded, and the patient's tabs are kept", () => {
    const merged = patientPanelMerge(
      saved(
        [
          { id: "files", kind: "files" },
          { id: "diff", kind: "diff" },
          { id: "terminal:t1", kind: "terminal" },
          { id: "browser:b1", kind: "preview" },
          { id: "device", kind: "device" },
          { id: "pull-requests", kind: "pull-requests" },
          { id: "pull-request:1", kind: "pull-request" },
          { id: "med-labs", kind: "med-labs" },
          { id: "side-chat:s1", kind: "side-chat" },
          { id: "file:patient-files/lab.pdf", kind: "file" },
        ],
        "diff",
      ),
      current,
    );
    expect(merged).toEqual({
      byThreadKey: {
        "env:thread-1": {
          isOpen: true,
          // The open tab was the diff, so the last tab that stayed is shown.
          activeSurfaceId: "file:patient-files/lab.pdf",
          surfaces: [
            { id: "med-labs", kind: "med-labs" },
            { id: "side-chat:s1", kind: "side-chat" },
            { id: "file:patient-files/lab.pdf", kind: "file" },
          ],
        },
      },
      pendingMaximizeThreadKey: null,
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it("close a panel that held nothing else, and leave a patient's panel as it was", () => {
    const emptied = patientPanelMerge(
      saved([{ id: "terminal:t1", kind: "terminal" }], "terminal:t1"),
      current,
    );
    expect(emptied.byThreadKey).toEqual({
      "env:thread-1": { isOpen: false, activeSurfaceId: null, surfaces: [] },
    });
    const kept = saved([{ id: "med-plan", kind: "med-plan" }], "med-plan");
    expect(patientPanelMerge(kept, current).byThreadKey).toEqual(kept.byThreadKey);
    // Nothing saved, or something unreadable, leaves the store's own state.
    expect(patientPanelMerge(undefined, current)).toBe(current);
    expect(patientPanelMerge("broken", current)).toBe(current);
  });

  it("is how the panel's store loads what it saved", () => {
    expect(useRightPanelStore.persist.getOptions().merge).toBe(patientPanelMerge);
  });
});
