/**
 * T3 Med: the twin of upstream's "opens a search intent with its query in the focused input"
 * (`CommandPalette.browser.test.tsx`), which looks the input up by a placeholder that names
 * projects. The intent still works; the palette finds no project.
 */
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { CommandPalette } from "../components/CommandPalette";
import { LAST_USED_PROJECT_STORAGE_KEY } from "../hooks/useHandleNewThread";
import { removeLocalStorageItem } from "../hooks/useLocalStorage";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";

const entities = vi.hoisted(() => ({
  projects: [] as ReadonlyArray<Project>,
  threads: [] as ReadonlyArray<Thread>,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => entities.projects,
  useVisibleThreadShells: () => entities.threads,
  useDelegatedUnderParent: () => new Set<string>(),
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("t3-med");

function setup() {
  removeLocalStorageItem(LAST_USED_PROJECT_STORAGE_KEY);
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  // The patient workspace is the one project, and its name is what a doctor would type.
  entities.projects = [
    {
      id: projectId,
      environmentId,
      title: "T3 Med",
      workspaceRoot: "D:/T3 Projects/T3 Med",
      repositoryIdentity: null,
      defaultModelSelection: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      scripts: [],
    },
  ];
  entities.threads = [
    makeThreadFixture({ environmentId, projectId, title: "T3 Med lipid follow-up" }),
  ];
}

it("opens a search intent with its query in the focused input, and finds no project", async () => {
  setup();
  await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

  openCommandPalette({ query: "t3 med" });

  const input = page.getByPlaceholder("Search commands and threads...");
  await expect.element(input).toHaveFocus();
  await expect.element(input).toHaveValue("t3 med");
  // A thread is found by the words in its title.
  await expect.element(page.getByText("T3 Med lipid follow-up")).toBeVisible();
  // Upstream lists the workspace under "Projects" here; a doctor has no use for it.
  expect(page.getByText("Projects", { exact: true }).query()).toBeNull();
  expect(page.getByRole("option", { name: /^T3 Med$/ }).query()).toBeNull();
});
