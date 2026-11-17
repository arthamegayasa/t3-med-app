// T3 Med: the package electron-builder is given must be the fork's, and must not be updatable.
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

  it("removes every update feed, upstream's included", () => {
    assert.isNull(stage.build.publish);
    assert.notInclude(JSON.stringify(stage), "pingdotgg");
  });

  it("keeps the rest of upstream's build configuration", () => {
    assert.equal(stage.version, "0.1.9");
    assert.equal(stage.main, upstreamStage.main);
    assert.deepEqual(stage.build.nsis, upstreamStage.build.nsis);
    assert.deepEqual(stage.build.win, upstreamStage.build.win);
  });
});
