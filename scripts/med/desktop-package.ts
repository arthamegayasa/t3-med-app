/**
 * T3 Med: what upstream's desktop packaging (`scripts/build-desktop-artifact.ts`) builds when it
 * builds this fork. Upstream's script stays as it is but for three calls into this file, listed
 * in `docs/t3-med/FORK.md`: the staged package is given the fork's identity and update feed, the
 * icons come from `assets/med`, and the built web client gets the fork's favicons.
 */
import { MED_UPDATE_FEED } from "@t3tools/shared/medRelease";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { MED_APP_ID, MED_PACKAGE_NAME, MED_PRODUCT_NAME } from "../lib/med-identity.ts";

/**
 * Upstream allows 80 files in the unpacked Windows app, the count of its Linux-built package.
 * Built on Windows the package also carries the prepared compile cache (23 files at v0.1.10),
 * which only a host that can run the packaged app generates: 90 files in all.
 */
export const MED_WINDOWS_PAYLOAD_FILE_LIMIT = 110;

export const MED_ARTIFACT_NAME = "T3-Med-${version}-${arch}.${ext}";

export const MED_DESKTOP_ICON_ASSETS = {
  macIconPng: "assets/med/t3med-macos-1024.png",
  linuxIconPng: "assets/med/t3med-universal-1024.png",
  windowsIconIco: "assets/med/t3med-windows.ico",
} as const;

// The file names upstream's `applyWebBrandAssets` writes into a built web client.
const MED_WEB_ICONS = {
  "favicon.ico": "assets/med/t3med-web-favicon.ico",
  "favicon-16x16.png": "assets/med/t3med-web-favicon-16x16.png",
  "favicon-32x32.png": "assets/med/t3med-web-favicon-32x32.png",
  "apple-touch-icon.png": "assets/med/t3med-web-apple-touch-180.png",
  "icon-192x192.png": "assets/med/t3med-web-icon-192x192.png",
  "icon-512x512.png": "assets/med/t3med-web-icon-512x512.png",
} as const;

/**
 * The fork's identity on the package electron-builder is pointed at. `publish` is always the
 * fork's own feed, whatever upstream's script resolved from its environment: electron-builder
 * writes it into the packaged `app-update.yml`, the one file the installed app's updater reads.
 */
export function medStagePackageJson<
  Stage extends {
    readonly name: string;
    readonly description: string;
    readonly homepage: string;
    readonly author: string;
    readonly build: Record<string, unknown>;
  },
>(stage: Stage): Stage {
  return {
    ...stage,
    name: MED_PACKAGE_NAME,
    description:
      "T3 Med is a neurologist's patient workspace: a private fork of T3 Code organised around patients.",
    homepage: "https://github.com/arthamegayasa/t3-med-app",
    author: MED_PRODUCT_NAME,
    build: {
      ...stage.build,
      appId: MED_APP_ID,
      productName: MED_PRODUCT_NAME,
      artifactName: MED_ARTIFACT_NAME,
      publish: [MED_UPDATE_FEED],
      // An uninstall removes the program and nothing else. The uninstaller only ever deletes
      // Electron's profile, never `~/.t3med`, and that only when this is on or it is run with
      // `--delete-app-data`; an update always runs it with `--updated`.
      nsis: { ...nsisOf(stage.build), deleteAppDataOnUninstall: false },
    },
  };
}

const nsisOf = (build: Record<string, unknown>): Record<string, unknown> =>
  typeof build.nsis === "object" && build.nsis !== null ? { ...build.nsis } : {};

/** Writes the fork's favicons over the ones upstream's branding step put in a built web client. */
export const applyMedWebIcons = Effect.fn("applyMedWebIcons")(function* (clientDirectory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("../..", import.meta.url));
  yield* Effect.forEach(
    Object.entries(MED_WEB_ICONS),
    ([fileName, source]) =>
      fs.copyFile(
        path.join(repoRoot, source),
        path.join(path.resolve(repoRoot, clientDirectory), fileName),
      ),
    { concurrency: "unbounded" },
  );
});
