/**
 * T3 Med: a patient chat never leaves this machine by a provider's feedback upload. Codex's
 * `/feedback` sends the thread and Codex's logs to OpenAI; the server refuses it for every
 * client, whatever its menu offers. Typed `string` so an empty text gives upstream's upload back.
 */
import { ProviderUploadFeedbackError, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export const MED_FEEDBACK_REFUSAL: string =
  "T3 Med does not send a chat to a provider's feedback service: it can hold patient data. Nothing was sent.";

/** Fails a feedback upload before any thread is read; `ws.ts` runs it first in its handler. */
export const refuseFeedbackUpload = (
  threadId: ThreadId,
): Effect.Effect<void, ProviderUploadFeedbackError> =>
  MED_FEEDBACK_REFUSAL === ""
    ? Effect.void
    : Effect.fail(new ProviderUploadFeedbackError({ threadId, cause: MED_FEEDBACK_REFUSAL }));
