import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
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

const menuTemplate = Effect.gen(function* () {
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
        Layer.provideMerge(Layer.succeed(DesktopWindow.DesktopWindow, unused("DesktopWindow"))),
        Layer.provideMerge(Layer.succeed(DesktopUpdates.DesktopUpdates, unused("DesktopUpdates"))),
        Layer.provideMerge(Layer.succeed(ElectronDialog.ElectronDialog, unused("ElectronDialog"))),
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

const shownLabels = (
  template: readonly Electron.MenuItemConstructorOptions[],
  menuLabel: string,
): ReadonlyArray<string> => {
  const submenu = template.find((item) => item.label === menuLabel)?.submenu;
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
    // No menu offers an update either.
    assert.notInclude(shownLabels(template, "Help"), "Check for Updates...");
  }).pipe(Effect.scoped),
);
