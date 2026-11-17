// T3 Med: an update downloads by itself and installs when the app is closed; the feed and the
// track are the fork's whatever a variable, a policy or an old settings file says.
// @effect-diagnostics nodeBuiltinImport:off - Reads two upstream source files as text.
import * as NodeFS from "node:fs";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopUpdatePolicy from "../updates/DesktopUpdatePolicy.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { flushCallbacks, makeHarness } from "../updates/updatesTestHarness.ts";
import {
  medDesktopSettings,
  medShouldDownload,
  medTakesMockFeed,
  medUpdatePolicy,
  medUpdates,
} from "./updates.ts";

/** Upstream's updater on its own test harness, wrapped as `main.ts` wraps it. */
const configured = (harness: ReturnType<typeof makeHarness>) =>
  Effect.gen(function* () {
    const installsOnQuit: Array<boolean> = [];
    const updates = medUpdates(yield* DesktopUpdates.DesktopUpdates, {
      setAutoInstallOnAppQuit: (value) => Effect.sync(() => void installsOnQuit.push(value)),
    });
    yield* updates.configure;
    return { updates, installsOnQuit, harness };
  });

const settle = Effect.repeat(flushCallbacks, { times: 20 });
/** A found update, and the moment the background download leaves upstream's own restart. */
const offered = settle.pipe(Effect.andThen(TestClock.adjust("2 seconds")), Effect.andThen(settle));

describe("a found update", () => {
  it.effect("is downloaded with no click, and installs when the app is closed", () => {
    const harness = makeHarness({ appVersion: "2026.11.1", platform: "win32" });
    return Effect.scoped(
      Effect.gen(function* () {
        const { updates, installsOnQuit } = yield* configured(harness);
        // The last word: upstream's own configure turns it off first.
        assert.deepEqual(installsOnQuit, [true]);

        harness.emit("update-available", { version: "2026.11.2" });
        yield* settle;
        assert.equal(harness.downloadCount(), 0);
        yield* offered;
        assert.equal(harness.downloadCount(), 1);

        harness.emit("update-downloaded", { version: "2026.11.2" });
        yield* settle;
        const state = yield* updates.getState;
        assert.equal(state.status, "downloaded");
        assert.equal(state.downloadedVersion, "2026.11.2");
        assert.equal(harness.downloadCount(), 1);
        assert.equal(harness.quitAndInstalls(), 0);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("is tried again an hour after a download that failed, not before", () => {
    const harness = makeHarness({
      appVersion: "2026.11.1",
      platform: "win32",
      downloadUpdate: Effect.fail(
        new ElectronUpdater.ElectronUpdaterDownloadUpdateError({ channel: null, cause: "offline" }),
      ),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const { updates } = yield* configured(harness);
        harness.emit("update-available", { version: "2026.11.2" });
        yield* settle;
        assert.equal(harness.downloadCount(), 0);
        yield* offered;
        assert.equal(harness.downloadCount(), 1);
        // Still offered, so the update button can retry at once.
        assert.equal((yield* updates.getState).status, "available");

        yield* TestClock.adjust("30 minutes");
        yield* offered;
        assert.equal(harness.downloadCount(), 1);

        yield* TestClock.adjust("30 minutes");
        yield* offered;
        assert.equal(harness.downloadCount(), 2);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("leaves a newer release found at the restart to upstream's own download", () => {
    let newerPublished = false;
    const harness: ReturnType<typeof makeHarness> = makeHarness({
      appVersion: "2026.11.1",
      platform: "win32",
      checkForUpdates: Effect.sync(() => {
        if (newerPublished) harness.emit("update-available", { version: "2026.11.3" });
      }),
      downloadUpdate: Effect.sync(() => {
        if (newerPublished) harness.emit("update-downloaded", { version: "2026.11.3" });
      }),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const { updates } = yield* configured(harness);
        harness.emit("update-available", { version: "2026.11.2" });
        yield* offered;
        harness.emit("update-downloaded", { version: "2026.11.2" });
        yield* settle;
        assert.equal(harness.downloadCount(), 1);

        // The doctor restarts hours later; upstream's install checks again and finds 2026.11.3.
        newerPublished = true;
        const result = yield* updates.install;
        yield* offered;
        assert.isTrue(result.accepted);
        assert.equal(harness.downloadCount(), 2);
        assert.equal(harness.quitAndInstalls(), 1);
        assert.equal((yield* updates.getState).downloadedVersion, "2026.11.3");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it("is not downloaded twice, nor while nothing is offered", () => {
    const offered = { status: "available", availableVersion: "2026.11.2" } as const;
    const tried = { version: "2026.11.2", atMillis: 1_000 };
    assert.isTrue(medShouldDownload(offered, null, 0));
    assert.isFalse(medShouldDownload(offered, tried, 1_000 + 59 * 60 * 1000));
    assert.isTrue(medShouldDownload({ ...offered, availableVersion: "2026.11.3" }, tried, 2_000));
    assert.isFalse(medShouldDownload({ ...offered, status: "downloaded" }, null, 0));
    assert.isFalse(medShouldDownload({ status: "up-to-date", availableVersion: null }, null, 0));
  });
});

describe("where an update comes from", () => {
  it("is never the mock feed in a package that carries its own", () => {
    assert.isFalse(medTakesMockFeed(true, Option.some({ provider: "github" })));
    // Upstream's test harness, and a development run: no packaged feed.
    assert.isTrue(medTakesMockFeed(true, Option.none()));
    assert.isFalse(medTakesMockFeed(false, Option.none()));
    const updates = NodeFS.readFileSync(
      new URL("../updates/DesktopUpdates.ts", import.meta.url),
      "utf8",
    );
    assert.include(updates, "if (medTakesMockFeed(mockUpdates, appUpdateYmlConfig)) {");
    assert.notInclude(updates, "if (mockUpdates) {");
  });

  it("is the stable track whatever the settings file says", () => {
    const saved: DesktopAppSettings.DesktopSettings = {
      ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: true,
    };
    assert.equal(medDesktopSettings(saved).updateChannel, "latest");
    // What was saved is read differently, not rewritten.
    assert.isTrue(medDesktopSettings(saved).updateChannelConfiguredByUser);
    assert.strictEqual(
      medDesktopSettings(DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS),
      DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
    );
  });

  it("says T3 Med in a managed policy's messages", () => {
    assert.strictEqual(
      medUpdatePolicy(DesktopUpdatePolicy.unmanagedUpdatePolicy),
      DesktopUpdatePolicy.unmanagedUpdatePolicy,
    );
    assert.equal(
      medUpdatePolicy({
        ...DesktopUpdatePolicy.unmanagedUpdatePolicy,
        mode: "off",
        message: "Example Clinic manages T3 Code updates.",
      }).message,
      "Example Clinic manages T3 Med updates.",
    );
  });

  it("wraps upstream's services where the app is put together", () => {
    const main = NodeFS.readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    assert.include(main, "layerMedSettings(DesktopAppSettings.layer),");
    assert.include(main, "layerMedUpdates(DesktopUpdates.layer).pipe(");
    assert.include(main, "Layer.provide(layerMedUpdatePolicy(DesktopUpdatePolicy.layer)),");
  });
});
