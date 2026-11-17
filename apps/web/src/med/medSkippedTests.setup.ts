/**
 * T3 Med: a Vitest setup file of the unit and browser projects (`vite.config.ts`). It skips the
 * upstream tests listed in `medSkippedTests.ts`, and fails a file the list is stale for.
 */
import { beforeAll, beforeEach } from "vite-plus/test";

import { skipReasonOf, skippedTestsOfFile, staleSkips } from "./medSkippedTests";

interface TaskLike {
  readonly type: string;
  readonly fullTestName?: string;
  readonly tasks?: ReadonlyArray<TaskLike>;
}

const testNames = (task: TaskLike): ReadonlyArray<string> =>
  task.type === "test"
    ? [task.fullTestName ?? ""]
    : (task.tasks ?? []).flatMap((child) => testNames(child));

// oxlint-disable-next-line no-empty-pattern -- Vitest reads the first parameter as a fixture list.
beforeAll(({}, file) => {
  const entries = skippedTestsOfFile(file.file.filepath);
  if (entries.length === 0) return;
  const stale = staleSkips(entries, testNames(file));
  if (stale.length > 0) {
    throw new Error(
      `medSkippedTests.ts names tests that ${file.file.name} no longer has: ${stale
        .map((entry) => String(entry.name))
        .join("; ")}. Upstream renamed or removed them: update the list.`,
    );
  }
});

beforeEach((context) => {
  const entries = skippedTestsOfFile(context.task.file.filepath);
  if (entries.length === 0) return;
  const reason = skipReasonOf(entries, context.task.fullTestName);
  if (reason !== undefined) context.skip(`T3 Med: ${reason}`);
});
