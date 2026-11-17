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
]);

// Search entries left out while the section they point at stays, for what else it holds.
const HIDDEN_SETTINGS_SEARCH_ONLY: ReadonlySet<string> = new Set([
  "project-defaults",
  "speech-project-dictionary",
  // Their rows are left out where `SettingsPanels.tsx` would render them.
  "update-track",
  "cli-command",
]);

// Single rows and sections of pages that stay, by the anchor id upstream's search gives them.
const HIDDEN_SETTINGS_TARGETS: ReadonlySet<string> = new Set([
  // General
  "project-grouping",
  "project-order",
  // Appearance
  "composer-context",
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
  // Maintenance
  "git-fetch-interval",
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
  "Pull Request: Copy Link or Thread": "Thread: Copy",
  "Default model for new threads, selected automatically. Projects can override it.":
    "Default model for new threads, selected automatically.",
  "Default model for new threads. Projects can override it.": "Default model for new threads.",
  "Default permissions for new threads. Projects can override them.":
    "Default permissions for new threads.",
};

/** Upstream's wording, or the patient workspace's for the few sentences that name a project. */
export const patientWording = (upstream: string): string =>
  T3MED ? (PATIENT_WORDING[upstream] ?? upstream) : upstream;
