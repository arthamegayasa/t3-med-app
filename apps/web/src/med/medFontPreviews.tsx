/**
 * T3 Med: the samples under the Typography settings. Upstream's are a prompt about a flaky test,
 * a diff and a terminal; a patient workspace shows none, since the page itself is set in the font.
 */
import type { ReactNode } from "react";

import * as Upstream from "../components/settings/SettingsFontPreviews";
import { T3MED } from "./t3med";

function NoPreview() {
  return null;
}

export const PromptFontPreview: () => ReactNode = T3MED ? NoPreview : Upstream.PromptFontPreview;
export const CodeFontPreview: () => ReactNode = T3MED ? NoPreview : Upstream.CodeFontPreview;
export const TerminalFontPreview: (props: { family: string; size: number }) => ReactNode = T3MED
  ? NoPreview
  : Upstream.TerminalFontPreview;
