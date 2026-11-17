/**
 * T3 Med: what a patient workspace leaves out of upstream's interface, decided here so each
 * upstream file asks once. With `T3MED` off every function returns upstream's own list. The ids
 * are upstream's: one it renames stops matching and its control comes back (`medHidden.test.ts`).
 */
import { T3MED } from "./t3med";

/** Where a hidden page sends the doctor instead. */
export const MED_HOME_PATH = "/patients" as const;
const MED_SETTINGS_HOME_PATH = "/settings/general";

// Whole Settings pages about code, other machines, devices and upstream's desktop extras.
const HIDDEN_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/diffs",
  "/settings/snap-shot",
  "/settings/browser",
  "/settings/devices",
  "/settings/projects",
  "/settings/source-control",
  "/settings/worktrees",
  "/settings/connections",
  // Prompts that run by themselves, and a machine's processes, logs and telemetry export.
  "/settings/scheduled-tasks",
  "/settings/diagnostics",
]);

// Search entries left out while the section they point at stays, for what else it holds.
const HIDDEN_SETTINGS_SEARCH_ONLY: ReadonlySet<string> = new Set([
  "project-defaults",
  "speech-project-dictionary",
  // Their rows are left out where `SettingsPanels.tsx` would render them.
  "update-track",
  "cli-command",
  // Sharing & access: their rows are left out where `ConnectionsSettings.tsx` would render them.
  "network-access",
  "tailscale-https",
  "t3-connect",
  "connect-device-approval",
  "hold-webhooks-while-offline",
  "publish-agent-activity",
  "environment-icon",
  // Maintenance: found under a section that is hidden by its own id.
  "storage-delete-now",
]);

// Single rows and sections of pages that stay, by the anchor id upstream's search gives them.
const HIDDEN_SETTINGS_TARGETS: ReadonlySet<string> = new Set([
  // General
  "project-grouping",
  "project-order",
  // Appearance
  "composer-context",
  // The thread details card is not drawn (`MedThreadDetailsPanel.tsx`).
  "thread-details-items",
  "environment-identification",
  "terminal-font",
  // Threads: the New projects section, and where a new thread's checkout starts
  "new-projects",
  "add-project-starts-in",
  "ghq-clone-layout",
  "new-threads",
  "auto-settle-merged-threads",
  "keep-threads-with-pull-requests",
  // Labs
  "boring-sidebar",
  "boring-sidebar-multiline",
  "linked-environments-beta",
  "simlock-hosts",
  "worktree-fast-checkout",
  // Beta (upstream's Labs): a guest link shows a patient chat to someone outside
  "guest-links",
  // Maintenance: only Keep awake and Continue threads after restarts stay
  "git-fetch-interval",
  "provider-update-checks",
  "background-activity",
  "storage-artifacts",
  "storage-cleanup",
  "storage-worktrees",
  "diagnostics-section",
  "diagnostics",
  // Providers: where usage is read from, and models that write commit messages
  "usage-providers",
  "text-generators",
  // Sharing & access
  "wsl-backend",
  "local-environment",
  // About: upstream's phone app, setup page and privacy policy
  "mobile-app",
  "welcome-page",
  "privacy-policy",
]);

const isHiddenSettingsPath = (pathname: string): boolean =>
  [...HIDDEN_SETTINGS_PATHS].some((path) => pathname === path || pathname.startsWith(`${path}/`));

/** Whether a Settings row or section with this anchor id is left out. */
export const hidesSettingsTarget = (id: string | undefined): boolean =>
  T3MED && id !== undefined && HIDDEN_SETTINGS_TARGETS.has(id);

// A provider's binary and home paths, launch arguments and environment variables. Upstream
// gives these sections a title and no id, and offers no "advanced" fold to put them behind.
const HIDDEN_SETTINGS_SECTION_TITLES: ReadonlySet<string> = new Set(["Runtime", "Environment"]);

/** Whether a Settings section is left out, by its anchor id or, lacking one, by its title. */
export const hidesSettingsSection = (id: string | undefined, title: string): boolean =>
  hidesSettingsTarget(id) ||
  (T3MED && id === undefined && HIDDEN_SETTINGS_SECTION_TITLES.has(title));

/** The Settings navigation without the hidden pages, and without a group they emptied. */
export function patientSettingsNavGroups<Group extends { readonly paths: ReadonlyArray<string> }>(
  groups: ReadonlyArray<Group>,
): ReadonlyArray<Group> {
  if (!T3MED) return groups;
  return groups.flatMap((group) => {
    const paths = group.paths.filter((path) => !isHiddenSettingsPath(path));
    return paths.length === 0 ? [] : [{ ...group, paths }];
  });
}

/** Settings search, in Settings and in the command palette, without what is hidden. */
export function patientSettingsSearchItems<
  Item extends { readonly id: string; readonly to: string; readonly targetId?: string },
>(items: ReadonlyArray<Item>): ReadonlyArray<Item> {
  if (!T3MED) return items;
  return items.filter(
    (item) =>
      !isHiddenSettingsPath(item.to) &&
      !HIDDEN_SETTINGS_TARGETS.has(item.id) &&
      !HIDDEN_SETTINGS_SEARCH_ONLY.has(item.id) &&
      !(item.targetId !== undefined && HIDDEN_SETTINGS_TARGETS.has(item.targetId)) &&
      !(
        item.id.startsWith(KEYBINDING_ANCHOR_PREFIX) &&
        hidesKeybindingCommand(item.id.slice(KEYBINDING_ANCHOR_PREFIX.length))
      ),
  );
}

// Pages outside Settings that are about code.
const HIDDEN_PAGE_PATHS: ReadonlyArray<string> = ["/pull-requests"];

/**
 * Where a hidden page opened by its URL goes instead, or null for a page that stays. A hidden
 * Settings page goes to Settings, any other to the patients.
 */
export function patientRedirect(pathname: string): string | null {
  if (!T3MED) return null;
  if (isHiddenSettingsPath(pathname)) return MED_SETTINGS_HOME_PATH;
  return HIDDEN_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    ? MED_HOME_PATH
    : null;
}

const KEYBINDING_ANCHOR_PREFIX = "keybinding-";

// Terminal, browser preview and project scripts have no place beside a patient.
const HIDDEN_KEYBINDING_PREFIXES: ReadonlyArray<string> = ["terminal.", "preview.", "script."];
const HIDDEN_KEYBINDING_COMMANDS: ReadonlySet<string> = new Set([
  "diff.toggle",
  "pullRequest.copyNumber",
  "filePicker.toggle",
  "projectSearch.toggle",
  "editor.openFavorite",
  "composer.host",
  "composer.cycleHost",
  "composer.workspace",
  "composer.previousWorktree",
  "composer.branch",
  "chat.newWithoutProject",
  // The thread details card is not drawn.
  "threadPanel.toggle",
]);

/** Whether a shortcut command belongs to a hidden control, so its keys must do nothing. */
export const hidesKeybindingCommand = (command: string): boolean =>
  T3MED &&
  (HIDDEN_KEYBINDING_COMMANDS.has(command) ||
    HIDDEN_KEYBINDING_PREFIXES.some((prefix) => command.startsWith(prefix)));

/**
 * Keybinding rules without those of hidden controls. Applied where the client reads the rules, so
 * a hidden command is never matched, never labelled and never listed. Returns the same array when
 * nothing is dropped, which keeps atoms and memoised rows stable.
 */
export function patientKeybindings<Rule extends { readonly command: string }>(
  rules: ReadonlyArray<Rule>,
): ReadonlyArray<Rule> {
  if (!T3MED) return rules;
  const kept = rules.filter((rule) => !hidesKeybindingCommand(rule.command));
  return kept.length === rules.length ? rules : kept;
}

/** The commands a new keybinding can be given, without the hidden ones. */
export const patientKeybindingCommands = <Command extends string>(
  commands: ReadonlyArray<Command>,
): ReadonlyArray<Command> =>
  T3MED ? commands.filter((command) => !hidesKeybindingCommand(command)) : commands;

// Rows of the thread and draft menus that are about a project, a branch or a folder.
const HIDDEN_MENU_ITEMS: ReadonlySet<string> = new Set([
  "new-thread-on-branch",
  "filter-by-project",
  "turn-into-project",
  "project-settings",
  "copy-path",
  "copy-branch",
]);

interface MenuItemLike {
  readonly id: string;
  readonly children?: ReadonlyArray<MenuItemLike> | undefined;
}

/**
 * A context menu without its project, branch and folder rows, at every depth. A submenu left
 * with nothing to choose is dropped with them.
 */
export function patientMenuItems<Item extends MenuItemLike>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  if (!T3MED) return items;
  return items.flatMap((item) => {
    if (HIDDEN_MENU_ITEMS.has(item.id)) return [];
    if (item.children === undefined) return [item];
    const children = patientMenuItems(item.children);
    return children.length === 0 ? [] : [{ ...item, children }];
  });
}

// Command palette actions for projects, files, pull requests and upstream's own support flows.
const HIDDEN_PALETTE_ACTIONS: ReadonlySet<string> = new Set([
  "action:new-thread-in",
  "action:new-thread-without-project",
  "action:triage",
  "action:copy-prompt-link",
  "action:copy-prompt-link-with-context",
  "action:link-pull-request",
  "action:open-thread-pull-requests",
  "action:open-file-picker",
  "action:search-project-contents",
  "action:new-project",
  "action:pull-requests",
  "action:use-in-another-app",
  "action:share-thread-with-guest",
  "action:project-pin",
  "action:project-settings",
  "find-in-browser-page",
]);
const HIDDEN_PALETTE_PREFIXES: ReadonlyArray<string> = ["action:add-project"];
/** Upstream names the project in this action's title; there is one project and it is not shown. */
const NEW_THREAD_ACTION = "action:new-thread";

/**
 * The command palette's actions without the coding ones. `New thread in <project>` reads
 * `New thread`.
 */
export function patientPaletteActions<
  Item extends { readonly value: string; readonly title?: unknown; readonly searchTitle?: string },
>(items: ReadonlyArray<Item>): ReadonlyArray<Item> {
  if (!T3MED) return items;
  return items.flatMap((item) => {
    if (
      HIDDEN_PALETTE_ACTIONS.has(item.value) ||
      HIDDEN_PALETTE_PREFIXES.some((prefix) => item.value.startsWith(prefix))
    ) {
      return [];
    }
    return item.value === NEW_THREAD_ACTION
      ? [{ ...item, title: "New thread", searchTitle: "New thread" }]
      : [item];
  });
}

/**
 * A provider card's version notice. An update is never offered, so a notice that only says a
 * newer CLI exists is left out; one that warns the installed CLI is not supported is shown.
 */
export const showsVersionNotice = (warnsOfCompatibility: boolean): boolean =>
  !T3MED || warnsOfCompatibility;

/** Whether the card's update button is off: as for a read-only session, and always here. */
export const readOnlyOrPatient = (readOnly: boolean | undefined): boolean =>
  T3MED || readOnly === true;

const NO_PALETTE_PROJECTS: ReadonlyArray<never> = [];

/** The projects the palette's search can find: none, so the workspace's name finds no group. */
export const patientPaletteProjects = <Item>(projects: ReadonlyArray<Item>): ReadonlyArray<Item> =>
  T3MED ? NO_PALETTE_PROJECTS : projects;

/** A thread as a sidebar row shows it: without its Git branch and worktree. */
export const patientCheckout = <
  Thread extends { readonly branch: string | null; readonly worktreePath: string | null },
>(
  thread: Thread,
): Thread => (T3MED ? { ...thread, branch: null, worktreePath: null } : thread);

/** A project's name beside a thread, which a workspace with one project never shows. */
export const patientProjectNames = <Names extends ReadonlyMap<string, string>>(
  names: Names,
): Names | ReadonlyMap<string, string> => (T3MED ? NO_PROJECT_NAMES : names);
const NO_PROJECT_NAMES: ReadonlyMap<string, string> = new Map();

// Upstream's sentences that name a project or a pull request where neither is shown.
const PATIENT_WORDING: Readonly<Record<string, string>> = {
  "Search commands, projects, and threads...": "Search commands and threads...",
  "No matching commands, projects, or threads.": "No matching commands or threads.",
  "Pull Request: Copy Link or Thread": "Thread: Copy Link",
  "Default model for new threads, selected automatically. Projects can override it.":
    "Default model for new threads, selected automatically.",
  "Default model for new threads. Projects can override it.": "Default model for new threads.",
  "Default permissions for new threads. Projects can override them.":
    "Default permissions for new threads.",
  // Settings rows that name Source control, other machines, the terminal or diffs.
  "For thread titles and other generated text. Source control has its own setting. Text generators from Providers also appear here.":
    "For thread titles and other generated text.",
  "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.":
    "Automatically resume interrupted threads after an update, crash, or machine restart.",
  "Used by everyone who dictates on this environment.":
    "Used by everyone who dictates on this computer.",
  "Everything outside code blocks and the terminal.": "Everything outside code blocks.",
  "Code blocks, diffs, and file previews.": "Code blocks and file previews.",
  "Code blocks, diffs, file previews, and the terminal.": "Code blocks and file previews.",
  "Wrap long lines in code blocks, diffs, and file previews by default.":
    "Wrap long lines in code blocks and file previews by default.",
  "Set the prompt, code, and terminal fonts separately instead of one monospace font.":
    "Set the prompt and code fonts separately instead of one monospace font.",
  // The Usage page's machine filter, and the composer's `@` menu without files.
  "All environments": "This computer",
  "No matching files or folders.": "No matching threads or models.",
};

// A row whose description upstream writes as markup, by the row's anchor id.
const PATIENT_ROW_TEXT: Readonly<Record<string, string>> = {
  "working-shelf":
    "Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you.",
};

/** Upstream's wording, or the patient workspace's for the few sentences that name a project. */
export const patientWording = (upstream: string): string =>
  T3MED ? (PATIENT_WORDING[upstream] ?? upstream) : upstream;

/** A Settings row's description as it is shown: `SettingsRow` passes every one through here. */
export function patientSettingText<Text>(id: string | undefined, upstream: Text): Text | string {
  if (!T3MED) return upstream;
  const byRow = id === undefined ? undefined : PATIENT_ROW_TEXT[id];
  if (byRow !== undefined) return byRow;
  return typeof upstream === "string" ? patientWording(upstream) : upstream;
}

// Conditions that are never true here: no terminal and no browser preview can take the focus.
const NEVER_TRUE_CONDITIONS: ReadonlySet<string> = new Set([
  "!terminalFocus",
  "!previewFocus",
  "!terminalOpen",
  "!previewOpen",
]);

/**
 * A shortcut's condition as Settings > Keybindings labels it, without the parts that only say
 * "not in the terminal" or "not in the browser". The rule itself is unchanged. An expression
 * that is not a plain list of `&&` terms is shown as it is.
 */
export function patientWhenLabel(expression: string): string {
  if (!T3MED || /[()|]/.test(expression)) return expression;
  return expression
    .split("&&")
    .map((term) => term.trim())
    .filter((term) => !NEVER_TRUE_CONDITIONS.has(term))
    .join(" && ");
}

// Provider commands a patient chat offers: only the two that manage the conversation itself.
// A provider's own list changes with its CLI and can send a thread elsewhere (`/feedback`).
const KEPT_PROVIDER_SLASH_COMMANDS: ReadonlySet<string> = new Set(["compact", "clear"]);

interface ComposerItemLike {
  readonly type: string;
  readonly command?: unknown;
}

const providerCommandName = (item: ComposerItemLike): string | null =>
  typeof item.command === "object" && item.command !== null && "name" in item.command
    ? String(item.command.name)
    : null;

/**
 * What the composer's `/`, `@` and `#` menus list: no workspace file or folder, no other
 * machine, no pull request, and of a provider's slash commands only the kept ones. Threads,
 * models, skills and the app's own commands stay.
 */
export function patientComposerItems<Item extends ComposerItemLike>(
  items: Array<Item>,
): Array<Item> {
  if (!T3MED) return items;
  return items.filter((item) => {
    if (item.type === "path" || item.type === "environment" || item.type === "pull-request") {
      return false;
    }
    if (item.type !== "provider-slash-command") return true;
    return KEPT_PROVIDER_SLASH_COMMANDS.has(providerCommandName(item) ?? "");
  });
}

// Codex's access tier for security research: no meaning beside a patient.
const HIDDEN_MODEL_OPTIONS: ReadonlySet<string> = new Set(["cyberAccessProgram"]);

/** A model's capabilities without the options a patient chat has no use for. */
export function patientModelCapabilities<
  Descriptor extends { readonly id: string },
  Capabilities extends { readonly optionDescriptors?: ReadonlyArray<Descriptor> | undefined },
>(capabilities: Capabilities): Capabilities {
  const descriptors = capabilities.optionDescriptors;
  if (!T3MED || descriptors === undefined) return capabilities;
  const kept = descriptors.filter((descriptor) => !HIDDEN_MODEL_OPTIONS.has(descriptor.id));
  return kept.length === descriptors.length
    ? capabilities
    : { ...capabilities, optionDescriptors: kept };
}

/**
 * Every name above that is upstream's own, for `medHidden.test.ts`: each is looked up in
 * upstream's lists or source, so one a merge renames fails there instead of coming back unseen.
 */
export const MED_UPSTREAM_NAMES = {
  settingsPaths: HIDDEN_SETTINGS_PATHS,
  settingsSearchOnly: HIDDEN_SETTINGS_SEARCH_ONLY,
  settingsTargets: HIDDEN_SETTINGS_TARGETS,
  settingsSectionTitles: HIDDEN_SETTINGS_SECTION_TITLES,
  pagePaths: HIDDEN_PAGE_PATHS,
  keybindingPrefixes: HIDDEN_KEYBINDING_PREFIXES,
  keybindingCommands: HIDDEN_KEYBINDING_COMMANDS,
  menuItems: HIDDEN_MENU_ITEMS,
  paletteActions: HIDDEN_PALETTE_ACTIONS,
  palettePrefixes: HIDDEN_PALETTE_PREFIXES,
  wording: PATIENT_WORDING,
  rowText: PATIENT_ROW_TEXT,
  neverTrueConditions: NEVER_TRUE_CONDITIONS,
  keptProviderSlashCommands: KEPT_PROVIDER_SLASH_COMMANDS,
  modelOptions: HIDDEN_MODEL_OPTIONS,
} as const;
