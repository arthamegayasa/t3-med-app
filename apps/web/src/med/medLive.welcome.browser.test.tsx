/**
 * T3 Med: twins of two upstream cases in `WelcomePage.import.browser.test.tsx` that are skipped
 * for naming the project import. Everything down to `setup` is upstream's own harness, copied:
 * after a merge that changes it there, copy it again.
 */
/* oxlint-disable no-unused-vars -- the harness is copied whole, with helpers these cases do not use. */
import { RegistryContext } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type AgentSessionProjectCandidate,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentCloudLinkStateResult,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../test/render";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
type Project = { id: ProjectId; environmentId: EnvironmentId; workspaceRoot: string };
type CreateProjectInput = {
  environmentId: EnvironmentId;
  input: { projectId: ProjectId; workspaceRoot: string };
};
const state = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  projects: null as unknown,
  providers: null as unknown,
  config: null as unknown,
  candidates: null as unknown,
  createProject: vi.fn(),
  importThreads: vi.fn(),
  refreshProviders: vi.fn(),
  completeOnboarding: vi.fn(),
  onDone: vi.fn(),
  scan: vi.fn(),
  refreshScan: vi.fn(),
  waitForProject: vi.fn(),
  cloud: false,
  auth: { isLoaded: true, isSignedIn: false, userId: null as string | null },
  linkState: null as unknown,
  linkError: null as string | null,
  refreshLinkState: vi.fn(),
  scanError: null as string | null,
  scanPending: false,
  runningTerminalIds: null as unknown,
  openTerminal: vi.fn(),
  writeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id),
    })) as never,
  };
});
vi.mock(import("../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => state.cloud,
}));
vi.mock(import("@clerk/react"), async (original) => ({
  ...(await original()),
  useAuth: (() => state.auth) as never,
}));
vi.mock(import("../components/clerk/clerkLoadFailure"), async (original) => ({
  ...(await original()),
  useClerkLoadFailed: () => false,
}));
vi.mock(import("../components/clerk/useT3ConnectAuthPrompt"), async (original) => ({
  ...(await original()),
  useT3ConnectAuthPrompt: (() => ({ openAuthPrompt: () => {} })) as never,
}));
vi.mock(import("../cloud/cloudLinkState"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useCloudLinkState: (() => ({
      data: useAtomValue(state.linkState as Atom.Atom<EnvironmentCloudLinkStateResult | null>),
      error: state.linkError,
      isPending: false,
      refresh: state.refreshLinkState,
    })) as never,
  };
});
vi.mock(import("../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: state.completeOnboarding,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [{ environmentId: "primary", label: "primary" }],
  })) as never,
  usePrimaryEnvironmentId: (() => "primary") as never,
}));
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => state.providers) as never,
      configValueAtom: (() => state.config) as never,
      refreshProviders: "refreshProviders" as never,
    },
  };
});
vi.mock(import("../state/entities"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjects: (() => useAtomValue(state.projects as Atom.Atom<Project[]>)) as never,
    readProjects: (() => appAtomRegistry.get(state.projects as Atom.Atom<Project[]>)) as never,
    waitForProject: ((ref: unknown) => state.waitForProject(ref)) as never,
  };
});
vi.mock(import("../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "createProject" } as never,
}));
vi.mock(import("../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "importThreads" as never,
}));
vi.mock(import("../onboarding/useProjectScans"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjectScans: (ids: readonly EnvironmentId[]) => {
      const candidates = useAtomValue(
        state.candidates as Atom.Atom<AgentSessionProjectCandidate[]>,
      );
      return ids.map((environmentId) => {
        state.scan({ environmentId });
        return {
          environmentId,
          data: (state.scanPending ? null : { candidates, truncated: false }) as never,
          isPending: state.scanPending,
          error: state.scanError,
          refresh: state.refreshScan,
        };
      });
    },
  };
});
vi.mock(import("../state/terminal"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    terminalEnvironment: {
      ...actual.terminalEnvironment,
      open: "openTerminal",
      write: "writeTerminal",
      close: "closeTerminal",
    } as never,
  };
});
vi.mock(import("../state/terminalSessions"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useThreadRunningTerminalIds: (() =>
      useAtomValue(state.runningTerminalIds as Atom.Atom<ReadonlyArray<string>>)) as never,
  };
});
vi.mock(import("../components/ThreadTerminalDrawer"), async (original) => ({
  ...(await original()),
  TerminalViewport: () => <div />,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((
    command:
      | "createProject"
      | "importThreads"
      | "refreshProviders"
      | "openTerminal"
      | "writeTerminal"
      | "closeTerminal",
  ) => state[command]) as never,
}));

import { welcomeImportSelectionKey } from "../onboarding/welcomeState";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { toastManager } from "../components/ui/toast";
import { WelcomePage } from "../components/onboarding/WelcomePage";

const primaryId = EnvironmentId.make("primary");
const readyClaude: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const permissionMessage = "This connection cannot import projects or thread history.";

function session(scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState {
  return {
    authenticated: true,
    scopes: [AuthOrchestrationReadScope, ...scopes],
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token"],
      sessionCookieName: "t3_session",
    },
  };
}

function sessionAtom(environmentId: EnvironmentId) {
  return state.sessions.get(environmentId) as Atom.Writable<SessionResult>;
}

function projectsAtom() {
  return state.projects as Atom.Writable<ReadonlyArray<Project>>;
}

function candidatesAtom() {
  return state.candidates as Atom.Writable<ReadonlyArray<AgentSessionProjectCandidate>>;
}

function setGrant(environmentId: EnvironmentId, allowed: boolean) {
  appAtomRegistry.set(
    sessionAtom(environmentId),
    AsyncResult.success(session(allowed ? [AuthOrchestrationOperateScope] : [])),
  );
}

// Default selection only picks recently active projects, so pin "now".
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function candidate(
  path: string,
  overrides: Partial<AgentSessionProjectCandidate> = {},
): AgentSessionProjectCandidate {
  return {
    path,
    title: path.split("/").at(-1)!,
    sources: ["codex"],
    threadCount: 10,
    lastActiveAt: new Date(NOW - 60_000).toISOString(),
    alreadyImported: false,
    ...overrides,
  };
}

function recordProject({ environmentId, input }: CreateProjectInput) {
  appAtomRegistry.set(projectsAtom(), [
    ...appAtomRegistry.get(projectsAtom()),
    { id: input.projectId, environmentId, workspaceRoot: input.workspaceRoot },
  ]);
  return AsyncResult.success(undefined);
}

// Resolves once the project reaches the mocked projects atom; the real helper's timeout is
// replaced per test with a rejection.
function waitForRecordedProject(ref: { environmentId: EnvironmentId; projectId: string }) {
  const find = () =>
    appAtomRegistry
      .get(projectsAtom())
      .find(
        (project) => project.id === ref.projectId && project.environmentId === ref.environmentId,
      );
  return new Promise<Project>((resolve) => {
    const current = find();
    if (current) return resolve(current);
    const unsubscribe = appAtomRegistry.subscribe(projectsAtom(), () => {
      const project = find();
      if (!project) return;
      unsubscribe();
      resolve(project);
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pageText() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  const target = button(label);
  expect(target.disabled).toBe(false);
  await act(async () => target.click());
}

async function mountWelcome() {
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomePage environmentId={primaryId} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
}

// The mocked modules read `state`, so every test starts by replacing all of it.
// Returns the clock spy so each test can `using` it; the spy would otherwise outlive the test.
function setup() {
  const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
  state.sessions.clear();
  for (const id of [primaryId]) {
    state.sessions.set(
      id,
      Atom.make<SessionResult>(AsyncResult.success(session([AuthOrchestrationOperateScope]))).pipe(
        Atom.keepAlive,
      ),
    );
  }
  state.projects = Atom.make<ReadonlyArray<Project>>([]).pipe(Atom.keepAlive);
  state.providers = Atom.make<ReadonlyArray<ServerProvider>>([readyClaude]).pipe(Atom.keepAlive);
  state.config = Atom.make(null).pipe(Atom.keepAlive);
  state.candidates = Atom.make<ReadonlyArray<AgentSessionProjectCandidate>>([
    candidate("/projects/first"),
    candidate("/projects/second"),
  ]).pipe(Atom.keepAlive);
  state.createProject
    .mockReset()
    .mockImplementation(async (input: CreateProjectInput) => recordProject(input));
  state.importThreads
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ importedCount: 1, skippedCount: 0 }));
  state.refreshProviders.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.completeOnboarding.mockReset().mockResolvedValue(undefined);
  state.onDone.mockReset();
  state.scan.mockReset();
  state.refreshScan.mockReset();
  state.waitForProject.mockReset().mockImplementation(waitForRecordedProject);
  state.cloud = false;
  state.auth = { isLoaded: true, isSignedIn: false, userId: null };
  state.linkState = Atom.make<EnvironmentCloudLinkStateResult | null>(null).pipe(Atom.keepAlive);
  state.linkError = null;
  state.refreshLinkState.mockReset();
  state.scanError = null;
  state.scanPending = false;
  state.runningTerminalIds = Atom.make<ReadonlyArray<string>>([]).pipe(Atom.keepAlive);
  for (const command of [state.openTerminal, state.writeTerminal, state.closeTerminal]) {
    command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  }
  localStorage.removeItem(welcomeImportSelectionKey(primaryId));
  return now;
}

it("waits for a ready agent to start, and Start without an agent still finishes setup", async () => {
  using _now = setup();
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, []);
  await using _screen = await mountWelcome();
  // The first-run page sets up an agent and nothing else: no project is offered or imported.
  expect(pageText()).not.toMatch(/Import \d+ projects?/);
  expect(button("Start").disabled).toBe(true);

  await click("Start without an agent");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.importThreads).not.toHaveBeenCalled();
});

it("starts once an agent is ready, importing nothing", async () => {
  using _now = setup();
  await using _screen = await mountWelcome();
  await click("Start");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).not.toHaveBeenCalled();
});

it("says a signed-in agent's version is broken, offers no update, and keeps Start off", async () => {
  using _now = setup();
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
    {
      ...readyClaude,
      compatibilityAdvisory: {
        status: "broken",
        message: "Update Claude Code to 2.0 or later.",
        recommendedVersion: "2.0.0",
        recommendedRange: null,
      },
    },
  ]);
  await using _screen = await mountWelcome();
  // The warning is the reason Start is off, so it must be on the page.
  await vi.waitFor(() => expect(pageText()).toContain("Update Claude Code to 2.0 or later."));
  expect(button("Start").disabled).toBe(true);
  // No button here installs a provider's CLI.
  expect(
    [...document.querySelectorAll("button")].some((element) =>
      /^(Update now|Install 2\.0\.0)$/.test(element.textContent?.trim() ?? ""),
    ),
  ).toBe(false);
});
