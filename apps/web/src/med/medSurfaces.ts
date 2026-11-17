/**
 * T3 Med: the patient surfaces of the right panel, as the panel's store knows them. Kept free of
 * React and of the store, which imports this. No kind is named `plan` or `agents`: upstream's
 * migration of saved panel state drops surfaces of those kinds.
 */
export const MED_SURFACE_KINDS = ["med-summary", "med-labs", "med-plan", "med-timeline"] as const;

export type MedSurfaceKind = (typeof MED_SURFACE_KINDS)[number];

/** One tab per kind and thread, so the id is the kind. */
export type MedSurface = { [K in MedSurfaceKind]: { id: K; kind: K } }[MedSurfaceKind];

export const medSurface = (kind: MedSurfaceKind): MedSurface => ({ id: kind, kind }) as MedSurface;

export const MED_SURFACE_TITLE = {
  "med-summary": "Summary",
  "med-labs": "Labs",
  "med-plan": "Plan",
  "med-timeline": "Timeline",
} as const satisfies Record<MedSurfaceKind, string>;
