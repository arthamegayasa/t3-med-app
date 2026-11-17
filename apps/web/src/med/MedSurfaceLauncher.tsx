/**
 * T3 Med: the patient surfaces as the right panel's launcher and tab strip show them. The
 * surfaces belong to the thread in the route: a draft, or a thread with no linked patient,
 * is offered them disabled with the reason.
 */
import { CalendarDaysIcon, ClipboardListIcon, FlaskConicalIcon, HistoryIcon } from "lucide-react";

import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { useRightPanelStore } from "../rightPanelStore";
import { useThreadPatient } from "./medData";
import { patientLauncherActions, type SurfaceAction } from "./medPanelLogic";
import { MED_SURFACE_KINDS, MED_SURFACE_TITLE, type MedSurfaceKind } from "./medSurfaces";
import { T3MED } from "./t3med";

const NO_PATIENT_REASON = "No patient is linked to this chat yet.";

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

/**
 * The launcher's rows in a patient workspace: Summary, Labs, Plan and Timeline, then the
 * upstream rows a doctor still uses. Takes upstream's rows and gives back what to show.
 */
export function useMedSurfaceActions(
  upstream: ReadonlyArray<SurfaceAction>,
): ReadonlyArray<SurfaceAction> {
  const threadRef = useThreadRouteRef();
  const patient = useThreadPatient(threadRef?.environmentId ?? null, threadRef?.threadId ?? null);
  return patientLauncherActions(
    upstream,
    MED_SURFACE_KINDS.map((kind) => ({
      label: MED_SURFACE_TITLE[kind],
      icon: SURFACE_ICON[kind],
      shortcut: SURFACE_SHORTCUT[kind],
      available: threadRef !== null && patient !== null,
      disabledReason: NO_PATIENT_REASON,
      onClick: () => {
        if (threadRef !== null) useRightPanelStore.getState().open(threadRef, kind);
      },
    })),
    T3MED,
  );
}

/** The icon of a patient surface's tab. */
export function MedSurfaceIcon({ kind }: { readonly kind: MedSurfaceKind }) {
  const Icon = SURFACE_ICON[kind];
  return <Icon className="size-3 shrink-0" />;
}
