/**
 * T3 Med: the patient surfaces as the right panel's launcher and tab strip show them. The
 * surfaces belong to the thread in the route: a draft, or a thread with no linked patient,
 * is offered them disabled with the reason.
 */
import { CalendarDaysIcon, ClipboardListIcon, FlaskConicalIcon, HistoryIcon } from "lucide-react";

import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { useRightPanelStore } from "../rightPanelStore";
import { type ThreadPatientState, useThreadPatientState } from "./medData";
import { patientLauncherActions, type SurfaceAction } from "./medPanelLogic";
import { MED_SURFACE_KINDS, MED_SURFACE_TITLE, type MedSurfaceKind } from "./medSurfaces";
import { T3MED } from "./t3med";

// One line each: the launcher shows it under the patient surfaces, not only on hover.
const UNAVAILABLE_REASON = {
  loading: "Looking up this chat's patient.",
  failed: "Could not read which patient this chat is about.",
  none: "No patient is linked to this chat yet. Give the chat the patient's URN.",
} as const satisfies Record<Exclude<ThreadPatientState["kind"], "linked">, string>;

const SURFACE_ICON = {
  "med-summary": ClipboardListIcon,
  "med-labs": FlaskConicalIcon,
  "med-plan": CalendarDaysIcon,
  "med-timeline": HistoryIcon,
} as const satisfies Record<MedSurfaceKind, SurfaceAction["icon"]>;

const SURFACE_SHORTCUT = {
  "med-summary": "S",
  "med-labs": "L",
  "med-plan": "P",
  "med-timeline": "T",
} as const satisfies Record<MedSurfaceKind, string>;

function useActions(
  upstream: ReadonlyArray<SurfaceAction>,
  place: "launcher" | "menu",
): ReadonlyArray<SurfaceAction> {
  const threadRef = useThreadRouteRef();
  const state = useThreadPatientState(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const reason = state.kind === "linked" ? null : UNAVAILABLE_REASON[state.kind];
  // Said once, under the last patient surface. Nothing is said while the answer is on its
  // way: it would flash on every chat opened.
  const note = place === "launcher" && state.kind !== "loading" ? (reason ?? undefined) : undefined;
  return patientLauncherActions(
    upstream,
    MED_SURFACE_KINDS.map((kind, index) => ({
      label: MED_SURFACE_TITLE[kind],
      icon: SURFACE_ICON[kind],
      shortcut: SURFACE_SHORTCUT[kind],
      available: threadRef !== null && reason === null,
      disabledReason: reason ?? "",
      note: index === MED_SURFACE_KINDS.length - 1 ? note : undefined,
      onClick: () => {
        if (threadRef !== null) useRightPanelStore.getState().open(threadRef, kind);
      },
    })),
    T3MED,
  );
}

/**
 * The `+` menu's rows in a patient workspace: Summary, Labs, Plan and Timeline, then the
 * upstream rows a doctor still uses. Takes upstream's rows and gives back what to show.
 */
export function useMedSurfaceActions(
  upstream: ReadonlyArray<SurfaceAction>,
): ReadonlyArray<SurfaceAction> {
  return useActions(upstream, "menu");
}

/**
 * The same rows for the launcher, which has room to say, under the patient surfaces, why they
 * cannot be opened. A hook of its own so upstream's list keeps its indentation.
 */
export function useMedLauncherActions(
  upstream: ReadonlyArray<SurfaceAction>,
): ReadonlyArray<SurfaceAction> {
  return useActions(upstream, "launcher");
}

/** The line under the launcher's patient surfaces that says why they cannot be opened. */
export function MedLauncherNote({ children }: { readonly children: string | undefined }) {
  return children === undefined ? null : (
    <p role="note" className="m-0 px-2.5 pt-0.5 pb-2 text-muted-foreground text-xs">
      {children}
    </p>
  );
}

/** The icon of a patient surface's tab. */
export function MedSurfaceIcon({ kind }: { readonly kind: MedSurfaceKind }) {
  const Icon = SURFACE_ICON[kind];
  return <Icon className="size-3 shrink-0" />;
}
