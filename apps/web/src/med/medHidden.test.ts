import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { STATIC_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getCommandPaletteInputPlaceholder } from "../components/CommandPalette.logic";
import { commandLabel } from "../components/settings/KeybindingsSettings.logic";
import {
  filterAvailableSettingsSearchItems,
  SETTINGS_NAV_GROUPS,
} from "../components/settings/settingsSearch";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
} from "../components/threadActionMenu.logic";
import {
  hidesKeybindingCommand,
  hidesSettingsTarget,
  patientCheckout,
  patientKeybindingCommands,
  patientKeybindings,
  patientMenuItems,
  patientPaletteActions,
  patientProjectNames,
  patientRedirect,
  patientSettingsNavGroups,
  patientSettingsSearchItems,
} from "./medHidden";

// Everything upstream could offer, so a row it adds shows up in these lists to be decided on.
const everySetting = filterAvailableSettingsSearchItems({
  hasCloudPublicConfig: true,
  hasEnvironment: true,
  hasProviderSettingsEnvironment: true,
  canManageLocalBackend: true,
  isWslSettingsRowVisible: true,
  hasThreadAutoSettlement: true,
  managedTunnelActive: true,
  hasPeerLinkHost: true,
  hasFastWorktreeCheckoutEnvironment: true,
  hasTextGeneratorsEnvironment: true,
  hasPrimaryEnvironment: true,
});

describe("Settings in a patient workspace", () => {
  it("lists the pages a doctor uses, and drops the Code group whole", () => {
    expect(patientSettingsNavGroups(SETTINGS_NAV_GROUPS).map((group) => group.paths)).toEqual([
      [
        "/settings/general",
        "/settings/appearance",
        "/settings/chat",
        "/settings/keybindings",
        "/settings/voice",
      ],
      ["/settings/providers", "/settings/threads", "/settings/scheduled-tasks"],
      ["/settings/access"],
      ["/settings/maintenance", "/settings/labs", "/settings/about", "/settings/archived"],
    ]);
  });

  it("finds no setting of a hidden page, a hidden row or a hidden shortcut", () => {
    const found = patientSettingsSearchItems(everySetting);
    const pages = new Set(found.map((item) => item.to));
    for (const page of [
      "/settings/diffs",
      "/settings/snap-shot",
      "/settings/browser",
      "/settings/devices",
      "/settings/projects",
      "/settings/source-control",
      "/settings/worktrees",
      "/settings/connections",
    ]) {
      expect(pages.has(page as never), page).toBe(false);
    }
    const ids = new Set(found.map((item) => item.id));
    for (const id of [
      "project-grouping",
      "project-order",
      "project-defaults",
      "new-threads",
      "add-project-starts-in",
      "auto-settle-merged-threads",
      // Points at a row that stays, and is about pull requests.
      "keep-threads-with-pull-requests",
      "boring-sidebar",
      "boring-sidebar-multiline",
      "linked-environments-beta",
      "simlock-hosts",
      "git-fetch-interval",
      "wsl-backend",
      "update-track",
      "cli-command",
      "mobile-app",
      "welcome-page",
      "keybinding-terminal.toggle",
      "keybinding-diff.toggle",
      "keybinding-composer.branch",
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
    // What a doctor does look for is still found.
    for (const id of [
      "default-model",
      "default-permissions",
      "providers",
      "theme",
      "keybindings",
      "keybinding-chat.new",
      "archive",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("hides a row by the anchor id upstream gives it", () => {
    // Each id must still be one of upstream's, or the row it named is back on the page.
    const upstreamIds = new Set(everySetting.flatMap((item) => [item.id, item.targetId]));
    for (const id of [
      "project-grouping",
      "project-order",
      "composer-context",
      "environment-identification",
      "terminal-font",
      "new-threads",
      "add-project-starts-in",
      "ghq-clone-layout",
      "auto-settle-merged-threads",
      "boring-sidebar",
      "linked-environments-beta",
      "simlock-hosts",
      "worktree-fast-checkout",
      "wsl-backend",
      "local-environment",
      "update-track",
      "cli-command",
      "mobile-app",
      "welcome-page",
      "privacy-policy",
    ]) {
      expect(upstreamIds.has(id), id).toBe(true);
      expect(hidesSettingsTarget(id), id).toBe(true);
    }
    expect(hidesSettingsTarget("default-permissions")).toBe(false);
    expect(hidesSettingsTarget(undefined)).toBe(false);
  });
});

describe("pages opened by their URL", () => {
  it("sends a hidden Settings page to Settings and any other hidden page to the patients", () => {
    expect(patientRedirect("/settings/source-control")).toBe("/settings/general");
    expect(patientRedirect("/settings/projects")).toBe("/settings/general");
    expect(patientRedirect("/settings/connections")).toBe("/settings/general");
    expect(patientRedirect("/pull-requests")).toBe("/patients");
    expect(patientRedirect("/pull-requests/anything")).toBe("/patients");
  });

  it("leaves the pages that stay alone", () => {
    for (const pathname of [
      "/",
      "/patients",
      "/inbox",
      "/usage",
      "/settings/general",
      "/settings/providers",
      "/settings/keybindings",
      // A prefix of a hidden path is not that path.
      "/settings/diffsomething",
      "/pull-requests-archive",
    ]) {
      expect(patientRedirect(pathname), pathname).toBeNull();
    }
  });
});

describe("keyboard shortcuts of hidden controls", () => {
  it("decides on every command upstream defines", () => {
    // Upstream's own list, split. A command it adds lands in the kept half and fails this.
    expect(STATIC_KEYBINDING_COMMANDS.filter(hidesKeybindingCommand)).toEqual([
      "terminal.toggle",
      "terminal.split",
      "terminal.splitVertical",
      "terminal.new",
      "terminal.close",
      "pullRequest.copyNumber",
      "diff.toggle",
      "preview.toggle",
      "preview.refresh",
      "preview.focusUrl",
      "preview.zoomIn",
      "preview.zoomOut",
      "preview.resetZoom",
      "preview.find",
      "filePicker.toggle",
      "projectSearch.toggle",
      "composer.host",
      "composer.cycleHost",
      "composer.workspace",
      "composer.previousWorktree",
      "composer.branch",
      "chat.newWithoutProject",
      "editor.openFavorite",
    ]);
    expect(
      patientKeybindingCommands(STATIC_KEYBINDING_COMMANDS).filter(
        (command) => !/^(thread|modelPicker)\.jump\.\d$/.test(command),
      ),
    ).toEqual([
      "workspace.focusNext",
      "workspace.focusPrevious",
      "sidebar.toggle",
      "navigation.back",
      "navigation.forward",
      "rightPanel.toggle",
      "rightPanel.new",
      "threadPanel.toggle",
      "rightPanel.toggleMaximized",
      "rightPanel.close",
      "view.reopenClosed",
      "commandPalette.toggle",
      "usage.open",
      "theme.select",
      "appearance.cycle",
      "themeEditor.toggle",
      "composer.stash",
      "composer.sendAlternate",
      "composer.sendBackground",
      "composer.sendAndNewThread",
      "composer.dictation",
      "composer.effort",
      "composer.increaseEffort",
      "composer.decreaseEffort",
      "composer.mode",
      "chat.new",
      "chat.newLocal",
      "chat.find",
      "usage.cost",
      "usage.tokens",
      "usage.limits",
      "usage.period.day",
      "usage.period.week",
      "usage.period.month",
      "usage.period.quarter",
      "modelPicker.toggle",
      "modelPicker.previousProvider",
      "modelPicker.nextProvider",
      "thread.stop",
      "thread.steerQueuedMessage",
      "thread.editQueuedMessage",
      "thread.previous",
      "thread.next",
      "thread.copyReference",
      "thread.settle",
      "thread.pin",
      "thread.regenerateTitle",
      "thread.undo",
    ]);
  });

  it("drops their rules, a project script's included, so the keys match nothing", () => {
    const rules = [
      ...DEFAULT_KEYBINDINGS,
      { key: "mod+alt+r", command: "script.dev-server.run" },
    ] as const;
    const kept = patientKeybindings(rules);
    expect(kept.some((rule) => hidesKeybindingCommand(rule.command))).toBe(false);
    // Upstream binds the terminal, the diff and the file picker by default.
    for (const command of ["terminal.toggle", "diff.toggle", "filePicker.toggle"]) {
      expect(
        DEFAULT_KEYBINDINGS.some((rule) => rule.command === command),
        command,
      ).toBe(true);
    }
    expect(kept.map((rule) => rule.command)).toContain("chat.new");
    expect(kept.map((rule) => rule.command)).toContain("rightPanel.toggle");
    expect(kept).toHaveLength(
      DEFAULT_KEYBINDINGS.filter((rule) => !hidesKeybindingCommand(rule.command)).length,
    );
  });

  it("returns the same rules when none is hidden, so nothing recomputes", () => {
    const rules = [{ command: "chat.new" }, { command: "thread.settle" }];
    expect(patientKeybindings(rules)).toBe(rules);
  });

  it("names the copy shortcut after the thread, not a pull request", () => {
    expect(commandLabel("thread.copyReference")).toBe("Thread: Copy");
  });
});

describe("menus of a thread and a draft", () => {
  const state = {
    canOperate: true,
    canFind: true,
    branch: "main",
    projectFilter: { label: "T3 Med", isActive: false },
    isPinned: false,
    isSettled: false,
    autoSettleEnabled: true,
    isSnoozed: false,
    canSnoozeNow: true,
    isRegeneratingTitle: false,
    isRunning: false,
    supports: {
      settlement: true,
      autoSettleOptOut: true,
      snooze: true,
      pinning: true,
      titleRegeneration: true,
    },
    snoozePresets: [],
    canShareWithGuest: false,
    canTurnIntoProject: true,
  };

  it("offers a thread's own actions and nothing about its project, branch or folder", () => {
    const items = buildThreadActionMenuItems(state);
    expect(items.map((item) => item.id)).toEqual([
      "find",
      "pin",
      "settle",
      "snooze",
      "rename",
      "regenerate-title",
      "mark-unread",
      "auto-settle",
      "copy",
      "archive",
      "delete",
    ]);
    expect(items.find((item) => item.id === "copy")?.children?.map((child) => child.id)).toEqual([
      "copy-thread",
      "copy-thread-id",
    ]);
  });

  it("leaves a draft only its discard, since all it could copy was a path or a branch", () => {
    expect(
      buildDraftActionMenuItems({ hasPath: true, hasBranch: true, hasProject: true }).map(
        (item) => item.id,
      ),
    ).toEqual(["discard"]);
  });

  it("keeps a row it does not know", () => {
    const items = [{ id: "something-new" }, { id: "project-settings" }];
    expect(patientMenuItems(items)).toEqual([{ id: "something-new" }]);
  });
});

describe("the command palette", () => {
  const action = (value: string, title = value) => ({ value, title, searchTitle: title });

  it("drops the coding actions and names no project in New thread", () => {
    const actions = patientPaletteActions([
      action("action:new-thread", "New thread in T3 Med"),
      action("action:new-thread-in"),
      action("action:new-thread-without-project"),
      action("action:triage"),
      action("find-current-thread"),
      action("find-in-browser-page"),
      action("action:copy-prompt-link"),
      action("action:copy-thread-reference"),
      action("action:link-pull-request"),
      action("action:open-thread-pull-requests"),
      action("action:restart-agent-session"),
      action("action:open-file-picker"),
      action("action:search-project-contents"),
      action("action:new-project"),
      action("action:add-project"),
      action("action:add-project:wsl-folder"),
      action("action:pull-requests"),
      action("action:use-in-another-app"),
      action("action:usage"),
      action("action:settings"),
      action("action:project-pin"),
      action("action:project-settings"),
    ]);
    expect(actions.map((entry) => [entry.value, entry.title, entry.searchTitle])).toEqual([
      ["action:new-thread", "New thread", "New thread"],
      ["find-current-thread", "find-current-thread", "find-current-thread"],
      [
        "action:copy-thread-reference",
        "action:copy-thread-reference",
        "action:copy-thread-reference",
      ],
      [
        "action:restart-agent-session",
        "action:restart-agent-session",
        "action:restart-agent-session",
      ],
      ["action:usage", "action:usage", "action:usage"],
      ["action:settings", "action:settings", "action:settings"],
    ]);
  });

  it("asks for commands and threads, not projects", () => {
    expect(getCommandPaletteInputPlaceholder("root")).toBe("Search commands and threads...");
  });
});

describe("a thread in the sidebar", () => {
  it("is not shown with its project, its branch or its worktree", () => {
    expect(patientProjectNames(new Map([["env:project", "T3 Med"]])).size).toBe(0);
    // The patient workspace is a Git repository, so every thread has a branch.
    expect(patientCheckout({ id: "t1", branch: "main", worktreePath: "D:/wt/t1" })).toEqual({
      id: "t1",
      branch: null,
      worktreePath: null,
    });
  });
});
