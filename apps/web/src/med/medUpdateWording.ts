/**
 * T3 Med: what the app's own update says to a doctor. An update downloads by itself
 * (`apps/desktop/src/med/updates.ts`), so the one thing asked is when to restart. Upstream's
 * sentences stay in `desktopUpdate.logic.ts`, behind one line each; see FORK.md, Updates.
 */
import type { DesktopUpdateState } from "@t3tools/contracts";

import { APP_BASE_NAME } from "../branding";
import { T3MED } from "./t3med";

const UPSTREAM_NAME = "T3 Code";

type UpdateWordingState = Pick<
  DesktopUpdateState,
  | "status"
  | "availableVersion"
  | "downloadedVersion"
  | "downloadPercent"
  | "errorContext"
  | "message"
>;

/** The one affordance: on the sidebar's button, its tooltip and the About row. */
export const restartToUpdateLabel = (version: string | null): string =>
  version ? `Restart to update to ${version}` : "Restart to update";

/** The About row's button for a downloaded update; upstream's word when the switch is off. */
export const MED_INSTALL_LABEL = T3MED ? "Restart to update" : "Install";

/** A managed policy's sentence names upstream's product; upstream's tests pin it in contracts. */
export const medUpdateWording = <Text extends string | undefined | null>(text: Text): Text =>
  (T3MED && typeof text === "string"
    ? text.replaceAll(UPSTREAM_NAME, APP_BASE_NAME)
    : text) as Text;

/** After upstream's two "Click to retry" sentences, which stay as they are. */
export function medUpdateButtonTooltip(state: UpdateWordingState): string {
  const downloaded = state.downloadedVersion;
  const offered = downloaded ?? state.availableVersion;
  if (state.status === "available") {
    return `Update${offered ? ` ${offered}` : ""} found. It downloads by itself.`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${offered ? ` ${offered}` : ""}${progress}`;
  }
  if (state.status === "downloaded") return restartToUpdateLabel(offered);
  if (state.status === "error") {
    if (state.errorContext === "install" && downloaded) {
      return `Update ${downloaded} could not be installed. Click to try again.`;
    }
    if (downloaded) return restartToUpdateLabel(downloaded);
    return medUpdateWording(state.message) ?? "The update check failed.";
  }
  return "Up to date";
}

/** Asked before every restart into an update. */
export function medRestartQuestion(version: string | null): string {
  return `Restart ${APP_BASE_NAME} to update${version ? ` to ${version}` : ""}?\n\nA chat that is still running will be interrupted. ${APP_BASE_NAME} opens again by itself after a few seconds.`;
}

/** The Version row's description in Settings > About while an update is offered. */
export function medUpdateRowText(state: UpdateWordingState | null, upstream: string): string {
  if (!T3MED || state === null) return upstream;
  if (state.downloadedVersion) {
    return `Update ${state.downloadedVersion} is downloaded. Restart ${APP_BASE_NAME} to install it.`;
  }
  return state.availableVersion ? `Update ${state.availableVersion} is available.` : upstream;
}
