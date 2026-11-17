import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { MedLab, MedPatientHome, MedPatientRecord } from "@t3tools/contracts/med";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import type { Project } from "../types";

const PRIMARY = EnvironmentId.make("primary");
const OTHER = EnvironmentId.make("other-machine");

// What the mocked modules read. `setup` resets it at the top of every test.
const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as string | null,
  mayRead: false,
  projects: [] as ReadonlyArray<unknown>,
  threadTitles: {} as Record<string, string>,
  routeThreadRef: null as unknown,
  responses: {} as Record<string, unknown>,
  requests: [] as Array<string>,
  openDraft: (..._args: ReadonlyArray<unknown>): Promise<null> => Promise.resolve(null),
}));

vi.mock(import("../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePrimaryEnvironmentId: () => state.primaryEnvironmentId as never,
}));
vi.mock(import("../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: (environmentId) => environmentId !== null && state.mayRead,
}));
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
      return path in state.responses
        ? Response.json(state.responses[path])
        : Response.json({ _tag: "MedPatientNotFoundError", patientId: path }, { status: 404 });
    }) as never,
  };
});

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { refreshMedData } from "./medData";
import { MedSidebarNav } from "./MedSidebarNav";
import { MedSurfaceContent } from "./MedSurfaceContent";
import { useMedSurfaceActions } from "./MedSurfaceLauncher";
import { medSurface } from "./medSurfaces";
import { MedThreadPatientCrumb } from "./MedThreadPatientCrumb";
import { PatientHomePage } from "./PatientHomePage";

function setup(input: {
  readonly primaryEnvironmentId: string | null;
  readonly mayRead: boolean;
  readonly responses?: Record<string, unknown>;
  readonly projects?: ReadonlyArray<Project>;
  readonly threadTitles?: Record<string, string>;
  readonly routeThreadRef?: ScopedThreadRef | null;
}) {
  const openDraft = vi.fn((..._args: ReadonlyArray<unknown>) => Promise.resolve(null));
  Object.assign(state, {
    primaryEnvironmentId: input.primaryEnvironmentId,
    mayRead: input.mayRead,
    projects: input.projects ?? [],
    threadTitles: input.threadTitles ?? {},
    routeThreadRef: input.routeThreadRef ?? null,
    responses: input.responses ?? {},
    requests: [],
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
      <SidebarProvider>{children}</SidebarProvider>
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
  expect(state.requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
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
    .element(screen.getByText(/^No patient is linked to this chat yet\. Give the chat/))
    .toBeVisible();
  for (const name of ["Summary", "Labs", "Plan", "Timeline"]) {
    await expect.element(screen.getByRole("button", { name })).toBeDisabled();
  }
  // A record an earlier test left loaded may be read again; none is drawn for this chat.
  await expect.element(screen.getByText("Ni Made Suartini")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
});
