import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ManagedPolicyDocument } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import { MED_DEFAULT_RUNTIME_MODE, medPolicy } from "./settingsDefaults.ts";

// The settings service over a policy built as the server builds it: upstream's, then T3 Med's.
const layerSettings = (document?: ManagedPolicyDocument) =>
  ServerSettings.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(
      Layer.effect(
        ManagedPolicy.ManagedPolicy,
        ManagedPolicy.fromDocument("/test/policy.json", document).pipe(Effect.map(medPolicy)),
      ),
    ),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3med-settings-test-" })),
    ),
  );

const storedMode = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(config.settingsPath))) return "no file";
  const stored = JSON.parse(yield* fs.readFileString(config.settingsPath));
  return stored.defaultRuntimeMode ?? "not written";
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "a new thread's permission mode",
  (it) => {
    it.effect("is Supervised until the doctor chooses, and is then what the doctor chose", () =>
      Effect.gen(function* () {
        // Upstream's own default, which this is laid over, is Full access.
        assert.strictEqual(DEFAULT_SERVER_SETTINGS.defaultRuntimeMode, "full-access");
        assert.strictEqual(MED_DEFAULT_RUNTIME_MODE, "approval-required");
        const service = yield* ServerSettings.ServerSettingsService;
        assert.strictEqual((yield* service.getSettings).defaultRuntimeMode, "approval-required");

        // Full access is the doctor's choice, so it is written down and survives a restart.
        const chosen = yield* service.updateSettings({ defaultRuntimeMode: "full-access" });
        assert.strictEqual(chosen.defaultRuntimeMode, "full-access");
        assert.strictEqual(yield* storedMode, "full-access");

        // Supervised is the default again, and a default is never written.
        const back = yield* service.updateSettings({ defaultRuntimeMode: "approval-required" });
        assert.strictEqual(back.defaultRuntimeMode, "approval-required");
        assert.strictEqual(yield* storedMode, "not written");
      }).pipe(Effect.provide(layerSettings())),
    );

    it.effect("reads a settings file that says Full access, and one that says nothing", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(config.settingsPath, `{ "defaultRuntimeMode": "full-access" }`);
        const service = yield* ServerSettings.ServerSettingsService;
        assert.strictEqual((yield* service.getSettings).defaultRuntimeMode, "full-access");
      }).pipe(Effect.provide(layerSettings())),
    );

    it.effect("starts Supervised from a settings file written before the default changed", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(config.settingsPath, `{ "enableAssistantStreaming": true }`);
        const service = yield* ServerSettings.ServerSettingsService;
        assert.strictEqual((yield* service.getSettings).defaultRuntimeMode, "approval-required");
      }).pipe(Effect.provide(layerSettings())),
    );

    it.effect("gives no agent a browser until a settings file says so", () =>
      Effect.gen(function* () {
        assert.isTrue(DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess);
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const service = yield* ServerSettings.ServerSettingsService;
        assert.isFalse((yield* service.getSettings).enableAgentBrowserAccess);
        // Upstream's value is a choice here, so it is written down.
        const on = yield* service.updateSettings({ enableAgentBrowserAccess: true });
        assert.isTrue(on.enableAgentBrowserAccess);
        const stored = JSON.parse(yield* fs.readFileString(config.settingsPath));
        assert.isTrue(stored.enableAgentBrowserAccess);
      }).pipe(Effect.provide(layerSettings())),
    );

    it.effect("leaves a managed policy's own default alone", () =>
      Effect.gen(function* () {
        const service = yield* ServerSettings.ServerSettingsService;
        const settings = yield* service.getSettings;
        assert.strictEqual(settings.defaultRuntimeMode, "auto-accept-edits");
        // The policy said nothing of the browser, so T3 Med's default still holds there.
        assert.isFalse(settings.enableAgentBrowserAccess);
      }).pipe(
        Effect.provide(
          layerSettings({
            schemaVersion: 1,
            organization: "Clinic",
            settings: { defaultRuntimeMode: { value: "auto-accept-edits", locked: false } },
          }),
        ),
      ),
    );

    it.effect("is the server's own policy layer that carries it", () =>
      Effect.gen(function* () {
        const policy = yield* ManagedPolicy.ManagedPolicy;
        assert.strictEqual(policy.settings.defaults.defaultRuntimeMode, "approval-required");
      }).pipe(Effect.provide(ManagedPolicy.layer)),
    );
  },
);
