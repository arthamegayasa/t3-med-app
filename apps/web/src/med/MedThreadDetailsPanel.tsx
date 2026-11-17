/**
 * T3 Med: the thread details card, which `ChatView.tsx` imports from here. Its rows are about a
 * machine, a worktree, Git and dev servers, so a patient chat draws no card; its toggle, its
 * shortcut and its Appearance row are hidden with it (`PanelLayoutControls.tsx`, `medHidden.ts`).
 */
import type { ComponentProps, ReactNode } from "react";

import * as Upstream from "../components/chat/ThreadDetailsPanel";
import { T3MED } from "./t3med";

function NoThreadDetails() {
  return null;
}

export const ThreadDetailsPanel: (
  props: ComponentProps<typeof Upstream.ThreadDetailsPanel>,
) => ReactNode = T3MED ? NoThreadDetails : Upstream.ThreadDetailsPanel;
