/**
 * T3 Med: twins of three upstream cases in `ChatView.browser.test.tsx`. Upstream's wait for the
 * project's name in the sidebar, which a patient workspace does not show, so they are skipped
 * (`medSkippedTests.ts`); the behaviour they test is live, and is tested here without that wait.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ORCHESTRATION_V2_WS_METHODS, ThreadId, WS_METHODS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentProjects } from "~/state/projects";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

/** Accepts every attachment upload without sending its bytes, until disposed. */
function acceptAttachmentUploads(): Disposable {
  const mint = answerRpc(WS_METHODS.attachmentsCreateUploadUrl, () =>
    Effect.succeed({ attachmentId: "upload-1", relativeUrl: "/upload", expiresAt: 0 }),
  );
  const verify = answerRpc(WS_METHODS.assetsCreateUrl, () =>
    Effect.succeed({ relativeUrl: "/upload-1", expiresAt: 0 }),
  );
  const status = vi.spyOn(XMLHttpRequest.prototype, "status", "get").mockReturnValue(200);
  const send = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(function (
    this: XMLHttpRequest,
  ) {
    queueMicrotask(() => this.dispatchEvent(new ProgressEvent("load")));
  });
  return {
    [Symbol.dispose]: () => {
      send.mockRestore();
      status.mockRestore();
      mint[Symbol.dispose]();
      verify[Symbol.dispose]();
    },
  };
}

/** Holds every call to `method` until `release`, then ends it with `end`, until disposed. */
function holdRpc<Input>(method: string, end: Effect.Effect<never, Error>) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: Input[] = [];
  const answer = answerRpc(method, (input: Input) => {
    calls.push(input);
    return Effect.promise(() => held).pipe(Effect.andThen(end));
  });
  return { calls, release, [Symbol.dispose]: () => answer[Symbol.dispose]() };
}

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

// The shell snapshot has arrived once the client holds the project. Upstream reads that off the
// sidebar, where the project is named; a patient workspace names it nowhere, so read the state.
const shellSnapshotArrived = () =>
  vi.waitFor(() =>
    expect(appAtomRegistry.get(environmentProjects.projectsAtom).length).toBeGreaterThan(0),
  );

async function openDraft(draftId: DraftId) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  // AppRoot brings its own router.
  return render(<AppRoot router={router} />, { router: false });
}

it("a new draft does not load its reserved thread before the server lists it", async () => {
  using _environment = installFakeEnvironment([]);
  using fetchSpy = vi.spyOn(globalThis, "fetch");
  const draftId = DraftId.make("draft-med-27443");
  const threadId = ThreadId.make("thread-med-27443");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });

  await using _app = await openDraft(draftId);
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await shellSnapshotArrived();
  // The draft is what a doctor sees, and it names no project.
  await expect.element(page.getByText("Which patient is this about?")).toBeVisible();
  expect(page.getByText("render", { exact: true }).query()).toBeNull();

  const threadRequests = fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes(`/api/orchestration/threads/${threadId}/`));
  // A 404 here marks the thread deleted, and the view never loads it once the send creates it.
  expect(threadRequests).toEqual([]);
});

it("an interrupted image-only first send of a new thread says it may not have been sent", async () => {
  using _environment = installFakeEnvironment([]);
  const draftId = DraftId.make("draft-med-image-only-interrupted");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
      threadId: ThreadId.make("thread-med-image-only-interrupted"),
    });
  // A dropped connection interrupts a new thread's launch, which is not resent.
  using launch = holdRpc(ORCHESTRATION_V2_WS_METHODS.launchThread, Effect.interrupt);
  await using _app = await openDraft(draftId);
  using _uploads = acceptAttachmentUploads();
  const editor = page.getByTestId("composer-editor");
  await expect.element(editor).toBeVisible();
  // The send needs the project, which arrives with the shell snapshot.
  await shellSnapshotArrived();

  await userEvent.click(editor);
  const clipboardData = new DataTransfer();
  // A photo of a lab sheet, pasted with no words.
  clipboardData.items.add(new File([PNG], "lab-sheet.png", { type: "image/png" }));
  editor
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  await expect.element(page.getByRole("img", { name: "lab-sheet.png" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(launch.calls).toHaveLength(1));
  await userEvent.keyboard("next draft");
  await expect.element(editor).toHaveTextContent("next draft");
  launch.release();

  await expect.element(page.getByText("Message may not have been sent")).toBeVisible();
  await expect.element(editor).toHaveTextContent("next draft");
  // With no text there is nothing to copy.
  expect(page.getByText("Copy message", { exact: true }).query()).toBeNull();
});

it("a stashed prompt ending in a file chip restores with the chip", async () => {
  using _environment = installFakeEnvironment([]);
  const draftId = DraftId.make("draft-med-28338");
  const drafts = useComposerDraftStore.getState();
  drafts.setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
    threadId: ThreadId.make("thread-med-28338"),
  });
  drafts.setPrompt(draftId, "Check [package.json](package.json) ");
  await using _app = await openDraft(draftId);
  const chip = page.getByRole("button", { name: "Preview package.json" });
  await expect.element(chip).toBeVisible();
  // The stash shortcut is a no-op until the shell snapshot lists the project.
  await shellSnapshotArrived();

  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  await userEvent.keyboard("{ControlOrMeta>}s{/ControlOrMeta}");
  await expect.element(chip).not.toBeInTheDocument();
  await userEvent.keyboard("{ControlOrMeta>}s{/ControlOrMeta}");

  await vi.waitFor(() => expect(editor.element().textContent).toContain("Check"));
  expect(editor.element().textContent).not.toContain("[package.json](package.json)");
  await expect.element(chip).toBeVisible();
});
