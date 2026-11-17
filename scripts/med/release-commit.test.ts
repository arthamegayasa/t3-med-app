// T3 Med: only what is on `med` is released.
import { assert, describe, it } from "vite-plus/test";

import { releaseCommitProblem } from "./release-commit.ts";

describe("releaseCommitProblem", () => {
  it("lets a tag on med, and a manual run of med, build", () => {
    assert.isNull(
      releaseCommitProblem({ event: "push", ref: "refs/tags/med-v2026.11.3", onMed: true }),
    );
    assert.isNull(
      releaseCommitProblem({ event: "workflow_dispatch", ref: "refs/heads/med", onMed: true }),
    );
  });

  it("refuses a tag whose commit is not on med", () => {
    const problem = releaseCommitProblem({
      event: "push",
      ref: "refs/tags/med-v2026.11.3",
      onMed: false,
    });
    assert.include(problem, "is not on med");
  });

  it("refuses a manual run started anywhere but on med, even at a commit med has", () => {
    for (const ref of ["refs/heads/med-updates", "refs/tags/med-v2026.11.3"]) {
      const problem = releaseCommitProblem({ event: "workflow_dispatch", ref, onMed: true });
      assert.include(problem, "A manual run builds med.", ref);
    }
  });
});
