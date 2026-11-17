import {
  DEFAULT_SERVER_SETTINGS as UPSTREAM_SETTINGS,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { DEFAULT_RUNTIME_MODE } from "../types";
import { DEFAULT_SERVER_SETTINGS, medRuntimeMode } from "./medDefaults";

describe("a new thread's permission mode in the client", () => {
  it("is the mode that asks, where upstream's is Full access", () => {
    expect(UPSTREAM_SETTINGS.defaultRuntimeMode).toBe("full-access");
    expect(medRuntimeMode("full-access")).toBe("approval-required");
    expect(DEFAULT_RUNTIME_MODE).toBe("approval-required");
  });

  it("is what Settings resets to, with every other default upstream's", () => {
    expect(DEFAULT_SERVER_SETTINGS).toEqual({
      ...UPSTREAM_SETTINGS,
      defaultRuntimeMode: "approval-required",
    });
  });

  it("is the mode of a draft that was made without one", () => {
    const projectRef = scopeProjectRef(EnvironmentId.make("env-med"), ProjectId.make("workspace"));
    const draftId = DraftId.make("draft-med-default-mode");
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId);
    expect(store.getDraftSession(draftId)?.runtimeMode).toBe("approval-required");
    // A mode the doctor or Settings chose is kept.
    const chosen = DraftId.make("draft-med-chosen-mode");
    store.setProjectDraftThreadId(projectRef, chosen, { runtimeMode: "full-access" });
    expect(useComposerDraftStore.getState().getDraftSession(chosen)?.runtimeMode).toBe(
      "full-access",
    );
  });
});
