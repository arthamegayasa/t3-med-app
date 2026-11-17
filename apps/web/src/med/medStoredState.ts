/**
 * T3 Med: state saved before a control was hidden, which nothing on screen can change any more.
 * Each store asks here once: a hidden setting reads as upstream's default, and a saved tab of a
 * hidden surface is dropped. With `T3MED` off every function hands back what it was given.
 */
import {
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { resolveNewThreadEnvMode as upstreamNewThreadEnvMode } from "@t3tools/shared/projectSettings";

import { MED_SURFACE_KINDS } from "./medSurfaces";
import { T3MED } from "./t3med";

// Client settings whose row is hidden (`medHidden.ts`) and that still change what is drawn.
const HIDDEN_CLIENT_SETTINGS = [
  "boringSidebarEnabled",
  "boringSidebarMultilineRows",
  "sidebarProjectGroupingMode",
  "sidebarProjectGroupingOverrides",
  "sidebarProjectSortOrder",
  "persistComposerContextStrip",
  "environmentIdentificationMode",
  "fontSizeTerminal",
  "fontFamilyTerminal",
  "proactivePanelsEnabled",
  "browserAutoShowFloatingPreview",
] as const satisfies ReadonlyArray<keyof ClientSettings>;

let lastStored: ClientSettings | null = null;
let lastShown: ClientSettings = DEFAULT_CLIENT_SETTINGS;

/**
 * Client settings as the app reads them. What is stored is left alone, so a save of another
 * setting writes the hidden ones back unchanged. The same input gives the same object, which
 * `useSyncExternalStore` needs of a snapshot.
 */
export function patientClientSettings(stored: ClientSettings): ClientSettings {
  if (!T3MED) return stored;
  if (stored === lastStored) return lastShown;
  lastStored = stored;
  lastShown = HIDDEN_CLIENT_SETTINGS.every((key) => stored[key] === DEFAULT_CLIENT_SETTINGS[key])
    ? stored
    : {
        ...stored,
        ...Object.fromEntries(
          HIDDEN_CLIENT_SETTINGS.map((key) => [key, DEFAULT_CLIENT_SETTINGS[key]]),
        ),
      };
  return lastShown;
}

const NO_PROJECTS: Array<string> = [];

/**
 * Selects the sidebar's saved project filter from its store. With the filter's button hidden,
 * no project is filtered on.
 */
export const patientProjectScope = (store: {
  readonly sidebarProjectScopeKeys: Array<string>;
}): Array<string> => (T3MED ? NO_PROJECTS : store.sidebarProjectScopeKeys);

/** Where a new thread starts. Upstream reads a default no page offers; never a worktree here. */
export const resolveNewThreadEnvMode: typeof upstreamNewThreadEnvMode = T3MED
  ? (): ThreadEnvMode => "local"
  : upstreamNewThreadEnvMode;

// The right-panel surfaces a patient workspace still opens: its own, Side chat, and a file the
// doctor opened from a message. Browser, Device, Terminal, Diff, Files and pull requests are not.
const KEPT_SURFACE_KINDS: ReadonlySet<string> = new Set([
  ...MED_SURFACE_KINDS,
  "side-chat",
  "file",
]);

interface SavedThreadPanel {
  readonly activeSurfaceId?: string | null;
  readonly surfaces?: ReadonlyArray<{ readonly id: string; readonly kind: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withoutHiddenSurfaces = (panel: SavedThreadPanel): SavedThreadPanel => {
  if (!Array.isArray(panel.surfaces)) return panel;
  const surfaces = panel.surfaces.filter((surface) => KEPT_SURFACE_KINDS.has(surface.kind));
  if (surfaces.length === panel.surfaces.length) return panel;
  const activeKept = surfaces.some((surface) => surface.id === panel.activeSurfaceId);
  return {
    ...panel,
    surfaces,
    // A panel left with no tab closes; one whose open tab went shows the last that stayed.
    ...(surfaces.length === 0 ? { isOpen: false } : {}),
    activeSurfaceId: activeKept ? panel.activeSurfaceId : (surfaces.at(-1)?.id ?? null),
  };
};

/**
 * The right panel's saved state as it is loaded: the `merge` of the store's persistence. Tabs of
 * hidden surfaces are left out, so they are gone from the next save too.
 */
export function patientPanelMerge<State extends object>(persisted: unknown, current: State): State {
  if (!isRecord(persisted)) return current;
  if (!T3MED || !isRecord(persisted.byThreadKey)) return { ...current, ...persisted };
  return {
    ...current,
    ...persisted,
    byThreadKey: Object.fromEntries(
      Object.entries(persisted.byThreadKey).map(([threadKey, panel]) => [
        threadKey,
        isRecord(panel) ? withoutHiddenSurfaces(panel) : panel,
      ]),
    ),
  };
}
