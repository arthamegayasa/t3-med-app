/**
 * T3 Med: the application menu's update dialogs say `T3 Med`. Upstream writes its own name into
 * each sentence ("T3 Code 1.2.3 is available."), so the menu's dialog service is wrapped once
 * instead of editing every sentence in `DesktopApplicationMenu.ts`.
 */
import type * as ElectronDialog from "../electron/ElectronDialog.ts";
import { MED_PRODUCT_NAME } from "./identity.ts";

const UPSTREAM_PRODUCT_NAME = "T3 Code";

export const medUpdateWording = (text: string): string =>
  text.replaceAll(UPSTREAM_PRODUCT_NAME, MED_PRODUCT_NAME);

const reworded = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : medUpdateWording(text);

/** The same dialog service, with the product's name in what its message boxes say. */
export const medUpdateDialog = (
  dialog: ElectronDialog.ElectronDialog["Service"],
): ElectronDialog.ElectronDialog["Service"] => ({
  ...dialog,
  showMessageBox: (options, owner) => {
    const title = reworded(options.title);
    const detail = reworded(options.detail);
    return dialog.showMessageBox(
      {
        ...options,
        message: medUpdateWording(options.message),
        ...(title === undefined ? {} : { title }),
        ...(detail === undefined ? {} : { detail }),
      },
      owner,
    );
  },
});
