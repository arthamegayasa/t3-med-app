// T3 Med: the package electron-builder is given must be the fork's, updated from the fork only.
import { assert, describe, it } from "vite-plus/test";

import { medStagePackageJson } from "./desktop-package.ts";

const upstreamStage = {
  name: "t3code",
  version: "0.1.9",
  description: "T3 Code is an open-source desktop app for coding agents.",
  homepage: "https://t3.codes",
  author: "T3 Tools",
  main: "apps/desktop/dist-electron/boot.cjs",
  build: {
    appId: "com.t3tools.t3code",
    productName: "T3 Code (Beta)",
    artifactName: "T3-Code-${version}-${arch}.${ext}",
    publish: [{ provider: "github", owner: "pingdotgg", repo: "t3code", releaseType: "release" }],
    nsis: { differentialPackage: true, include: "apps/desktop/resources/installer.nsh" },
    win: { target: ["nsis"], icon: "icon.ico" },
  } as Record<string, unknown>,
};

describe("medStagePackageJson", () => {
  const stage = medStagePackageJson(upstreamStage);

  it("gives the package the fork's name, app id and installer name", () => {
    assert.equal(stage.name, "t3med");
    assert.equal(stage.build.appId, "com.arthamegayasa.t3med");
    assert.equal(stage.build.productName, "T3 Med");
    assert.equal(stage.build.artifactName, "T3-Med-${version}-${arch}.${ext}");
  });

  it("replaces every update feed with the fork's own releases", () => {
    assert.deepEqual(stage.build.publish, [
      { provider: "github", owner: "arthamegayasa", repo: "t3-med-app", releaseType: "release" },
    ]);
    assert.notInclude(JSON.stringify(stage), "pingdotgg");
  });

  it("gives the fork's feed whatever feed upstream's script resolved", () => {
    const feeds: ReadonlyArray<unknown> = [
      null,
      undefined,
      [{ provider: "generic", url: "http://localhost:3000" }],
      [{ provider: "github", owner: "pingdotgg", repo: "t3code", channel: "nightly" }],
    ];
    for (const publish of feeds) {
      const built = medStagePackageJson({
        ...upstreamStage,
        build: { ...upstreamStage.build, publish },
      });
      assert.deepEqual(built.build.publish, stage.build.publish);
    }
  });

  it("keeps the rest of upstream's build configuration", () => {
    assert.equal(stage.version, "0.1.9");
    assert.equal(stage.main, upstreamStage.main);
    assert.deepEqual(stage.build.win, upstreamStage.build.win);
    assert.deepInclude(stage.build.nsis as object, upstreamStage.build.nsis as object);
  });

  it("never lets an uninstall delete the app's data, whatever upstream configures", () => {
    assert.propertyVal(stage.build.nsis, "deleteAppDataOnUninstall", false);
    const built = medStagePackageJson({
      ...upstreamStage,
      build: { ...upstreamStage.build, nsis: { deleteAppDataOnUninstall: true } },
    });
    assert.propertyVal(built.build.nsis, "deleteAppDataOnUninstall", false);
    // A per-user install: no administrator, so an update installs without a prompt.
    assert.notProperty(stage.build.nsis, "perMachine");
    assert.deepEqual(stage.build.win, upstreamStage.build.win);
  });
});
