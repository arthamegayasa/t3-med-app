/**
 * T3 Med: says once that a downloaded update is ready. The download starts by itself, so no
 * click of the doctor's leads to upstream's "Update downloaded" toast; the app's update state
 * does. Once per version, across restarts: the sidebar's button stays until the restart.
 */
import { APP_BASE_NAME } from "../branding";
import { toastManager } from "../components/ui/toast";

const ANNOUNCED_KEY = "t3med:update-ready-announced";

interface Announcer {
  readonly read: () => string | null;
  readonly write: (version: string) => void;
  readonly notify: (title: string, description: string) => void;
}

const browserAnnouncer: Announcer = {
  read: () => {
    try {
      return window.localStorage.getItem(ANNOUNCED_KEY);
    } catch {
      return null;
    }
  },
  write: (version) => {
    try {
      window.localStorage.setItem(ANNOUNCED_KEY, version);
    } catch {}
  },
  notify: (title, description) => {
    toastManager.add({ type: "success", title, description });
  },
};

/** True when it spoke: a version already announced is not announced again. */
export function announceMedUpdateReady(
  version: string | null,
  announcer: Announcer = browserAnnouncer,
): boolean {
  if (version === null || announcer.read() === version) return false;
  announcer.write(version);
  announcer.notify(
    `Update ${version} is ready`,
    `Restart ${APP_BASE_NAME} when no chat is running, with "Restart to update" at the foot of the sidebar. Otherwise it installs when you close ${APP_BASE_NAME}.`,
  );
  return true;
}
