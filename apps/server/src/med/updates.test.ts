// @effect-diagnostics nodeBuiltinImport:off -- The CLI under test needs a real, empty T3 home on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";

import { makeCli } from "../binCli.ts";
import { ServerSelfUpdate } from "../cloud/selfUpdate.ts";
import { layerNoSelfUpdate, MED_UPDATE_REFUSAL } from "./updates.ts";

const temporaryHome = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3med-update-"))),
  (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
);

it.live("t3 update refuses, and says how T3 Med is updated", () =>
  Effect.gen(function* () {
    const baseDir = yield* temporaryHome;
    const error = yield* Command.runWith(makeCli(), { version: "0.0.0" })([
      "update",
      "--yes",
      "--base-dir",
      baseDir,
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          NodeCrypto.layer,
          NetService.layer,
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
        ),
      ),
      Effect.flip,
    );
    assert.strictEqual(error.message, MED_UPDATE_REFUSAL);
    // It says how each of the two ways of running T3 Med is updated.
    // The window hides the menu bar on Windows, so the check a doctor can reach is in Settings.
    assert.include(MED_UPDATE_REFUSAL, "Settings > About > Check for Updates");
    assert.notInclude(MED_UPDATE_REFUSAL, "Help >");
    assert.include(MED_UPDATE_REFUSAL, "start-t3-med.cmd");
    assert.include(MED_UPDATE_REFUSAL, "Nothing was downloaded or changed.");
    // Refused before anything is looked up or written: the home stays empty.
    assert.deepStrictEqual(yield* Effect.promise(() => NodeFSP.readdir(baseDir)), []);
  }).pipe(Effect.scoped),
);

it.effect("the server's own update is refused for every client that asks", () =>
  Effect.gen(function* () {
    const selfUpdate = yield* ServerSelfUpdate;
    const refused = yield* selfUpdate.update({ targetVersion: "0.1.10" }).pipe(Effect.flip);
    assert.strictEqual(refused.reason, MED_UPDATE_REFUSAL);
    const commit = yield* selfUpdate.commitDesktopUpdate("request-1").pipe(Effect.flip);
    assert.strictEqual(commit.reason, MED_UPDATE_REFUSAL);
  }).pipe(Effect.provide(layerNoSelfUpdate)),
);
