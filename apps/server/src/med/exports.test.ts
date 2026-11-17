import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { MED_FEEDBACK_REFUSAL, refuseFeedbackUpload } from "./exports.ts";

it.effect("refuses to upload a thread to a provider's feedback service, and says why", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-patient-chat");
    const refusal = yield* Effect.flip(refuseFeedbackUpload(threadId));
    assert.strictEqual(refusal._tag, "ProviderUploadFeedbackError");
    assert.strictEqual(refusal.threadId, threadId);
    assert.strictEqual(refusal.cause, MED_FEEDBACK_REFUSAL);
    assert.include(MED_FEEDBACK_REFUSAL, "Nothing was sent");
  }),
);
