/**
 * T3 Med: where the desktop updater differs from upstream's. An update downloads by itself and
 * installs when the app is next closed, the feed is the packaged one whatever the environment
 * says, and a saved update track is read as stable. Each difference wraps one of upstream's
 * services where `main.ts` builds it; `DesktopUpdates.ts` stays upstream's. See FORK.md, Updates.
 */
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopUpdatePolicy from "../updates/DesktopUpdatePolicy.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { medUpdateWording } from "./updateWording.ts";

// Typed `boolean` so `false` gives upstream's behaviour back.
/** An available update downloads without a click; the doctor is asked only about the restart. */
const MED_DOWNLOADS_UPDATES: boolean = true;

/**
 * A downloaded update that was not installed from the app installs when the app is closed.
 * electron-updater starts the per-user installer silently once Electron has quit, by which time
 * upstream's shutdown has stopped the backend. The app is not started again afterwards.
 */
const MED_INSTALLS_ON_QUIT: boolean = true;

const DOWNLOAD_RETRY_MILLIS = 60 * 60 * 1000;
const DOWNLOAD_RETRY_POLL = "30 minutes";
const DOWNLOAD_SETTLE = "2 seconds";

export interface MedDownloadAttempt {
  readonly version: string;
  readonly atMillis: number;
}

/** Each version is tried once, and again an hour after a download that did not finish. */
export function medShouldDownload(
  state: Pick<DesktopUpdateState, "status" | "availableVersion">,
  last: MedDownloadAttempt | null,
  nowMillis: number,
): boolean {
  if (!MED_DOWNLOADS_UPDATES) return false;
  if (state.status !== "available" || state.availableVersion === null) return false;
  if (last === null || last.version !== state.availableVersion) return true;
  return nowMillis - last.atMillis >= DOWNLOAD_RETRY_MILLIS;
}

/**
 * `T3CODE_DESKTOP_MOCK_UPDATES` points the updater at a plain-HTTP feed on localhost. Any process
 * of the user can set it, so a package that carries its own feed, as every T3 Med package does,
 * never takes it.
 */
export const medTakesMockFeed = (requested: boolean, packagedFeed: Option.Option<unknown>) =>
  requested && Option.isNone(packagedFeed);

/** T3 Med has one track. A track saved by an older build or by hand would find no release. */
export const medDesktopSettings = (
  settings: DesktopAppSettings.DesktopSettings,
): DesktopAppSettings.DesktopSettings =>
  settings.updateChannel === "latest" ? settings : { ...settings, updateChannel: "latest" };

export const medUpdatePolicy = (
  policy: DesktopUpdatePolicy.UpdatePolicy,
): DesktopUpdatePolicy.UpdatePolicy =>
  policy.message === null ? policy : { ...policy, message: medUpdateWording(policy.message) };

const { logInfo } = DesktopObservability.makeComponentLogger("desktop-updater");

type Updates = DesktopUpdates.DesktopUpdates["Service"];
type Updater = Pick<ElectronUpdater.ElectronUpdater["Service"], "setAutoInstallOnAppQuit">;

// A span of its own: the desktop trace file records a log line only inside one.
const downloadInBackground = Effect.fn("desktop.med.downloadInBackground")(function* (
  updates: Updates,
  version: string,
) {
  yield* Effect.annotateCurrentSpan({ version });
  yield* logInfo("downloading update in the background", { version });
  yield* updates.download;
});

const startBackgroundDownloads = Effect.fn("desktop.med.startBackgroundDownloads")(function* (
  updates: Updates,
): Effect.fn.Return<void, never, Scope.Scope> {
  const lastAttempt = yield* Ref.make<MedDownloadAttempt | null>(null);
  const downloadWhenOffered = Effect.gen(function* () {
    if ((yield* updates.getState).status !== "available") return;
    // Upstream's restart looks for a newer release first and downloads it itself: it goes first.
    yield* Effect.sleep(DOWNLOAD_SETTLE);
    const state = yield* updates.getState;
    const now = yield* Clock.currentTimeMillis;
    const version = yield* Ref.modify(lastAttempt, (last) =>
      state.availableVersion !== null && medShouldDownload(state, last, now)
        ? [state.availableVersion, { version: state.availableVersion, atMillis: now }]
        : [null, last],
    );
    if (version !== null) yield* downloadInBackground(updates, version);
  });
  const { changes } = yield* updates.subscribe;
  yield* Stream.runForEach(changes, () => downloadWhenOffered).pipe(Effect.forkScoped);
  yield* Effect.sleep(DOWNLOAD_RETRY_POLL).pipe(
    Effect.andThen(downloadWhenOffered),
    Effect.forever,
    Effect.forkScoped,
  );
});

/** Upstream's update service, with T3 Med's two behaviours started when it is configured. */
export const medUpdates = (updates: Updates, updater: Updater): Updates => ({
  ...updates,
  configure: updates.configure.pipe(
    Effect.andThen(updates.getState),
    Effect.flatMap((state) =>
      // Upstream configures nothing when updates are off, as in a build made from source.
      state.enabled
        ? updater
            .setAutoInstallOnAppQuit(MED_INSTALLS_ON_QUIT)
            .pipe(Effect.andThen(startBackgroundDownloads(updates)))
        : Effect.void,
    ),
  ),
});

export const layerMedUpdates = <E, R>(upstream: Layer.Layer<DesktopUpdates.DesktopUpdates, E, R>) =>
  Layer.effect(
    DesktopUpdates.DesktopUpdates,
    Effect.gen(function* () {
      return medUpdates(
        yield* DesktopUpdates.DesktopUpdates,
        yield* ElectronUpdater.ElectronUpdater,
      );
    }),
  ).pipe(Layer.provide(upstream));

export const layerMedUpdatePolicy = <E, R>(
  upstream: Layer.Layer<DesktopUpdatePolicy.DesktopUpdatePolicy, E, R>,
) =>
  Layer.effect(
    DesktopUpdatePolicy.DesktopUpdatePolicy,
    Effect.gen(function* () {
      return medUpdatePolicy(yield* DesktopUpdatePolicy.DesktopUpdatePolicy);
    }),
  ).pipe(Layer.provide(upstream));

export const layerMedSettings = <E, R>(
  upstream: Layer.Layer<DesktopAppSettings.DesktopAppSettings, E, R>,
) =>
  Layer.effect(
    DesktopAppSettings.DesktopAppSettings,
    Effect.gen(function* () {
      const settings = yield* DesktopAppSettings.DesktopAppSettings;
      return {
        ...settings,
        get: Effect.map(settings.get, medDesktopSettings),
        load: Effect.map(settings.load, medDesktopSettings),
      };
    }),
  ).pipe(Layer.provide(upstream));
