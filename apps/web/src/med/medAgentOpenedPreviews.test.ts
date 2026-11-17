import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import * as Upstream from "../components/preview/agentOpenedPreviews";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";
import {
  applyPreviewServerEvent,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "../previewStateStore";
import { useRightPanelStore } from "../rightPanelStore";
import { startAgentOpenedPreviews } from "./medAgentOpenedPreviews";

vi.mock("../state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => true,
}));

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));
const threadKey = scopedThreadKey(ref);

const agentTab: PreviewSessionSnapshot = {
  threadId: "thread-1",
  tabId: "tab_agent",
  navStatus: { _tag: "Loading", url: "http://localhost:5173/", title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  runtime: "server",
  reveal: true,
};

// What upstream's own test sends for a browser an agent opens after the first list.
function agentOpensBrowser() {
  reconcilePreviewServerSessions(ref, { sessions: [], serverEpoch: "server-a", revision: 1 });
  applyPreviewServerEvent(ref, {
    type: "opened",
    threadId: "thread-1",
    tabId: agentTab.tabId,
    createdAt: agentTab.updatedAt,
    snapshot: agentTab,
    serverEpoch: "server-a",
    revision: 2,
  });
}

function shown() {
  return {
    floating: usePreviewMiniPlayerStore.getState().byThreadKey[threadKey]?.source ?? null,
    tabs: (useRightPanelStore.getState().byThreadKey[threadKey]?.surfaces ?? []).map(
      (surface) => surface.id,
    ),
  };
}

function setup() {
  resetPreviewStateForTests();
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {} });
}

it("shows nothing over a patient chat when an agent opens a browser", () => {
  setup();
  using _following = { [Symbol.dispose]: startAgentOpenedPreviews() };
  agentOpensBrowser();
  expect(shown()).toEqual({ floating: null, tabs: [] });
});

it("differs from upstream's follower, which floats that browser and adds its tab", () => {
  setup();
  using _following = { [Symbol.dispose]: Upstream.startAgentOpenedPreviews() };
  agentOpensBrowser();
  expect(shown()).toEqual({
    floating: { kind: "browser", tabId: "tab_agent" },
    tabs: ["browser:tab_agent"],
  });
});
