import { describe, expect, it } from "vite-plus/test";

import {
  MED_SKIPPED_TESTS,
  type MedSkippedTest,
  skipReasonOf,
  skippedTestsOfFile,
  staleSkips,
} from "./medSkippedTests";

// Every test file under `src`, as Vite sees it; nothing is loaded.
const testFiles = new Set(
  Object.keys(import.meta.glob("../**/*.test.{ts,tsx}")).map((path) => path.replace("../", "src/")),
);

const list: ReadonlyArray<MedSkippedTest> = [
  { file: "src/a.test.ts", name: "group > case", reason: "one case" },
  { file: "src/a.test.ts", name: "whole group", reason: "a describe" },
  { file: "src/a.test.ts", name: /^at \d+px$/, reason: "each" },
  { file: "src/b.test.ts", name: "case", reason: "another file" },
];

describe("the list of upstream tests T3 Med skips", () => {
  it("names only test files that exist, each entry with a reason", () => {
    expect(MED_SKIPPED_TESTS.length).toBeGreaterThan(0);
    for (const entry of MED_SKIPPED_TESTS) {
      expect(testFiles.has(entry.file), entry.file).toBe(true);
      expect(entry.file.startsWith("src/med/"), entry.file).toBe(false);
      expect(entry.reason.length, String(entry.name)).toBeGreaterThan(10);
    }
  });

  it("finds a file's entries by its absolute path, on Windows too", () => {
    expect(skippedTestsOfFile("D:\app\apps\web\src\a.test.ts", list)).toHaveLength(3);
    expect(skippedTestsOfFile("/app/apps/web/src/b.test.ts", list)).toHaveLength(1);
    // A file whose name only ends the same is another file.
    expect(skippedTestsOfFile("/app/apps/web/src/extra-a.test.ts", list)).toEqual([]);
  });

  it("skips a case by its full name, a describe by its own, and an each by a pattern", () => {
    const entries = skippedTestsOfFile("src/a.test.ts", list);
    expect(skipReasonOf(entries, "group > case")).toBe("one case");
    expect(skipReasonOf(entries, "whole group > anything > under it")).toBe("a describe");
    expect(skipReasonOf(entries, "at 390px")).toBe("each");
    // The same words in another group, or a longer name, is another test.
    expect(skipReasonOf(entries, "other > case")).toBeUndefined();
    expect(skipReasonOf(entries, "group > case two")).toBeUndefined();
    expect(skipReasonOf(entries, "whole grouping > case")).toBeUndefined();
  });

  it("reports the entries that name no test, as after an upstream rename", () => {
    const entries = skippedTestsOfFile("src/a.test.ts", list);
    expect(staleSkips(entries, ["group > case", "whole group > x", "at 1280px"])).toEqual([]);
    expect(
      staleSkips(entries, ["group > renamed case", "whole group > x"]).map((entry) => entry.reason),
    ).toEqual(["one case", "each"]);
  });
});
