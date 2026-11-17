import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type {
  MedLab,
  MedPatientHome,
  MedPatientRecord,
  MedWaitingNote,
} from "@t3tools/contracts/med";
// Dialogs are laid out by the stylesheet: without it a modal's own backdrop covers its buttons.
import "~/index.css";

import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SidebarProvider } from "../components/ui/sidebar";
import { ToastProvider } from "../components/ui/toast";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import type { Project } from "../types";

const PRIMARY = EnvironmentId.make("primary");
const OTHER = EnvironmentId.make("other-machine");

// What the mocked modules read. `setup` resets it at the top of every test.
const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as string | null,
  mayRead: false,
  mayChange: false,
  projects: [] as ReadonlyArray<unknown>,
  threadTitles: {} as Record<string, string>,
  routeThreadRef: null as unknown,
  responses: {} as Record<string, unknown>,
  requests: [] as Array<string>,
  // What a change is answered with, by method and path; a list is used up one answer a call.
  writes: {} as Record<string, unknown>,
  sent: [] as Array<readonly [string, unknown]>,
  openDraft: (..._args: ReadonlyArray<unknown>): Promise<null> => Promise.resolve(null),
}));

vi.mock(import("../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePrimaryEnvironmentId: () => state.primaryEnvironmentId as never,
}));
vi.mock(import("../state/session"), async (importOriginal) => {
  const { AuthOrchestrationOperateScope } = await import("@t3tools/contracts");
  return {
    ...(await importOriginal()),
    useEnvironmentScope: (environmentId, scope) =>
      environmentId !== null &&
      (scope === AuthOrchestrationOperateScope ? state.mayChange : state.mayRead),
  };
});
vi.mock(import("../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () => state.projects as never,
  useQuietThreadShell: (ref) =>
    (ref !== null && ref.threadId in state.threadTitles
      ? { title: state.threadTitles[ref.threadId] }
      : null) as never,
}));
vi.mock(import("../hooks/useThreadRouteTarget"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadRouteRef: () => state.routeThreadRef as never,
}));
vi.mock(import("../hooks/useHandleNewThread"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNewThreadHandler: () =>
    ((...args: ReadonlyArray<unknown>) => state.openDraft(...args)) as never,
}));
// The patient queries' own HTTP client, answering from `state.responses` and recording each call.
vi.mock(import("../environments/primary/httpLayer"), async (importOriginal) => {
  const { layerRemoteHttpClient } = await import("@t3tools/client-runtime/rpc");
  return {
    ...(await importOriginal()),
    layer: layerRemoteHttpClient(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      state.requests.push(`${request.method} ${path}`);
      if (request.method !== "GET") {
        const key = `${request.method} ${path}`;
        const body = await request.text();
        state.sent.push([key, body === "" ? null : JSON.parse(body)]);
        const planned = state.writes[key];
        const answer = (Array.isArray(planned) ? planned.shift() : planned) as
          | { readonly status?: number; readonly body: unknown }
          | undefined;
        return answer === undefined
          ? Response.json({ _tag: "MedRowNotFoundError", row: "lab", id: path }, { status: 404 })
          : Response.json(answer.body, { status: answer.status ?? 200 });
      }
      if (!(path in state.responses)) {
        return Response.json({ _tag: "MedPatientNotFoundError", patientId: path }, { status: 404 });
      }
      // A promise stands for an answer that is still on its way.
      return Response.json(await state.responses[path]);
    }) as never,
  };
});

import { RightPanelTabs } from "../components/RightPanelTabs";
import { SidebarSearchResultRow } from "../components/sidebar/SidebarThreadRow";
import { makeThreadFixture } from "../test-fixtures";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { refreshMedData } from "./medData";
import { MedSidebarNav } from "./MedSidebarNav";
import { MedSurfaceContent } from "./MedSurfaceContent";
import { NeedsYouPage } from "./NeedsYouPage";
import { useMedSurfaceActions } from "./MedSurfaceLauncher";
import { medSurface } from "./medSurfaces";
import { MedThreadPatientCrumb } from "./MedThreadPatientCrumb";
import { PatientHomePage } from "./PatientHomePage";

function setup(input: {
  readonly primaryEnvironmentId: string | null;
  readonly mayRead: boolean;
  /** Whether the session may change patient data too; as `mayRead` when left out. */
  readonly mayChange?: boolean;
  readonly responses?: Record<string, unknown>;
  readonly writes?: Record<string, unknown>;
  readonly projects?: ReadonlyArray<Project>;
  readonly threadTitles?: Record<string, string>;
  readonly routeThreadRef?: ScopedThreadRef | null;
}) {
  const openDraft = vi.fn((..._args: ReadonlyArray<unknown>) => Promise.resolve(null));
  Object.assign(state, {
    primaryEnvironmentId: input.primaryEnvironmentId,
    mayRead: input.mayRead,
    mayChange: input.mayChange ?? input.mayRead,
    projects: input.projects ?? [],
    threadTitles: input.threadTitles ?? {},
    routeThreadRef: input.routeThreadRef ?? null,
    responses: input.responses ?? {},
    requests: [],
    writes: input.writes ?? {},
    sent: [],
    openDraft,
  });
  // The queries outlive a test, so what an earlier one loaded must not answer for this one.
  refreshMedData();
  return { openDraft };
}

function project(id: string, environmentId: EnvironmentId): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

function home(id: string, urn: string | null, more: Partial<MedPatientHome> = {}): MedPatientHome {
  return {
    patient: {
      id,
      name: "Ni Made Suartini",
      urn,
      status: "active",
      alsoWrittenAs: [],
      lastChatAt: null,
      sex: "female",
      dateOfBirth: "1970-01-01",
    },
    notes: [],
    threads: [],
    draftLabs: 0,
    draftPlans: 0,
    upcomingPlans: [],
    ...more,
  };
}

// The app's own atom registry, as `AppRoot` provides it: `refreshMedData` writes to that one.
function inApp(children: ReactNode) {
  return (
    <AppAtomRegistryProvider>
      <ToastProvider timeout={0}>
        <SidebarProvider>{children}</SidebarProvider>
      </ToastProvider>
    </AppAtomRegistryProvider>
  );
}

const sidebarAndHeader = inApp(
  <>
    <MedSidebarNav />
    <ol>
      <MedThreadPatientCrumb environmentId={PRIMARY} threadId="thread-here" />
      <MedThreadPatientCrumb environmentId={OTHER} threadId="thread-elsewhere" />
    </ol>
  </>,
);

it.each([
  { name: "there is no primary environment", primaryEnvironmentId: null, mayRead: true },
  { name: "the session may not read it", primaryEnvironmentId: PRIMARY, mayRead: false },
])("asks the server for no patient data while $name", async ({ primaryEnvironmentId, mayRead }) => {
  setup({ primaryEnvironmentId, mayRead });
  await using screen = await render(sidebarAndHeader);

  await expect.element(screen.getByRole("link", { name: "Needs you" })).toBeVisible();
  expect(state.requests).toEqual([]);
});

it("reads the counts and a thread's patient in the primary environment only", async () => {
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/counts": { inbox: 2, patients: 14, needsYou: 3, upcoming: 5 },
      "/api/med/threads/thread-here/patient": { patient: { id: "p1", name: "Ni Made Suartini" } },
      "/api/med/threads/thread-elsewhere/patient": { patient: { id: "p2", name: "Wrong" } },
    },
  });
  await using screen = await render(sidebarAndHeader);

  await expect.element(screen.getByRole("link", { name: /^Patients\s*14$/ })).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open patient Ni Made Suartini" }))
    .toBeVisible();
  // A thread of another machine has the same kind of id; it is not asked about and shows no one.
  expect(state.requests.toSorted()).toEqual([
    "GET /api/med/counts",
    "GET /api/med/threads/thread-here/patient",
  ]);
  await expect.element(screen.getByText("Wrong")).not.toBeInTheDocument();
});

it("starts a chat that names the patient by URN, and links nothing", async () => {
  const { openDraft } = setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    projects: [project("elsewhere", OTHER), project("clinic", PRIMARY)],
    threadTitles: { "thread-quiet": "Asked about the MRI" },
    responses: {
      "/api/med/patients/p-urn": home("p-urn", "00-12-34-56", {
        notes: [
          {
            id: "note-1",
            threadId: "thread-filed",
            title: "Labs 6 Nov",
            date: "2026-11-06",
            summary: "LDL saved as a draft",
            needsYou: "",
            needsYouHandledAt: null,
            draftLabs: 0,
            draftPlans: 0,
            draftLabRows: [],
            draftPlanRows: [],
          },
        ],
        threads: [
          { threadId: "thread-quiet", linkedAt: "2026-11-09T02:00:00.000Z" },
          { threadId: "thread-filed", linkedAt: "2026-11-06T02:00:00.000Z" },
        ],
      }),
    },
  });
  await using screen = await render(inApp(<PatientHomePage patientId="p-urn" />));

  // A chat in which nothing was filed is listed too, under the title the thread list gives it.
  const chats = screen.getByRole("list", { name: "Earlier chats" }).getByRole("link");
  await expect.element(chats.first()).toBeVisible();
  expect(chats.elements().map((chat) => chat.textContent)).toEqual([
    expect.stringMatching(/^Asked about the MRINothing filed/),
    expect.stringMatching(/^Labs 6 NovLDL saved as a draft/),
  ]);

  await screen.getByRole("button", { name: "New chat" }).click();

  // The chat starts in the primary environment, where the patient's data is.
  expect(openDraft).toHaveBeenCalledExactlyOnceWith(
    { environmentId: PRIMARY, projectId: ProjectId.make("clinic") },
    { prompt: "URN 00-12-34-56 (Ni Made Suartini)\n" },
  );
  // Queries an earlier test left loaded may read again here; nothing at all is written.
  expect(state.requests).toContain("GET /api/med/patients/p-urn");
  expect(state.requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
});

it("does not start a chat for a patient who has no URN, and says why", async () => {
  const { openDraft } = setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    projects: [project("clinic", PRIMARY)],
    responses: { "/api/med/patients/p-none": home("p-none", null) },
  });
  await using screen = await render(inApp(<PatientHomePage patientId="p-none" />));

  const button = screen.getByRole("button", { name: "New chat" });
  await expect.element(button).toBeDisabled();
  await expect
    .element(button)
    .toHaveAccessibleDescription(
      "This patient has no URN yet, and a chat started here names them by URN.",
    );
  expect(openDraft).not.toHaveBeenCalled();
});

function lab(fields: Partial<MedLab> & Pick<MedLab, "id" | "collected">): MedLab {
  return {
    labTestId: "test-ldl",
    testId: "ldl",
    testName: "LDL cholesterol",
    testAsWritten: "LDL",
    value: null,
    valueText: "",
    unit: "mg/dL",
    referenceRange: "",
    flag: null,
    status: "verified",
    isBaseline: false,
    valueInBaselineUnit: null,
    changeFromBaseline: null,
    changePercent: null,
    changeUnit: null,
    notCompared: null,
    noteId: "note-1",
    revisions: [],
    ...fields,
  };
}

const RECORD: MedPatientRecord = {
  patient: { ...home("p1", "00-12-34-56").patient, diagnoses: "Ischemic stroke" },
  labs: [
    lab({
      id: "l1",
      collected: "2026-08-21",
      value: 162,
      valueText: "162",
      isBaseline: true,
      notCompared: "first_result",
    }),
    // Written in mmol/L. The server says what it is in the baseline's unit; the page never works it out.
    lab({
      id: "l2",
      collected: "2026-09-18",
      value: 3.31,
      valueText: "3.31",
      unit: "mmol/L",
      status: "draft",
      valueInBaselineUnit: 128,
      changeFromBaseline: -34,
      changePercent: -21,
      changeUnit: "mg/dL",
    }),
  ],
  plans: [],
  notes: [],
};

function Launcher() {
  const actions = useMedSurfaceActions([]);
  return (
    <ul aria-label="Surfaces">
      {actions.map((action) => (
        <li key={action.label}>
          <button type="button" disabled={!action.available} onClick={action.onClick}>
            {action.label}
          </button>
          {action.available ? null : <span>{action.disabledReason}</span>}
        </li>
      ))}
    </ul>
  );
}

it("offers the patient surfaces for a thread with a linked patient, and opens one as a tab", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-here"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-here/patient": { patient: { id: "p1", name: "Ni Made Suartini" } },
      "/api/med/patients/p1/record": RECORD,
    },
  });
  await using screen = await render(
    inApp(
      <>
        <Launcher />
        <MedSurfaceContent surface={medSurface("med-labs")} threadRef={linked} />
      </>,
    ),
  );

  const labs = screen.getByRole("button", { name: "Labs" });
  await expect.element(labs).toBeEnabled();
  expect(
    screen
      .getByRole("list", { name: "Surfaces" })
      .getByRole("button")
      .elements()
      .map((button) => button.textContent),
  ).toEqual(["Summary", "Labs", "Plan", "Timeline"]);
  await labs.click();
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, linked),
  ).toMatchObject({
    isOpen: true,
    activeSurfaceId: "med-labs",
    surfaces: [medSurface("med-labs")],
  });

  // The chart is in the baseline's mg/dL with the server's 128; the table keeps what was written.
  await expect
    .element(
      screen.getByRole("img", {
        name: /^LDL cholesterol in mg\/dL: 162 on .*baseline.*, 128 on .*draft/,
      }),
    )
    .toBeVisible();
  const results = screen.getByRole("table", { name: "Results of LDL cholesterol" });
  await expect.element(results.getByText("3.31 mmol/L")).toBeVisible();
  await expect.element(results.getByText("−34 mg/dL (−21%)")).toBeVisible();
  // Whose record it is stands at the top of the surface, with the URN.
  await expect.element(screen.getByRole("heading", { name: "Ni Made Suartini" })).toBeVisible();
  await expect.element(screen.getByText("URN 00-12-34-56")).toBeVisible();
  expect(state.requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
});

it("opens Labs on the test chosen in Summary", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-summary"));
  const hba1c = (id: string, collected: string, value: number) =>
    lab({
      id,
      collected,
      labTestId: "test-hba1c",
      testId: "hba1c",
      testName: "HbA1c",
      value,
      valueText: String(value),
      unit: "%",
      isBaseline: id === "h1",
      valueInBaselineUnit: value,
    });
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-summary/patient": {
        patient: { id: "p-two", name: "Ni Made Suartini" },
      },
      "/api/med/patients/p-two/record": {
        ...RECORD,
        patient: { ...RECORD.patient, id: "p-two" },
        labs: [...RECORD.labs, hba1c("h1", "2026-08-21", 8.1), hba1c("h2", "2026-09-18", 7.4)],
      },
    },
  });
  await using screen = await render(
    inApp(
      <>
        <MedSurfaceContent surface={medSurface("med-summary")} threadRef={linked} />
        <MedSurfaceContent surface={medSurface("med-labs")} threadRef={linked} />
      </>,
    ),
  );

  // Until a test is chosen, Labs shows the first one, A to Z, that has a trend.
  await expect.element(screen.getByRole("table", { name: "Results of HbA1c" })).toBeVisible();
  await screen.getByRole("button", { name: "LDL cholesterol: open in Labs" }).click();

  await expect
    .element(screen.getByRole("table", { name: "Results of LDL cholesterol" }))
    .toBeVisible();
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, linked),
  ).toMatchObject({ isOpen: true, activeSurfaceId: "med-labs" });
});

it("keeps what is coming up apart from the history, and marks each lab line", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-timeline"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/threads/thread-timeline/patient": {
        patient: { id: "p-time", name: "Ni Made Suartini" },
      },
      "/api/med/patients/p-time/record": {
        ...RECORD,
        patient: { ...RECORD.patient, id: "p-time" },
        labs: [
          { ...RECORD.labs[0], flag: "high" },
          { ...RECORD.labs[1], collected: "2026-08-21" },
        ],
        plans: [
          {
            id: "plan-open",
            patientId: "p-time",
            title: "Repeat lipid panel",
            due: "2027-01-10",
            type: "lab",
            status: "planned",
            doneOn: null,
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "plan-done",
            patientId: "p-time",
            title: "Head CT",
            due: "2026-08-20",
            type: "imaging",
            status: "done",
            doneOn: "2026-08-20",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    },
  });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-timeline")} threadRef={linked} />),
  );

  await expect
    .element(screen.getByRole("list", { name: "Coming up" }).getByText("Repeat lipid panel"))
    .toBeVisible();
  const history = screen.getByRole("heading", { name: "History" });
  await expect.element(history).toBeVisible();
  // An open plan is not history, however far ahead it is due; a finished one is.
  expect(
    screen
      .getByRole("listitem")
      .elements()
      .map((item) => item.textContent)
      .filter((text) => /lipid panel|Head CT|lab results/.test(text ?? "")),
  ).toEqual([
    expect.stringContaining("Repeat lipid panel"),
    expect.stringMatching(
      /^2 lab results, 1 draftLDL cholesterol 162 mg\/dLHighLDL cholesterol 3\.31 mmol\/LDraft$/,
    ),
    expect.stringContaining("Head CT"),
  ]);
  await expect.element(screen.getByText("URN 00-12-34-56")).toBeVisible();
});

it("tells a chat whose patient is not known yet, or could not be read, from one with none", async () => {
  const thread = scopeThreadRef(PRIMARY, ThreadId.make("thread-late"));
  let answer = (_value: unknown) => {};
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: thread,
    responses: {
      "/api/med/threads/thread-late/patient": new Promise((resolve) => {
        answer = resolve;
      }),
    },
  });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-summary")} threadRef={thread} />),
  );
  const unlinked = screen.getByText(/Give the chat the patient's URN and it links them\.$/);

  // Still on its way: nothing is claimed about the chat.
  await vi.waitFor(() =>
    expect(state.requests).toContain("GET /api/med/threads/thread-late/patient"),
  );
  await expect.element(unlinked).not.toBeInTheDocument();

  // Lost: the surface says so and offers to read again, and still claims nothing.
  answer({ unexpected: true });
  const retry = screen.getByRole("button", { name: "Try again" });
  await expect.element(retry).toBeVisible();
  await expect.element(screen.getByText(/^Could not load this from T3 Med/)).toBeVisible();
  await expect.element(unlinked).not.toBeInTheDocument();

  // Read: only now is the chat said to have no patient.
  state.responses["/api/med/threads/thread-late/patient"] = { patient: null };
  await retry.click();
  await expect.element(unlinked).toBeVisible();
});

const noop = () => {};

// Upstream's own launcher, with every surface on offer, as a chat with nothing open shows it.
function RealLauncher() {
  return (
    <RightPanelTabs
      mode="inline"
      keybindings={[]}
      getShortcutContext={() => ({}) as never}
      surfaces={[]}
      environmentId={PRIMARY}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={noop}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddBrowserInProfile={noop}
      onAddTerminal={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDevice={noop}
      onAddSideChat={noop}
      browserAvailable
      terminalAvailable
      diffAvailable
      filesAvailable
      pullRequestAvailable
      pullRequestsAvailable
      deviceAvailable
      sideChatAvailable
    >
      {null}
    </RightPanelTabs>
  );
}

it("keeps only Side chat of upstream's own launcher, and says why a patient surface is off", async () => {
  const unlinked = scopeThreadRef(PRIMARY, ThreadId.make("thread-launcher"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: unlinked,
    responses: { "/api/med/threads/thread-launcher/patient": { patient: null } },
  });
  await using screen = await render(inApp(<RealLauncher />));

  const launcher = screen.getByLabelText("Open a surface");
  // The reason is on the page, under the patient surfaces, not only in a tooltip.
  await expect
    .element(launcher.getByRole("note"))
    .toHaveTextContent("No patient is linked to this chat yet. Give the chat the patient's URN.");
  // Side chat is kept by the id the fork gives upstream's row: if a merge drops the id, or
  // upstream stops offering the row, this list is what changes. Files, Terminal, Diff, Browser,
  // Device and the pull request rows are upstream's and not listed.
  expect(launcher.element().textContent).toMatch(
    /^Open a surfaceSummaryS\s*LabsL\s*PlanP\s*TimelineT\s*No patient is linked[^F]*Side chatC$/,
  );
  expect(launcher.element().getAttribute("data-surface-launcher-keys")).toBe("C");
});

it("offers no patient surface, and draws no record, for a chat with no linked patient", async () => {
  const unlinked = scopeThreadRef(PRIMARY, ThreadId.make("thread-none"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: unlinked,
    responses: { "/api/med/threads/thread-none/patient": { patient: null } },
  });
  await using screen = await render(
    inApp(
      <>
        <Launcher />
        <MedSurfaceContent surface={medSurface("med-summary")} threadRef={unlinked} />
      </>,
    ),
  );

  await expect
    .element(screen.getByText(/Give the chat the patient's URN and it links them\.$/))
    .toBeVisible();
  for (const name of ["Summary", "Labs", "Plan", "Timeline"]) {
    await expect.element(screen.getByRole("button", { name })).toBeDisabled();
  }
  // A record an earlier test left loaded may be read again; none is drawn for this chat.
  await expect.element(screen.getByText("Ni Made Suartini")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
});

// What a change answers with as the row's `updatedAt`: its undo sends it back.
const STAMP = "2026-11-17T03:00:00.000Z";

const CORRECTED: MedPatientRecord = {
  ...RECORD,
  patient: { ...RECORD.patient, id: "p-fix" },
  labs: [
    RECORD.labs[0]!,
    {
      ...RECORD.labs[1]!,
      revisions: [
        {
          id: "rev-1",
          correctedBy: "agent",
          testAsWritten: "LDL",
          value: 33.1,
          valueText: "33.1",
          unit: "mmol/L",
          referenceRange: "",
          flag: null,
          collected: "2026-09-18",
          status: "verified",
          replacedAt: "2026-09-20T03:00:00.000Z",
        },
      ],
    },
  ],
  plans: [
    {
      id: "plan-1",
      patientId: "p-fix",
      title: "Repeat lipid panel",
      due: "2027-01-10",
      type: "lab",
      status: "planned",
      doneOn: null,
      updatedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
};

it("removes a result at once, puts it back from the toast, and shows what a correction replaced", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-fix"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-fix/patient": { patient: { id: "p-fix", name: "Ni Made Suartini" } },
      "/api/med/patients/p-fix/record": CORRECTED,
    },
    writes: { "PUT /api/med/labs/l2/removed": { body: { removed: true, updatedAt: STAMP } } },
  });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-labs")} threadRef={linked} />),
  );

  const results = screen.getByRole("table", { name: "Results of LDL cholesterol" });
  await expect
    .element(results.getByText(/^Was 33\.1 mmol\/L, corrected by agent, 20 Sep/))
    .toBeVisible();

  await screen.getByRole("button", { name: /^Actions for LDL cholesterol, 18 Sep/ }).click();
  // A corrected draft: it can be verified, corrected again, taken back a step, or removed.
  await expect.element(page.getByRole("menuitem").first()).toBeVisible();
  expect(
    page
      .getByRole("menuitem")
      .elements()
      .map((item) => item.textContent),
  ).toEqual(["Verify", "Correct…", "Undo last correction", "Remove"]);
  await page.getByRole("menuitem", { name: "Remove" }).click();

  await expect.element(page.getByText("Removed LDL cholesterol 3.31 mmol/L")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("Put back LDL cholesterol 3.31 mmol/L")).toBeVisible();
  expect(state.sent).toEqual([
    ["PUT /api/med/labs/l2/removed", { removed: true }],
    ["PUT /api/med/labs/l2/removed", { removed: false, ifUpdatedAt: STAMP }],
  ]);
});

it("corrects a result from its row, and keeps the form open on what the server refuses", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-fix"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-fix/patient": { patient: { id: "p-fix", name: "Ni Made Suartini" } },
      "/api/med/patients/p-fix/record": CORRECTED,
    },
    writes: {
      "PATCH /api/med/labs/l1": [
        {
          status: 422,
          body: { _tag: "MedRefusedError", reason: "unit must not be blank." },
        },
        {
          body: {
            ...CORRECTED.labs[0],
            value: 152,
            valueText: "152",
            revisions: [
              { ...CORRECTED.labs[1]!.revisions[0]!, id: "rev-new", correctedBy: "doctor" },
            ],
          },
        },
      ],
      // An agent corrected the result again before the doctor reached for Undo.
      "POST /api/med/labs/l1/undo-correction": {
        status: 409,
        body: { _tag: "MedChangedSinceError", row: "lab", id: "l1" },
      },
    },
  });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-labs")} threadRef={linked} />),
  );

  await screen.getByRole("button", { name: /^Actions for LDL cholesterol, 21 Aug/ }).click();
  await page.getByRole("menuitem", { name: "Correct…" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct this result" });
  // The form opens on what the result says, and the number follows a plainly written one.
  await expect.element(dialog.getByLabelText("Result as written")).toHaveValue("162");
  await userEvent.fill(dialog.getByLabelText("Result as written"), "152");
  await expect.element(dialog.getByLabelText("Number used for comparison")).toHaveValue("152");
  await expect.element(dialog.getByLabelText("Test as written")).toHaveValue("LDL");
  // Retyped as a word, the old number is not left behind; a comma is read the Indonesian way.
  await userEvent.fill(dialog.getByLabelText("Result as written"), "negative");
  await expect.element(dialog.getByLabelText("Number used for comparison")).toHaveValue("");
  await userEvent.fill(dialog.getByLabelText("Result as written"), "15,2");
  await expect.element(dialog.getByLabelText("Number used for comparison")).toHaveValue("15.2");
  await userEvent.fill(dialog.getByLabelText("Result as written"), "152");

  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect.element(dialog.getByRole("alert")).toHaveTextContent("unit must not be blank.");
  await dialog.getByRole("button", { name: "Save correction" }).click();

  await expect.element(page.getByText(/^Corrected LDL cholesterol\. It is a draft/)).toBeVisible();
  await expect.element(dialog).not.toBeInTheDocument();
  // Only what changed is sent, twice: once refused and once taken.
  const change = ["PATCH /api/med/labs/l1", { value: 152, valueText: "152" }];
  expect(state.sent).toEqual([change, change]);

  // Undo takes back this correction and no other; the row has changed, and the toast says so.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("Could not undo the correction")).toBeVisible();
  await expect
    .element(page.getByText("This result has changed since, so it was not undone."))
    .toBeVisible();
  expect(state.sent.at(-1)).toEqual([
    "POST /api/med/labs/l1/undo-correction",
    { revisionId: "rev-new" },
  ]);
});

it("returns a verified result to draft, and undoes a correction from its row", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-fix"));
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-fix/patient": { patient: { id: "p-fix", name: "Ni Made Suartini" } },
      "/api/med/patients/p-fix/record": CORRECTED,
    },
    writes: {
      "PUT /api/med/labs/l1/verified": { body: { verified: false, updatedAt: STAMP } },
      "POST /api/med/labs/l2/undo-correction": { body: { ...CORRECTED.labs[1], revisions: [] } },
    },
  });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-labs")} threadRef={linked} />),
  );

  await screen.getByRole("button", { name: /^Actions for LDL cholesterol, 21 Aug/ }).click();
  await page.getByRole("menuitem", { name: "Return to draft" }).click();
  await expect.element(page.getByText("LDL cholesterol 162 mg/dL is a draft again")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("Verified LDL cholesterol 162 mg/dL")).toBeVisible();

  // The row's own undo names the correction listed under it, the latest one.
  await screen.getByRole("button", { name: /^Actions for LDL cholesterol, 18 Sep/ }).click();
  await page.getByRole("menuitem", { name: "Undo last correction" }).click();
  await expect.element(page.getByText("Put back what LDL cholesterol said before")).toBeVisible();
  expect(state.sent).toEqual([
    ["PUT /api/med/labs/l1/verified", { verified: false }],
    ["PUT /api/med/labs/l1/verified", { verified: true, ifUpdatedAt: STAMP }],
    ["POST /api/med/labs/l2/undo-correction", { revisionId: "rev-1" }],
  ]);
});

it("closes a plan and reopens it from the toast, and changes nothing without the scope", async () => {
  const linked = scopeThreadRef(PRIMARY, ThreadId.make("thread-fix"));
  const answers = {
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    routeThreadRef: linked,
    responses: {
      "/api/med/threads/thread-fix/patient": { patient: { id: "p-fix", name: "Ni Made Suartini" } },
      "/api/med/patients/p-fix/record": CORRECTED,
    },
    writes: {
      "PATCH /api/med/plans/plan-1": {
        body: { ...CORRECTED.plans[0], status: "done", updatedAt: STAMP },
      },
    },
  };
  setup({ ...answers, mayChange: false });
  await using screen = await render(
    inApp(<MedSurfaceContent surface={medSurface("med-plan")} threadRef={linked} />),
  );

  // A session that may only read is offered no control at all.
  await expect.element(screen.getByText("Repeat lipid panel")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Actions for/ }))
    .not.toBeInTheDocument();

  setup(answers);
  await screen.rerender(
    inApp(<MedSurfaceContent surface={medSurface("med-plan")} threadRef={linked} />),
  );
  await screen.getByRole("button", { name: "Actions for Repeat lipid panel" }).click();
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  await expect.element(page.getByText("Marked done: Repeat lipid panel")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("Repeat lipid panel is open again")).toBeVisible();
  expect(state.sent).toEqual([
    ["PATCH /api/med/plans/plan-1", { status: "done" }],
    ["PATCH /api/med/plans/plan-1", { status: "open", ifUpdatedAt: STAMP }],
  ]);
});

const WAITING: MedWaitingNote = {
  id: "note-1",
  threadId: "thread-filed",
  title: "Labs 6 Nov",
  date: "2026-11-06",
  summary: "",
  needsYou: "",
  needsYouHandledAt: null,
  draftLabs: 2,
  draftPlans: 1,
  draftLabRows: [
    {
      id: "l1",
      testName: "LDL cholesterol",
      valueText: "162",
      unit: "mg/dL",
      collected: "2026-11-06",
    },
    { id: "l2", testName: "Anti-dsDNA", valueText: "negative", unit: "", collected: "2026-11-06" },
  ],
  draftPlanRows: [{ id: "plan-1", title: "Repeat lipid panel", due: "2027-01-10" }],
};

const ASKED: MedWaitingNote = {
  ...WAITING,
  id: "note-2",
  title: "Asked",
  needsYou: "Which lab ran this?",
  draftLabs: 0,
  draftPlans: 0,
  draftLabRows: [],
  draftPlanRows: [],
};

it("verifies the drafts a note lists on Needs you and no others, with an undo", async () => {
  const rows = { labIds: ["l1", "l2"], planIds: ["plan-1"] };
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/needs-you": {
        inbox: [],
        patients: [
          {
            patient: home("p-wait", "00-12-34-56").patient,
            draftLabs: 2,
            draftPlans: 1,
            notes: [WAITING, ASKED],
          },
        ],
      },
    },
    writes: {
      // One of the three was verified elsewhere meanwhile: the answer says what this call did.
      "POST /api/med/notes/note-1/verify": {
        body: {
          labsVerified: 1,
          plansPlanned: 1,
          patientActivated: false,
          labIds: ["l2"],
          planIds: ["plan-1"],
        },
      },
      "POST /api/med/notes/note-1/unverify": { body: { labIds: ["l2"], planIds: ["plan-1"] } },
      "PUT /api/med/notes/note-2/question-handled": [
        { body: { handled: true } },
        { body: { handled: false } },
      ],
    },
  });
  await using screen = await render(inApp(<NeedsYouPage />));

  // The note says what it would verify, row by row; the row itself still opens its chat.
  await expect.element(screen.getByRole("link", { name: /Labs 6 Nov/ })).toBeVisible();
  const drafts = screen.getByRole("list", { name: "Drafts from Labs 6 Nov" });
  expect(
    drafts
      .getByRole("listitem")
      .elements()
      .map((item) => item.textContent),
  ).toEqual([
    "LDL cholesterol 162 mg/dL, 6 Nov",
    "Anti-dsDNA negative, 6 Nov",
    "Plan: Repeat lipid panel, due 10 Jan 2027",
  ]);
  expect(screen.getByRole("button", { name: /^Verify / }).elements()).toHaveLength(1);
  await screen.getByRole("button", { name: "Verify 2 results and 1 plan from Labs 6 Nov" }).click();

  // The toast names the patient and what was verified, by what the server says it did.
  await expect
    .element(page.getByText("Verified 1 result and 1 plan for Ni Made Suartini"))
    .toBeVisible();
  await expect
    .element(page.getByText("Anti-dsDNA negative, 6 Nov; Repeat lipid panel, due 10 Jan 2027"))
    .toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .element(page.getByText("1 result and 1 plan for Ni Made Suartini: drafts again"))
    .toBeVisible();
  expect(state.sent).toEqual([
    ["POST /api/med/notes/note-1/verify", rows],
    ["POST /api/med/notes/note-1/unverify", { labIds: ["l2"], planIds: ["plan-1"] }],
  ]);

  // A note that only asks something has one control, which takes it off this page.
  await expect.element(screen.getByText("Which lab ran this?")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Mark the question in Asked as handled" }).click();
  await expect.element(page.getByText("Marked the question in Asked as handled")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("The question in Asked waits for you again")).toBeVisible();
  expect(state.sent.slice(2)).toEqual([
    ["PUT /api/med/notes/note-2/question-handled", { handled: true }],
    ["PUT /api/med/notes/note-2/question-handled", { handled: false }],
  ]);
});

it("shows each plan's status on a patient's page, moves a note to the Inbox and restores what was removed", async () => {
  const plan = { ...CORRECTED.plans[0]!, patientId: "p-home" };
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/patients/p-home": home("p-home", "00-12-34-56", {
        notes: [
          {
            ...WAITING,
            draftLabs: 1,
            draftPlans: 0,
            draftLabRows: [WAITING.draftLabRows[0]!],
            draftPlanRows: [],
          },
        ],
        upcomingPlans: [plan, { ...plan, id: "plan-2", title: "EEG", status: "draft" }],
      }),
      "/api/med/patients/p-home/removed": {
        labs: [{ ...WAITING.draftLabRows[1]!, removedAt: "2026-11-16T03:00:00.000Z" }],
        plans: [
          {
            id: "plan-9",
            title: "Brain MRI",
            due: "2026-12-01",
            removedAt: "2026-11-15T03:00:00.000Z",
          },
        ],
      },
    },
    writes: {
      "POST /api/med/notes/note-1/verify": {
        body: {
          labsVerified: 1,
          plansPlanned: 0,
          patientActivated: false,
          labIds: ["l1"],
          planIds: [],
        },
      },
      "POST /api/med/notes/note-1/inbox": { body: { noteId: "note-1" } },
      "PUT /api/med/plans/plan-9/removed": { body: { removed: false, updatedAt: STAMP } },
    },
  });
  await using screen = await render(inApp(<PatientHomePage patientId="p-home" />));

  // A confirmed plan says so, as on the Plan surface: without it a draft is the only one marked.
  const plans = screen.getByRole("list", { name: "Plans" });
  await expect.element(plans.getByText("Planned")).toBeVisible();
  await expect.element(plans.getByText("Draft")).toBeVisible();

  // Verifying from here lists the rows first: the page itself shows only how many there are.
  await screen.getByRole("button", { name: "Actions for Labs 6 Nov" }).click();
  await page.getByRole("menuitem", { name: "Verify 1 result…" }).click();
  const verifying = page.getByRole("alertdialog", { name: "Verify 1 result from Labs 6 Nov?" });
  await expect.element(verifying.getByText("LDL cholesterol 162 mg/dL, 6 Nov")).toBeVisible();
  await verifying.getByRole("button", { name: "Verify" }).click();
  await expect.element(page.getByText("Verified 1 result for Ni Made Suartini")).toBeVisible();

  await screen.getByRole("button", { name: "Actions for Labs 6 Nov" }).click();
  await page.getByRole("menuitem", { name: "Move to Inbox…" }).click();
  const moving = page.getByRole("alertdialog", { name: "Move Labs 6 Nov to the Inbox?" });
  await moving.getByRole("button", { name: "Move to Inbox" }).click();
  await expect.element(page.getByText("Moved Labs 6 Nov to the Inbox")).toBeVisible();

  // What was removed is folded away at the foot of the page, and each row can be put back.
  const removed = screen.getByRole("button", { name: /^Removed/ });
  await expect.element(removed).toHaveTextContent("Removed2");
  await expect.element(screen.getByRole("list", { name: "Removed" })).not.toBeInTheDocument();
  await removed.click();
  const list = screen.getByRole("list", { name: "Removed" });
  await expect.element(list.getByText("Anti-dsDNA negative, 6 Nov")).toBeVisible();
  await expect.element(list.getByText("Removed 15 Nov")).toBeVisible();
  await list.getByRole("button", { name: "Restore Plan: Brain MRI, due 1 Dec" }).click();
  await expect.element(page.getByText("Put back Brain MRI")).toBeVisible();

  expect(state.sent).toEqual([
    ["POST /api/med/notes/note-1/verify", { labIds: ["l1"], planIds: [] }],
    ["POST /api/med/notes/note-1/inbox", null],
    ["PUT /api/med/plans/plan-9/removed", { removed: false }],
  ]);
});

it("edits a patient from their page, says whose URN is taken, and archives with an undo", async () => {
  const patient = home("p-edit", "00-12-34-56").patient;
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/patients/p-edit": home("p-edit", "00-12-34-56"),
      "/api/med/patients/p-edit/record": {
        ...RECORD,
        patient: { ...patient, diagnoses: "Ischemic stroke", alsoWrittenAs: ["Bu Made"] },
      },
    },
    writes: {
      "PATCH /api/med/patients/p-edit": [
        {
          status: 409,
          body: { _tag: "MedUrnTakenError", patientId: "p-other", patientName: "I Wayan Sudarma" },
        },
        { body: { ...patient, diagnoses: "Ischemic stroke", status: "archived" } },
        { body: { ...patient, diagnoses: "Ischemic stroke" } },
      ],
    },
  });
  await using screen = await render(inApp(<PatientHomePage patientId="p-edit" />));

  await screen.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit patient details" });
  // The diagnoses come from the patient's record: the page itself is not sent them.
  await expect.element(dialog.getByLabelText("Diagnoses")).toHaveValue("Ischemic stroke");
  await expect.element(dialog.getByLabelText("Also written as")).toHaveValue("Bu Made");
  await userEvent.fill(dialog.getByLabelText("URN"), "00-45-67-89");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent("This URN belongs to I Wayan Sudarma. Nothing was changed.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await screen.getByRole("button", { name: "Archive" }).click();
  await expect.element(page.getByText("Archived Ni Made Suartini")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(page.getByText("Ni Made Suartini is no longer archived")).toBeVisible();
  expect(state.sent).toEqual([
    ["PATCH /api/med/patients/p-edit", { urn: "00-45-67-89" }],
    ["PATCH /api/med/patients/p-edit", { archived: true }],
    ["PATCH /api/med/patients/p-edit", { archived: false }],
  ]);
});

function threadRow(environmentId: EnvironmentId, id: string, title: string) {
  return (
    <SidebarSearchResultRow
      isSettled={false}
      thread={makeThreadFixture({ environmentId, id: ThreadId.make(id), title })}
      project={null}
      // What the sidebar hands every row in T3 Med: no project is named.
      projectDisplayName={null}
      environmentLabel={null}
      environmentMachine="server"
      providerEntryByInstanceId={new Map()}
      isHighlighted={false}
      isRouteActive={false}
      resultId={`result-${id}`}
      searchMatch={null}
      searchQuery=""
      onHighlight={() => {}}
      onSelect={() => {}}
      onFileDropThreads={() => {}}
    />
  );
}

it("names each thread's patient on its sidebar row from one read, with the URN in its hover card", async () => {
  setup({
    primaryEnvironmentId: PRIMARY,
    mayRead: true,
    responses: {
      "/api/med/thread-patients": {
        links: [
          { threadId: "row-made", patientId: "p1", name: "Ni Made Suartini", urn: "00-12-34-56" },
          { threadId: "row-wayan", patientId: "p2", name: "I Wayan Sudarma", urn: null },
          // A thread of another machine can carry the same id; its row asks about no one.
          { threadId: "row-elsewhere", patientId: "p9", name: "Wrong", urn: "99" },
        ],
      },
    },
  });
  await using screen = await render(
    inApp(
      <ul role="listbox">
        {threadRow(PRIMARY, "row-made", "LDL follow-up")}
        {threadRow(PRIMARY, "row-wayan", "EEG result")}
        {threadRow(PRIMARY, "row-unlinked", "A question about dosing")}
        {threadRow(OTHER, "row-elsewhere", "Another machine")}
      </ul>,
    ),
  );

  // A row's accessible name carries the patient where upstream's carried the project.
  const row = (title: string) => screen.getByRole("option", { name: new RegExp(title) });
  await expect
    .element(screen.getByRole("option", { name: /LDL follow-up.*Ni Made Suartini/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("option", { name: /EEG result.*I Wayan Sudarma/ }))
    .toBeVisible();
  // A chat with no patient, and one of another machine, name nobody.
  for (const title of ["A question about dosing", "Another machine"]) {
    expect(row(title).element().getAttribute("aria-label")).not.toMatch(/Suartini|Sudarma|Wrong/);
  }
  // Four rows, one request, and none that asks about one of them.
  expect(state.requests.filter((request) => request.endsWith("/thread-patients"))).toEqual([
    "GET /api/med/thread-patients",
  ]);
  expect(state.requests.filter((request) => request.includes("/threads/row-"))).toEqual([]);

  await userEvent.hover(row("LDL follow-up"));
  await expect.element(page.getByText("URN 00-12-34-56")).toBeVisible();
  await expect.element(page.getByText("Ni Made Suartini", { exact: true })).toBeVisible();
});
