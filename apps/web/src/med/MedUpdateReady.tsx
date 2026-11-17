/**
 * T3 Med: the one thing a doctor is asked about an update. Once it is downloaded, a button at
 * the foot of the sidebar says "Restart to update to <version>" until the app restarts.
 * `SidebarChrome.tsx` renders it above the footer's row; upstream's small update button stays.
 */
import type { DesktopUpdateState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";
import { installLocalUpdate } from "../components/sidebar/SidebarUpdatePill";
import { Button } from "../components/ui/button";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { isElectron } from "../env";
import { ensureLocalApi } from "../localApi";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { announceMedUpdateReady } from "./medUpdateAnnounce";
import { restartToUpdateLabel } from "./medUpdateWording";
import { T3MED } from "./t3med";

/** Asks, then restarts into the update. Never rejects: what goes wrong is said in a toast. */
async function confirmAndRestart(state: DesktopUpdateState): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge) return;
  try {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      getDesktopUpdateInstallConfirmationMessage(state),
      { initialFocus: "confirm" },
    );
    if (confirmed) await installLocalUpdate(bridge);
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not confirm update",
        description: error instanceof Error ? error.message : "Update confirmation failed.",
      }),
    );
  }
}

export function MedUpdateReady() {
  return T3MED && isElectron ? <MedUpdateReadyButton /> : null;
}

function MedUpdateReadyButton() {
  const state = useDesktopUpdateState();
  const [isPending, setIsPending] = useState(false);
  const version =
    state && resolveDesktopUpdateButtonAction(state) === "install"
      ? getDesktopUpdateDownloadedVersion(state)
      : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The toast and its once-per-version mark live outside React, and the download finishes with no click to announce it from.
  useEffect(() => {
    announceMedUpdateReady(version);
  }, [version]);

  if (!state || version === null) return null;

  const restart = () => {
    if (isPending) return;
    setIsPending(true);
    void confirmAndRestart(state).then(() => setIsPending(false));
  };

  return (
    <div className="grid px-1">
      <Button disabled={isPending} onClick={restart}>
        <span className="truncate">{restartToUpdateLabel(version)}</span>
      </Button>
    </div>
  );
}
