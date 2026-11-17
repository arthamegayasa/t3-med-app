// T3 Med: what the release workflow refuses to publish. The texts are the files electron-builder
// writes: `app-update.yml` inside the installer, and `latest.yml` beside it.
import { assert, describe, it } from "vite-plus/test";

import {
  type BuiltInstaller,
  checkAppUpdateYml,
  checkInstallerConfiguration,
  checkLatestYml,
  checkPackagedManifest,
} from "./verify-update-package.ts";

const APP_UPDATE = [
  "provider: github",
  "owner: arthamegayasa",
  "repo: t3-med-app",
  "releaseType: release",
  "updaterCacheDirName: t3med-updater",
  "",
].join("\n");

describe("checkAppUpdateYml", () => {
  it("accepts the fork's GitHub releases and nothing else", () => {
    assert.deepEqual(checkAppUpdateYml(APP_UPDATE), []);
    assert.deepEqual(checkAppUpdateYml(APP_UPDATE.replaceAll("\n", "\r\n")), []);
  });

  it("refuses upstream's feed", () => {
    const upstream = APP_UPDATE.replace("arthamegayasa", "pingdotgg").replace(
      "t3-med-app",
      "t3code",
    );
    const problems = checkAppUpdateYml(upstream);
    assert.include(problems, "app-update.yml: owner is pingdotgg, not arthamegayasa.");
    assert.include(problems, "app-update.yml: repo is t3code, not t3-med-app.");
    assert.include(problems, "app-update.yml names upstream.");
  });

  it("refuses any other source, channel or address", () => {
    for (const [text, key] of [
      [
        APP_UPDATE.replace("provider: github", "provider: generic\nurl: http://localhost:3000"),
        "url",
      ],
      [`${APP_UPDATE}channel: nightly\n`, "channel"],
      [`${APP_UPDATE}host: github.example.com\n`, "host"],
    ] as const) {
      assert.isTrue(
        checkAppUpdateYml(text).some((problem) => problem.includes(`unexpected ${key}`)),
        key,
      );
    }
    assert.isNotEmpty(
      checkAppUpdateYml(APP_UPDATE.replace("releaseType: release", "releaseType: prerelease")),
    );
    assert.isNotEmpty(checkAppUpdateYml(""));
  });

  it("refuses a publisher name, which makes the updater reject an unsigned installer", () => {
    const problems = checkAppUpdateYml(`${APP_UPDATE}publisherName:\n  - T3 Med\n`);
    assert.isTrue(problems.some((problem) => problem.includes("publisherName")));
  });
});

const installer: BuiltInstaller = {
  version: "2026.11.2",
  fileName: "T3-Med-2026.11.2-x64.exe",
  size: 221087304,
  sha512:
    "q3+abc/DEF0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/aa==",
};

const LATEST = [
  "version: 2026.11.2",
  "files:",
  "  - url: T3-Med-2026.11.2-x64.exe",
  `    sha512: ${installer.sha512}`,
  "    size: 221087304",
  "path: T3-Med-2026.11.2-x64.exe",
  `sha512: ${installer.sha512}`,
  "releaseDate: '2026-11-18T01:00:00.000Z'",
  "",
].join("\n");

describe("checkLatestYml", () => {
  it("accepts the metadata of the installer it is published with", () => {
    assert.deepEqual(checkLatestYml(LATEST, installer), []);
  });

  it("refuses another version, another file or another checksum", () => {
    assert.isNotEmpty(checkLatestYml(LATEST, { ...installer, version: "2026.11.3" }));
    assert.isNotEmpty(
      checkLatestYml(LATEST, { ...installer, fileName: "T3-Med-2026.11.3-x64.exe" }),
    );
    assert.isNotEmpty(checkLatestYml(LATEST, { ...installer, sha512: "other==" }));
    assert.isNotEmpty(checkLatestYml(LATEST, { ...installer, size: 1 }));
    assert.isNotEmpty(
      checkLatestYml(LATEST.replace("version: 2026.11.2", "version: 0.1.10"), installer),
    );
  });

  it("refuses a file given by address, or a second file", () => {
    const elsewhere = LATEST.replace(
      "  - url: T3-Med-2026.11.2-x64.exe",
      "  - url: https://github.com/pingdotgg/t3code/releases/download/v0.1.10/T3-Code-0.1.10-x64.exe",
    );
    assert.isNotEmpty(checkLatestYml(elsewhere, installer));
    const two = LATEST.replace("path:", "  - url: T3-Med-2026.11.2-arm64.exe\npath:");
    assert.isNotEmpty(checkLatestYml(two, installer));
  });
});

describe("checkPackagedManifest", () => {
  const manifest = (fields: object) =>
    JSON.stringify({ name: "t3med", version: "2026.11.3", main: "boot.cjs", ...fields });

  it("accepts the app that carries the version being released", () => {
    assert.deepEqual(checkPackagedManifest(manifest({}), "2026.11.3"), []);
  });

  it("refuses an app that would report another version than its tag", () => {
    assert.deepEqual(checkPackagedManifest(manifest({ version: "0.1.9" }), "2026.11.3"), [
      "The packaged app is version 0.1.9, not 2026.11.3.",
    ]);
    assert.deepEqual(checkPackagedManifest(manifest({ name: "t3code" }), "2026.11.3"), [
      "The packaged app is named t3code, not t3med.",
    ]);
  });
});

describe("checkInstallerConfiguration", () => {
  const fork = { provider: "github", owner: "arthamegayasa", repo: "t3-med-app" };
  const stage = (build: object, version = "2026.11.3") =>
    JSON.stringify({
      name: "t3med",
      version,
      build: {
        appId: "com.arthamegayasa.t3med",
        publish: [{ ...fork, releaseType: "release" }],
        nsis: { differentialPackage: true, deleteAppDataOnUninstall: false },
        ...build,
      },
    });

  it("accepts the configuration the fork's packaging writes", () => {
    assert.deepEqual(checkInstallerConfiguration(stage({}), "2026.11.3"), []);
  });

  it("refuses an installer whose uninstall would delete app data", () => {
    for (const nsis of [{ deleteAppDataOnUninstall: true }, { differentialPackage: true }]) {
      const problems = checkInstallerConfiguration(stage({ nsis }), "2026.11.3");
      assert.lengthOf(problems, 1);
      assert.include(problems[0], "an uninstall would delete app data");
    }
  });

  it("refuses any feed but the fork's, a second feed, another app id and another version", () => {
    const upstream = { provider: "github", owner: "pingdotgg", repo: "t3code" };
    for (const publish of [
      [{ ...upstream, releaseType: "release" }],
      [
        { ...fork, releaseType: "release" },
        { provider: "generic", url: "http://localhost:3000" },
      ],
      [{ ...fork, releaseType: "prerelease" }],
      undefined,
    ]) {
      assert.lengthOf(checkInstallerConfiguration(stage({ publish }), "2026.11.3"), 1);
    }
    assert.deepEqual(
      checkInstallerConfiguration(stage({ appId: "com.t3tools.t3code" }), "2026.11.3"),
      ["The installer's appId is com.t3tools.t3code, not com.arthamegayasa.t3med."],
    );
    assert.deepEqual(checkInstallerConfiguration(stage({}, "0.1.9"), "2026.11.3"), [
      "The installer was built as version 0.1.9, not 2026.11.3.",
    ]);
  });
});
