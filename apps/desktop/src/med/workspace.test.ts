// T3 Med: which folder the desktop app opens, and how it is handed to the server.
import { assert, describe, it } from "vite-plus/test";

import {
  MED_DEFAULT_WORKSPACE,
  parseMedWorkspaceSetting,
  resolveMedWorkspace,
  withMedWorkspace,
} from "./workspace.ts";

describe("resolveMedWorkspace", () => {
  it("prefers the environment, then the settings file, then the default", () => {
    const settingsFile = JSON.stringify({ workspace: "E:\\Clinic" });
    assert.equal(resolveMedWorkspace({ env: " F:\\Other ", settingsFile }), "F:\\Other");
    assert.equal(resolveMedWorkspace({ env: undefined, settingsFile }), "E:\\Clinic");
    assert.equal(resolveMedWorkspace({ env: "  ", settingsFile }), "E:\\Clinic");
    assert.equal(
      resolveMedWorkspace({ env: undefined, settingsFile: undefined }),
      MED_DEFAULT_WORKSPACE,
    );
  });

  it("falls back to the default when the file names no folder", () => {
    for (const raw of ["", "not json", "[]", "{}", '{"workspace":""}', '{"workspace":7}']) {
      assert.equal(parseMedWorkspaceSetting(raw), undefined, raw);
      assert.equal(
        resolveMedWorkspace({ env: undefined, settingsFile: raw }),
        MED_DEFAULT_WORKSPACE,
      );
    }
  });
});

describe("withMedWorkspace", () => {
  const config = { args: ["bin.mjs", "--bootstrap-fd", "3"] };

  it("passes the server the flag and folder that start-t3-med.cmd passes", () => {
    assert.deepEqual(withMedWorkspace(config, "D:\\T3 Projects\\T3 Med").args, [
      "bin.mjs",
      "--bootstrap-fd",
      "3",
      "--auto-bootstrap-project-from-cwd",
      "D:\\T3 Projects\\T3 Med",
    ]);
  });

  it("leaves the start alone without a workspace", () => {
    assert.equal(withMedWorkspace(config, undefined), config);
  });
});
