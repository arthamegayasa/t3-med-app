import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { STATIC_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getCommandPaletteInputPlaceholder } from "../components/CommandPalette.logic";
import { commandLabel } from "../components/settings/KeybindingsSettings.logic";
import {
  filterAvailableSettingsSearchItems,
  searchSettings,
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
} from "../components/settings/settingsSearch";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
} from "../components/threadActionMenu.logic";
import {
  hidesKeybindingCommand,
  hidesSettingsSection,
  hidesSettingsTarget,
  MED_UPSTREAM_NAMES,
  patientCheckout,
  patientComposerItems,
  patientKeybindingCommands,
  patientKeybindings,
  patientMenuItems,
  patientModelCapabilities,
  patientPaletteActions,
  patientPaletteProjects,
  patientProjectNames,
  patientRedirect,
  patientSettingsNavGroups,
  patientSettingsSearchItems,
  patientSettingText,
  patientWhenLabel,
  patientWording,
  readOnlyOrPatient,
  showsVersionNotice,
} from "./medHidden";

// Upstream's own source, as text: an id or a sentence T3 Med names must still be written there.
const upstreamSources = import.meta.glob<string>(
  [
    "../components/**/*.{ts,tsx}",
    "../../../server/src/provider/CodexProvider.ts",
    "../../../../packages/provider-core/src/server/snapshotProbe.ts",
    "!../**/*.test.{ts,tsx}",
  ],
  { query: "?raw", import: "default" },
);

async function source(path: string): Promise<string> {
  const load = upstreamSources[path];
  if (load === undefined) throw new Error(`${path} is not one of upstream's files any more.`);
  return load();
}

const settingsSources = async (): Promise<string> =>
  (
    await Promise.all(
      Object.keys(upstreamSources)
        .filter((path) => path.startsWith("../components/settings/"))
        .map(source),
    )
  ).join("\n");

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
      ["/settings/providers", "/settings/threads"],
      ["/settings/access"],
      ["/settings/maintenance", "/settings/labs", "/settings/about", "/settings/archived"],
    ]);
    // Upstream's "Labs" would read as the patient's labs.
    expect(SETTINGS_SECTION_LABELS["/settings/labs"]).toBe("Beta");
  });

  it("names only pages, rows and sections that upstream still has", async () => {
    const pages = new Set(Object.keys(SETTINGS_SECTION_LABELS));
    for (const path of MED_UPSTREAM_NAMES.settingsPaths) {
      expect(pages.has(path), path).toBe(true);
    }
    const searchIds = new Set(everySetting.flatMap((item) => [item.id, item.targetId]));
    for (const id of MED_UPSTREAM_NAMES.settingsSearchOnly) {
      expect(searchIds.has(id), id).toBe(true);
    }
    // A row or a section is hidden by its anchor: a search id, or an `id` written on the page.
    const pagesSource = await settingsSources();
    for (const id of MED_UPSTREAM_NAMES.settingsTargets) {
      expect(searchIds.has(id) || pagesSource.includes(`id="${id}"`), id).toBe(true);
      expect(hidesSettingsTarget(id), id).toBe(true);
    }
    const card = await source("../components/settings/ProviderInstanceCard.tsx");
    for (const title of MED_UPSTREAM_NAMES.settingsSectionTitles) {
      expect(card.includes(`title="${title}"`), title).toBe(true);
      // Only a section without an anchor is hidden by its title.
      expect(hidesSettingsSection(undefined, title), title).toBe(true);
      expect(hidesSettingsSection("some-other-section", title), title).toBe(false);
    }
    for (const id of Object.keys(MED_UPSTREAM_NAMES.rowText)) {
      expect(searchIds.has(id), id).toBe(true);
    }
    expect(hidesSettingsTarget("default-permissions")).toBe(false);
    expect(hidesSettingsTarget(undefined)).toBe(false);
    expect(hidesSettingsSection("authorized-clients", "Authorized clients")).toBe(false);
  });

  it("finds no setting of a hidden page, a hidden row or a hidden shortcut", () => {
    const found = patientSettingsSearchItems(everySetting);
    const pages = new Set<string>(found.map((item) => item.to));
    for (const page of MED_UPSTREAM_NAMES.settingsPaths) {
      expect(pages.has(page), page).toBe(false);
    }
    const ids = new Set(found.map((item) => item.id));
    for (const id of [
      ...MED_UPSTREAM_NAMES.settingsTargets,
      ...MED_UPSTREAM_NAMES.settingsSearchOnly,
      "keybinding-terminal.toggle",
      "keybinding-diff.toggle",
      "keybinding-composer.branch",
      "keybinding-threadPanel.toggle",
      // Found only through the hidden Diagnostics page.
      "telemetry-export",
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
      "keep-awake-while-agents-work",
      "continue-threads-after-server-update",
      "prompt-suggestions-beta",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe("Settings search in a patient workspace", () => {
  it("finds no row by a word for something that is not shown", () => {
    const shown = patientSettingsSearchItems(everySetting);
    // Upstream finds the code font and word wrap under "diffs", and fonts under "terminal".
    expect(searchSettings("diffs", everySetting).map((item) => item.id)).toContain("code-font");
    for (const query of ["diff", "diffs", "terminal", "worktree", "git"]) {
      expect(
        searchSettings(query, shown).map((item) => item.id),
        query,
      ).toEqual([]);
    }
    // The same rows are still found by what they are.
    expect(searchSettings("monospace", shown).map((item) => item.id)).toContain("code-font");
    expect(searchSettings("word wrap", shown)[0]?.id).toBe("word-wrap");
  });
});

describe("pages opened by their URL", () => {
  it("sends a hidden Settings page to Settings and any other hidden page to the patients", () => {
    for (const path of MED_UPSTREAM_NAMES.settingsPaths) {
      expect(patientRedirect(path), path).toBe("/settings/general");
    }
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
      "/settings/maintenance",
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
      "threadPanel.toggle",
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
    // Each name the list is made of is one upstream still has.
    const commands = new Set<string>(STATIC_KEYBINDING_COMMANDS);
    for (const command of MED_UPSTREAM_NAMES.keybindingCommands) {
      expect(commands.has(command), command).toBe(true);
    }
    for (const prefix of MED_UPSTREAM_NAMES.keybindingPrefixes.filter(
      (each) => each !== "script.",
    )) {
      expect(
        STATIC_KEYBINDING_COMMANDS.some((command) => command.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
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

  it("labels a condition without the terminal and the browser, which are never in focus", () => {
    expect(patientWhenLabel("!terminalFocus")).toBe("");
    expect(patientWhenLabel("!terminalFocus && !previewFocus")).toBe("");
    expect(patientWhenLabel("rightPanelOpen && !terminalFocus")).toBe("rightPanelOpen");
    expect(patientWhenLabel("")).toBe("");
    expect(patientWhenLabel("isDesktop")).toBe("isDesktop");
    // Not a plain list of terms: shown as written rather than half rewritten.
    expect(patientWhenLabel("(a || !terminalFocus) && b")).toBe("(a || !terminalFocus) && b");
    // Every kept default rule now reads as a condition a doctor can meet, or as none.
    const conditions = new Set(
      DEFAULT_KEYBINDINGS.flatMap((rule) =>
        "when" in rule && rule.when !== undefined ? rule.when.split("&&") : [],
      ).map((term) => term.trim()),
    );
    for (const term of ["!terminalFocus", "!previewFocus"]) {
      expect(MED_UPSTREAM_NAMES.neverTrueConditions.has(term), term).toBe(true);
      expect(conditions.has(term), term).toBe(true);
    }
    for (const rule of patientKeybindings(DEFAULT_KEYBINDINGS)) {
      const label = patientWhenLabel("when" in rule ? (rule.when ?? "") : "");
      expect(label, rule.command).not.toMatch(/terminal|preview/i);
    }
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

  // Upstream's own case also asserts Turn into project, which T3 Med hides; this is its twin.
  it("disables archive while the thread is running, as upstream does", () => {
    const items = buildThreadActionMenuItems({ ...state, isRunning: true });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")).toBeUndefined();
  });

  it("leaves a draft only its discard, since all it could copy was a path or a branch", () => {
    expect(
      buildDraftActionMenuItems({ hasPath: true, hasBranch: true, hasProject: true }).map(
        (item) => item.id,
      ),
    ).toEqual(["discard"]);
  });

  it("keeps a row it does not know, and names only rows upstream still writes", async () => {
    const items = [{ id: "something-new" }, { id: "project-settings" }];
    expect(patientMenuItems(items)).toEqual([{ id: "something-new" }]);
    const menus = await source("../components/threadActionMenu.logic.ts");
    for (const id of MED_UPSTREAM_NAMES.menuItems) {
      expect(menus.includes(`"${id}"`), id).toBe(true);
    }
  });
});

describe("the command palette", () => {
  it("decides on every action upstream's palette offers", async () => {
    const palette = await source("../components/CommandPalette.tsx");
    // Upstream's own action ids, read from where it writes them. One it adds lands in `kept`.
    const values = [...palette.matchAll(/value: "((?:action:|find-)[^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    const offered = [...new Set(values)].toSorted();
    const kept = patientPaletteActions(offered.map((value) => ({ value, title: value }))).map(
      (item) => item.value,
    );
    expect(kept).toEqual([
      "action:copy-thread-reference",
      "action:new-thread",
      "action:restart-agent-session",
      "action:settings",
      "action:usage",
      "find-current-thread",
    ]);
    expect(offered.filter((value) => !kept.includes(value))).toEqual([
      "action:add-project",
      "action:add-project:connect-environment",
      "action:add-project:wsl-folder",
      "action:copy-prompt-link",
      "action:copy-prompt-link-with-context",
      "action:link-pull-request",
      "action:new-project",
      "action:new-thread-in",
      "action:new-thread-without-project",
      "action:open-file-picker",
      "action:open-thread-pull-requests",
      "action:project-pin",
      "action:project-settings",
      "action:pull-requests",
      "action:search-project-contents",
      "action:share-thread-with-guest",
      "action:triage",
      "action:use-in-another-app",
      "find-in-browser-page",
    ]);
    // Each hidden id is one upstream still writes; a renamed one would come back unseen.
    for (const id of MED_UPSTREAM_NAMES.paletteActions) {
      expect(palette.includes(`"${id}"`), id).toBe(true);
    }
    for (const prefix of MED_UPSTREAM_NAMES.palettePrefixes) {
      expect(palette.includes(prefix), prefix).toBe(true);
    }
  });

  it("names no project in New thread, and finds none by search", () => {
    expect(
      patientPaletteActions([
        { value: "action:new-thread", title: "New thread in T3 Med", searchTitle: "T3 Med" },
      ]),
    ).toEqual([{ value: "action:new-thread", title: "New thread", searchTitle: "New thread" }]);
    expect(patientPaletteProjects([{ value: "project:t3-med" }])).toEqual([]);
    expect(getCommandPaletteInputPlaceholder("root")).toBe("Search commands and threads...");
  });
});

describe("the composer's menus", () => {
  const command = (name: string) => ({ type: "provider-slash-command", command: { name } });

  it("offer no file, machine or pull request, and of a provider's commands only two", () => {
    const items = [
      { type: "slash-command", command: "model" },
      { type: "slash-command", command: "clear" },
      command("compact"),
      command("clear"),
      // Codex's: one keeps working unasked, the other sends the thread to OpenAI.
      command("goal"),
      command("feedback"),
      // Whatever else a provider's CLI reports, a doctor's own commands included.
      command("review"),
      command("export"),
      { type: "skill" },
      { type: "path" },
      { type: "environment" },
      { type: "pull-request" },
      { type: "thread" },
      { type: "model" },
    ];
    expect(patientComposerItems(items)).toEqual([
      { type: "slash-command", command: "model" },
      { type: "slash-command", command: "clear" },
      command("compact"),
      command("clear"),
      { type: "skill" },
      { type: "thread" },
      { type: "model" },
    ]);
    expect(patientWording("No matching files or folders.")).toBe("No matching threads or models.");
  });

  it("keeps the two commands by the names providers give them", async () => {
    const provider = await source("../../../../packages/provider-core/src/server/snapshotProbe.ts");
    expect(provider.includes('name: "compact"')).toBe(true);
    expect([...MED_UPSTREAM_NAMES.keptProviderSlashCommands].toSorted()).toEqual([
      "clear",
      "compact",
    ]);
    // The two Codex commands that must not be offered are still Codex's.
    const codex = await source("../../../server/src/provider/CodexProvider.ts");
    for (const name of ["goal", "feedback"]) {
      expect(codex.includes(`name: "${name}"`), name).toBe(true);
    }
  });

  it("leaves Codex's security-research access tier out of the model's options", async () => {
    const capabilities = {
      optionDescriptors: [{ id: "reasoningEffort" }, { id: "cyberAccessProgram" }],
    };
    expect(patientModelCapabilities(capabilities)).toEqual({
      optionDescriptors: [{ id: "reasoningEffort" }],
    });
    const untouched = { optionDescriptors: [{ id: "reasoningEffort" }] };
    expect(patientModelCapabilities(untouched)).toBe(untouched);
    const codex = await source("../../../server/src/provider/CodexProvider.ts");
    for (const id of MED_UPSTREAM_NAMES.modelOptions) {
      expect(codex.includes(`id: "${id}"`), id).toBe(true);
    }
  });
});

describe("upstream's sentences that name what a patient workspace hides", () => {
  // Where upstream writes each sentence. One it rewords stops being replaced, and fails here.
  const writtenIn: Readonly<Record<string, string>> = {
    "Search commands, projects, and threads...": "../components/CommandPalette.logic.ts",
    "No matching commands, projects, or threads.": "../components/CommandPaletteResults.tsx",
    "Pull Request: Copy Link or Thread": "../components/settings/KeybindingsSettings.logic.ts",
    "Default model for new threads, selected automatically. Projects can override it.":
      "../components/settings/ProjectDefaultsSettings.tsx",
    "Default model for new threads. Projects can override it.":
      "../components/settings/ProjectDefaultsSettings.tsx",
    "Default permissions for new threads. Projects can override them.":
      "../components/settings/ProjectDefaultsSettings.tsx",
    "For thread titles and other generated text. Source control has its own setting. Text generators from Providers also appear here.":
      "../components/settings/SettingsPanels.tsx",
    "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.":
      "../components/settings/SettingsPanels.tsx",
    "Used by everyone who dictates on this environment.":
      "../components/settings/VoiceSettingsPanel.tsx",
    "Everything outside code blocks and the terminal.":
      "../components/settings/TypographySettings.tsx",
    "Code blocks, diffs, and file previews.": "../components/settings/TypographySettings.tsx",
    "Code blocks, diffs, file previews, and the terminal.":
      "../components/settings/TypographySettings.tsx",
    "Wrap long lines in code blocks, diffs, and file previews by default.":
      "../components/settings/TypographySettings.tsx",
    "Set the prompt, code, and terminal fonts separately instead of one monospace font.":
      "../components/settings/TypographySettings.tsx",
    "All environments": "../components/usage/UsagePage.tsx",
    "No matching files or folders.": "../components/chat/useComposerMenuItems.ts",
  };

  it("are each still written by upstream, and replaced by a sentence that names none of it", async () => {
    expect(Object.keys(writtenIn).toSorted()).toEqual(
      Object.keys(MED_UPSTREAM_NAMES.wording).toSorted(),
    );
    for (const [sentence, path] of Object.entries(writtenIn)) {
      expect((await source(path)).includes(`"${sentence}"`), sentence).toBe(true);
      const shown = patientWording(sentence);
      expect(shown, sentence).not.toBe(sentence);
      expect(shown, sentence).not.toMatch(
        /project|pull request|source control|terminal|diff|environment|files or folders/i,
      );
    }
    // A sentence that is not listed is upstream's own.
    expect(patientWording("Default model for new threads.")).toBe("Default model for new threads.");
  });

  it("reach the screen through the places that draw them", () => {
    expect(getCommandPaletteInputPlaceholder("root")).toBe("Search commands and threads...");
    // "copy link" still finds it in Settings search, as upstream's own test asks.
    expect(commandLabel("thread.copyReference")).toBe("Thread: Copy Link");
    // A Settings row's description, by its sentence or, where upstream writes markup, its row.
    expect(patientSettingText(undefined, "Code blocks, diffs, and file previews.")).toBe(
      "Code blocks and file previews.",
    );
    const markup = { type: "T" };
    expect(patientSettingText("working-shelf", markup)).toBe(
      "Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you.",
    );
    expect(patientSettingText("send-shortcut", markup)).toBe(markup);
    expect(patientSettingText("send-shortcut", "Enter sends.")).toBe("Enter sends.");
  });
});

describe("a provider's card", () => {
  it("warns that the installed CLI is not supported, and never offers to update it", () => {
    expect(showsVersionNotice(true)).toBe(true);
    // A notice that only says a newer version exists has nothing left to say.
    expect(showsVersionNotice(false)).toBe(false);
    expect(readOnlyOrPatient(false)).toBe(true);
    expect(readOnlyOrPatient(undefined)).toBe(true);
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
