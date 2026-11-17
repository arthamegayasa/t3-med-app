/**
 * T3 Med: the upstream tests a patient workspace skips, each with its reason. Upstream's test
 * files are not edited; `medSkippedTests.setup.ts` applies this list. Only a test of a hidden
 * control belongs here: live behaviour passes, or has a twin in `medLiveBehaviour.browser.test.tsx`.
 */
import { T3MED } from "./t3med";

export interface MedSkippedTest {
  /** The test file, from `apps/web`. */
  readonly file: string;
  /**
   * The test's full name: its `describe` names and its own, joined by " > ". A `describe`'s name
   * alone skips every case under it. A pattern is for `it.each`, whose names carry their values.
   */
  readonly name: string | RegExp;
  readonly reason: string;
}

const NO_PROJECT_IN_SIDEBAR = "T3 Med's sidebar does not name the project this waits for.";
const NO_PROJECTS_ON_WELCOME = "T3 Med's welcome page has no Projects section.";
const NO_SCOPE_SENTENCE = "T3 Med hides the sentence that chooses a project and a machine.";
const NO_EDITOR_SHORTCUT = "T3 Med drops the open-in-editor shortcut.";

const SKIPPED: ReadonlyArray<MedSkippedTest> = [
  {
    file: "src/components/ChatView.browser.test.tsx",
    name: "a machine chip stashed in one thread restores with its machine in another",
    reason: "T3 Med has one machine and no machine chip; the stash itself has a fork-owned test.",
  },
  {
    file: "src/components/ChatView.browser.test.tsx",
    name: "a new draft does not load its reserved thread before the server lists it",
    reason: `${NO_PROJECT_IN_SIDEBAR} Fork-owned twin: medLiveBehaviour.browser.test.tsx.`,
  },
  {
    file: "src/components/ChatView.browser.test.tsx",
    name: "an interrupted image-only first send of a new thread says it may not have been sent",
    reason: `${NO_PROJECT_IN_SIDEBAR} Fork-owned twin: medLiveBehaviour.browser.test.tsx.`,
  },
  {
    file: "src/components/ChatView.browser.test.tsx",
    name: "a stashed prompt ending in a file chip restores with the chip",
    reason: `${NO_PROJECT_IN_SIDEBAR} Fork-owned twin: medLiveBehaviour.browser.test.tsx.`,
  },
  {
    file: "src/components/ChatView.browser.test.tsx",
    name: "a shortcut conditioned on rightPanelOpen sees the thread's open right panel",
    reason: "T3 Med's launcher has no Files row to open.",
  },
  {
    file: "src/components/CommandPalette.browser.test.tsx",
    name: "CommandPalette open intents > highlights the first project when New thread in... opens from the root list",
    reason: "T3 Med's palette has no New thread in....",
  },
  {
    file: "src/components/CommandPalette.browser.test.tsx",
    name: "CommandPalette open intents > opens a search intent with its query in the focused input",
    reason: "T3 Med's palette lists no project to find. Fork-owned twin: medLiveBehaviour.",
  },
  {
    file: "src/components/GitHubStarPrompt.test.ts",
    name: "recordPromptSent",
    reason: "T3 Med never asks a doctor to star upstream's repository.",
  },
  {
    file: "src/components/ProjectFavicon.browser.test.tsx",
    name: "only activates the favicon resource after removing a custom icon",
    reason: "T3 Med draws no project icon.",
  },
  {
    file: "src/components/chat/DraftHeroHeadline.browser.test.tsx",
    name: "the new-thread project picker follows the manual sidebar project order",
    reason: "T3 Med's draft hero asks which patient and has no project picker.",
  },
  {
    file: "src/components/chat/OpenInPicker.browser.test.tsx",
    name: "host editor access > uses the selected grant for both the button and a retained shortcut",
    reason: NO_EDITOR_SHORTCUT,
  },
  {
    file: "src/components/chat/OpenInPicker.browser.test.tsx",
    name: "open in editor announcement > speaks only after the shortcut opened the editor, from the picker or the fallback",
    reason: NO_EDITOR_SHORTCUT,
  },
  ...[
    "rechecks after project creation and can retry its history without recreating the project",
    "completes accepted imports when permission is revoked after the final server write",
    "finishes setup without landing when the imported project never reaches the client",
    "blocks leaving the page until the imported projects have landed",
    "gives projects a later scan finds the default, unless the main box was unchecked",
    "keeps the project choice across a visit to Settings until setup finishes",
    "stays busy while setup saves after an import with nothing to open",
    "leaves projects already in T3 Code out of the default import, unless the box is checked",
    "keeps the started projects checked when the page opens again after a quit",
    "keeps the project controls when a later scan fails",
  ].map((name) => ({
    file: "src/components/onboarding/WelcomePage.import.browser.test.tsx",
    name,
    reason: NO_PROJECTS_ON_WELCOME,
  })),
  {
    file: "src/components/onboarding/WelcomePage.import.browser.test.tsx",
    name: "waits for a ready agent to start, and Start without an agent still finishes setup",
    reason: `${NO_PROJECTS_ON_WELCOME} Fork-owned twin: medLiveBehaviour.browser.test.tsx.`,
  },
  {
    file: "src/components/onboarding/WelcomePage.import.browser.test.tsx",
    name: "offers Update for a signed-in agent whose version is broken, and keeps Start off",
    reason:
      "T3 Med offers no provider update button. Fork-owned twin: medLiveBehaviour.browser.test.tsx.",
  },
  {
    file: "src/components/onboarding/WelcomePage.import.browser.test.tsx",
    name: "says the phone is set up only once this computer is shared with the signed-in account",
    reason: "T3 Med's welcome page has no phone step.",
  },
  {
    file: "src/components/settings/KeybindingsSettings.browser.test.tsx",
    name: "re-enables Save when a When editor closes on an expression it could not parse",
    reason:
      "T3 Med lists no Terminal: Toggle shortcut. Fork-owned twin: medLiveBehaviour.browser.test.tsx.",
  },
  ...[
    "offers every environment while no project is selected",
    "offers only the selected project's checkout environments",
    "reaches each checkout on one environment and returns to all of them",
    "keeps an unknown project recoverable from any environment",
  ].map((name) => ({
    file: "src/components/settings/ProjectSettingsPanel.browser.test.tsx",
    name: `project settings scope > ${name}`,
    reason: NO_SCOPE_SENTENCE,
  })),
  {
    file: "src/components/settings/ProjectSettingsPanel.browser.test.tsx",
    name: /^project settings scope > recovers a stale environment link with checkout /,
    reason: NO_SCOPE_SENTENCE,
  },
  {
    file: "src/components/Sidebar.drag.browser.test.tsx",
    name: "shows the titled preview inside and outside search results from a collapsed folder",
    reason: "T3 Med's sidebar has no project folders: the folder sidebar cannot be on.",
  },
  {
    file: "src/components/settings/SettingsSidebarNav.composition.browser.test.tsx",
    name: "moves Tab through every settings section",
    reason:
      "T3 Med's Settings has no Code group and fewer pages. Fork-owned twin: medLiveBehaviour.browser.test.tsx.",
  },
  {
    file: "src/components/settings/SettingsSidebarNav.composition.browser.test.tsx",
    name: /^names each group by a heading outside it at \d+px wide$/,
    reason: "T3 Med's Settings has no Code group and fewer pages.",
  },
  {
    file: "src/components/settings/TypographySettings.browser.test.tsx",
    name: "TypographySection > persists the advanced flag the terminal reads when a deep link targets an advanced row",
    reason: "T3 Med has no Terminal font row.",
  },
];

/** Every skip, or none with the fork switch off: upstream's tests then run as upstream's. */
export const MED_SKIPPED_TESTS: ReadonlyArray<MedSkippedTest> = T3MED ? SKIPPED : [];

const normalise = (filepath: string): string => filepath.replaceAll("\\", "/");

/** The entries of one test file, by its absolute or relative path. */
export function skippedTestsOfFile(
  filepath: string,
  list: ReadonlyArray<MedSkippedTest> = MED_SKIPPED_TESTS,
): ReadonlyArray<MedSkippedTest> {
  const path = normalise(filepath);
  return list.filter((entry) => path === entry.file || path.endsWith(`/${entry.file}`));
}

const matches = (entry: MedSkippedTest, fullTestName: string): boolean =>
  typeof entry.name === "string"
    ? fullTestName === entry.name || fullTestName.startsWith(`${entry.name} > `)
    : entry.name.test(fullTestName);

/** Why a test is skipped, or undefined for a test that runs. */
export const skipReasonOf = (
  entries: ReadonlyArray<MedSkippedTest>,
  fullTestName: string,
): string | undefined => entries.find((entry) => matches(entry, fullTestName))?.reason;

/** The entries that name no test of their file: upstream renamed or removed the case. */
export const staleSkips = (
  entries: ReadonlyArray<MedSkippedTest>,
  fullTestNames: ReadonlyArray<string>,
): ReadonlyArray<MedSkippedTest> =>
  entries.filter((entry) => !fullTestNames.some((name) => matches(entry, name)));
