import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { createInitialDesktopUpdateState } from "../updates/updateMachine.ts";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

// Upstream's own menu, configured as `DesktopApplicationMenu.test.ts` configures it: only the
// template it hands Electron is read, so every other service is a stand-in.
const unused = <Service>(name: string): Service =>
  new Proxy(
    {},
    {
      get: (_target, key) => Effect.die(`${name}.${String(key)} is not part of building the menu`),
    },
  ) as Service;

interface MenuStandIns {
  readonly updates?: DesktopUpdates.DesktopUpdates["Service"];
  readonly dialog?: ElectronDialog.ElectronDialog["Service"];
}

const menuTemplateWith = Effect.fn(function* (standIns: MenuStandIns) {
  const template = yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
  yield* Effect.gen(function* () {
    const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
    yield* menu.configure;
  }).pipe(
    Effect.provide(
      DesktopApplicationMenu.layer.pipe(
        Layer.provideMerge(
          Layer.succeed(ElectronMenu.ElectronMenu, {
            setApplicationMenu: (items) => Deferred.succeed(template, items).pipe(Effect.asVoid),
            popupTemplate: () => Effect.void,
            showContextMenu: () => Effect.succeedNone,
          } satisfies ElectronMenu.ElectronMenu["Service"]),
        ),
        Layer.provideMerge(
          Layer.succeed(DesktopWindow.DesktopWindow, {
            ...unused<DesktopWindow.DesktopWindow["Service"]>("DesktopWindow"),
            activate: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(
            DesktopUpdates.DesktopUpdates,
            standIns.updates ?? unused("DesktopUpdates"),
          ),
        ),
        Layer.provideMerge(
          Layer.succeed(ElectronDialog.ElectronDialog, standIns.dialog ?? unused("ElectronDialog")),
        ),
        Layer.provideMerge(
          Layer.succeed(ElectronApp.ElectronApp, {
            ...unused<ElectronApp.ElectronApp["Service"]>("ElectronApp"),
            name: Effect.succeed("T3 Med"),
          }),
        ),
        Layer.provideMerge(
          DesktopEnvironment.layer({
            dirname: "/repo/apps/desktop/dist-electron",
            homeDirectory: "/Users/doctor",
            platform: "win32",
            processArch: "x64",
            appVersion: "1.2.3",
            appPath: "/repo",
            isPackaged: true,
            resourcesPath: "/repo/resources",
            runningUnderArm64Translation: false,
          }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({})))),
        ),
      ),
    ),
  );
  return yield* Deferred.await(template);
});

const menuTemplate = menuTemplateWith({});

/** Clicks Help > Check for Updates... with the updater in `state`, and returns the dialog shown. */
const checkForUpdatesFromHelp = Effect.fn(function* (state: Partial<DesktopUpdateState>) {
  const shown = yield* Deferred.make<Electron.MessageBoxOptions>();
  const template = yield* menuTemplateWith({
    updates: {
      ...unused<DesktopUpdates.DesktopUpdates["Service"]>("DesktopUpdates"),
      disabledReason: Effect.succeedNone,
      check: () =>
        Effect.succeed({
          checked: true,
          state: {
            ...createInitialDesktopUpdateState(
              "2026.11.1",
              { hostArch: "x64", appArch: "x64", runningUnderArm64Translation: false },
              "latest",
            ),
            enabled: true,
            ...state,
          },
        }),
    },
    dialog: {
      ...unused<ElectronDialog.ElectronDialog["Service"]>("ElectronDialog"),
      showMessageBox: (options) =>
        Deferred.succeed(shown, options).pipe(
          Effect.as({ response: options.cancelId ?? 0, checkboxChecked: false }),
        ),
    },
  });
  const help = template.find((item) => item.role === "help")?.submenu;
  const check = Array.isArray(help)
    ? help.find(
        (item: Electron.MenuItemConstructorOptions) => item.label === "Check for Updates...",
      )
    : undefined;
  assert.notStrictEqual(check?.visible, false);
  if (typeof check?.click !== "function") {
    throw new Error("Help has no Check for Updates... entry to click.");
  }
  check.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
  const dialog = yield* Deferred.await(shown);
  return [dialog.title ?? "", dialog.message, dialog.detail ?? ""].join(" | ");
});

const shownLabels = (
  template: readonly Electron.MenuItemConstructorOptions[],
  menuLabel: string,
): ReadonlyArray<string> => {
  // Help has a role and no label of its own.
  const submenu = template.find(
    (item) => item.label === menuLabel || item.role === menuLabel.toLowerCase(),
  )?.submenu;
  return Array.isArray(submenu)
    ? submenu.flatMap((item: Electron.MenuItemConstructorOptions) =>
        item.visible === false || item.label === undefined ? [] : [item.label],
      )
    : [];
};

it.effect("gives a doctor's View menu one plain Reload and no developer entry", () =>
  Effect.gen(function* () {
    const template = yield* menuTemplate;
    const view = shownLabels(template, "View");
    assert.deepStrictEqual(
      view.filter((label) => /reload|developer/i.test(label)),
      ["Reload"],
    );
    // The entries are upstream's and only hidden: one it renames would come back unseen.
    const all = (template.find((item) => item.label === "View")?.submenu ??
      []) as ReadonlyArray<Electron.MenuItemConstructorOptions>;
    for (const label of ["Force Reload", "Toggle Developer Tools"]) {
      assert.isTrue(
        all.some((item) => item.label === label && item.visible === false),
        label,
      );
    }
    // Zooming stays.
    assert.include(view, "Zoom In");
    // The update check is Help's, not View's.
    assert.include(shownLabels(template, "Help"), "Check for Updates...");
  }).pipe(Effect.scoped),
);

it.effect("names T3 Med, and never T3 Code, in what a manual update check says", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<readonly [Partial<DesktopUpdateState>, ReadonlyArray<string>]> = [
      [{ status: "up-to-date" }, ["T3 Med 2026.11.1 is currently the newest version available."]],
      [
        { status: "available", availableVersion: "2026.11.2" },
        ["T3 Med 2026.11.2 is available.", "You're running T3 Med 2026.11.1."],
      ],
      [
        { status: "downloading", availableVersion: "2026.11.2" },
        ["T3 Med 2026.11.2 is already downloading."],
      ],
      [
        {
          status: "downloaded",
          availableVersion: "2026.11.2",
          downloadedVersion: "2026.11.2",
          downloadPercent: 100,
        },
        ["T3 Med 2026.11.2 is ready to install.", "T3 Med will restart to install it."],
      ],
    ];
    for (const [state, sentences] of cases) {
      const said = yield* checkForUpdatesFromHelp(state);
      for (const sentence of sentences) assert.include(said, sentence);
      assert.notInclude(said, "T3 Code");
    }
  }).pipe(Effect.scoped),
);
