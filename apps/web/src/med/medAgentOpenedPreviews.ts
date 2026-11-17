/**
 * T3 Med: what an agent opens on its own. Upstream floats a browser or a device over the chat
 * of whichever thread's agent opened one; a patient chat follows neither, so nothing appears
 * and no browser tab is added to the panel. `appInit.tsx` starts this instead of upstream's.
 */
import * as Upstream from "../components/preview/agentOpenedPreviews";
import { T3MED } from "./t3med";

const followNothing = () => () => {};

export const startAgentOpenedPreviews: typeof Upstream.startAgentOpenedPreviews = T3MED
  ? followNothing
  : Upstream.startAgentOpenedPreviews;
