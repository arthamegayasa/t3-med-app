/**
 * T3 Med: what makes the desktop app a different application from T3 Code, which is installed
 * beside it. Nothing here may equal upstream's value. In `scripts/lib` because the desktop app
 * and the packaging scripts both compile that folder. The reasons are in docs/t3-med/FORK.md.
 */

/** The name in the window title, the taskbar, the Start menu and the installer. */
export const MED_PRODUCT_NAME = "T3 Med";

/** electron-builder's `appId`, and the Windows AppUserModelID of the running app. */
export const MED_APP_ID = "com.arthamegayasa.t3med";

/**
 * The staged package's `name`. electron-builder installs a per-user build to
 * `%LOCALAPPDATA%\Programs\<name>`, and Electron's user-data folder defaults to
 * `%APPDATA%\<name>` until the app sets its own. Upstream's is `t3code`.
 */
export const MED_PACKAGE_NAME = "t3med";

/**
 * The scheme the window loads its page from (`t3med://app/`), also in `apps/server/src/httpCors.ts`.
 * Clerk's bridge registers it with Windows as this app's link handler at every start, so
 * upstream's `t3code` here would take T3 Code's links away from T3 Code.
 */
export const MED_DESKTOP_SCHEME = "t3med";
export const MED_DESKTOP_DEV_SCHEME = "t3med-dev";

/**
 * Where the backend looks for a free port. Upstream starts at 3773, the port a running T3 Code
 * holds; `start-t3-med.cmd` uses 3899.
 */
export const MED_DESKTOP_BACKEND_PORT = 3900;

/** The folder under the system temp directory for Node's compile cache. Upstream's is `t3code`. */
export const MED_COMPILE_CACHE_DIR = "t3med";

// Typed `boolean` so the upstream code after each condition stays live: `false` gives upstream's
// behaviour back.
/**
 * Upstream copies `Local State` from, and imports localStorage out of, the folders of older
 * T3 Code builds (`T3 Code (Alpha)`, `t3code`). On this machine those belong to the real
 * T3 Code, so T3 Med never opens them.
 */
export const MED_OWN_USER_DATA: boolean = true;

/**
 * Upstream puts its bundled `t3` launcher on the user's PATH at first launch. T3 Code's `t3`
 * is already there; a second one would be the wrong command half of the time.
 */
export const MED_KEEPS_OFF_PATH: boolean = true;

/**
 * Help > "Check for Updates..." is shown: the packaged app updates from the fork's own releases
 * (docs/t3-med/FORK.md, Updates). `true` hides it again.
 */
export const MED_HIDES_UPDATE_MENU: boolean = false;

/** A doctor's View menu has one plain Reload: no Force Reload, no Toggle Developer Tools. */
export const MED_HIDES_DEVELOPER_MENU: boolean = true;

/** Electron's user-data folder under `%APPDATA%`. Upstream's are `t3code-v2` and `t3code-dev`. */
export const medUserDataDirName = (isDevelopment: boolean): string =>
  isDevelopment ? `${MED_PACKAGE_NAME}-dev` : MED_PACKAGE_NAME;

export const medAppUserModelId = (isDevelopment: boolean): string =>
  isDevelopment ? `${MED_APP_ID}.dev` : MED_APP_ID;

/** `T3 Med`, and `T3 Med (Dev)` or `T3 Med (Nightly)` for a build that is not the released one. */
export const medDisplayName = (stageLabel: string): string =>
  stageLabel === "Beta" ? MED_PRODUCT_NAME : `${MED_PRODUCT_NAME} (${stageLabel})`;
