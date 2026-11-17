/**
 * T3 Med: what the patient surfaces decide before they draw, kept free of React. Nothing here
 * converts a unit or computes a change: those numbers are the store's and are only laid out.
 */
import type { MedLab, MedNote, MedPatientRecord, MedPlan } from "@t3tools/contracts/med";
import type { ComponentType } from "react";

import { formatDay } from "./medLogic";

export interface LabTestGroup {
  readonly labTestId: string;
  readonly name: string;
  /** Oldest collected first, as the server sends them. */
  readonly results: ReadonlyArray<MedLab>;
  readonly latest: MedLab;
}

/** Every test the patient has a result of, named A to Z. */
export function groupLabTests(labs: ReadonlyArray<MedLab>): ReadonlyArray<LabTestGroup> {
  const byTest = new Map<string, Array<MedLab>>();
  for (const lab of labs) {
    const results = byTest.get(lab.labTestId);
    if (results === undefined) byTest.set(lab.labTestId, [lab]);
    else results.push(lab);
  }
  return [...byTest.entries()]
    .flatMap(([labTestId, results]) => {
      const latest = results.at(-1);
      return latest === undefined ? [] : [{ labTestId, name: latest.testName, results, latest }];
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, "en"));
}

export interface LabPoint {
  readonly id: string;
  readonly collected: string;
  /** Where the point is drawn, in the series' unit. */
  readonly value: number;
  /** The number beside the point: as written, unless the store converted it to the series' unit. */
  readonly label: string;
  /** The result as the table shows it. */
  readonly written: string;
  readonly converted: boolean;
  readonly draft: boolean;
  readonly baseline: boolean;
}

export interface LabSeries {
  /** The baseline's unit: the one every point is in. */
  readonly unit: string;
  readonly points: ReadonlyArray<LabPoint>;
  /** Results left off the chart because they are words, such as "negative". */
  readonly notNumeric: number;
  /** Numbers left off the chart because the store could not express them in that unit. */
  readonly notConverted: number;
}

/**
 * One test's results as chart points. A result is plotted only with the value the store gave
 * it in the baseline's unit; its own number, in another unit, would draw a change that never was.
 */
export function labSeries(results: ReadonlyArray<MedLab>): LabSeries | null {
  const baseline = results.find((result) => result.isBaseline && result.value !== null);
  if (baseline === undefined || baseline.value === null) return null;
  const points = results.flatMap((result): ReadonlyArray<LabPoint> => {
    const value = result.id === baseline.id ? baseline.value : result.valueInBaselineUnit;
    if (value === null) return [];
    // The store hands a result in the baseline's own unit back untouched.
    const converted = value !== result.value;
    return [
      {
        id: result.id,
        collected: result.collected,
        value,
        label: converted ? formatLabNumber(value) : result.valueText,
        written: valueLabel(result),
        converted,
        draft: result.status === "draft",
        baseline: result.id === baseline.id,
      },
    ];
  });
  const notNumeric = results.filter((result) => result.value === null).length;
  return {
    unit: results.find((result) => result.changeUnit !== null)?.changeUnit ?? baseline.unit,
    points,
    notNumeric,
    notConverted: results.length - points.length - notNumeric,
  };
}

/** What the chart leaves out and why, or null when every result is on it. */
export function notOnChartLabel(
  series: Pick<LabSeries, "unit" | "notNumeric" | "notConverted">,
): string | null {
  const { notNumeric, notConverted } = series;
  const reasons = [
    notNumeric === 0
      ? null
      : notNumeric === 1
        ? "1 result is not a number"
        : `${notNumeric} results are not numbers`,
    notConverted === 0
      ? null
      : `${notConverted}${notNumeric === 0 ? (notConverted === 1 ? " result" : " results") : ""} could not be converted to ${series.unit}`,
  ].filter((reason) => reason !== null);
  return reasons.length === 0 ? null : `Not on the chart: ${reasons.join(", ")}.`;
}

/** The chart in words, for a reader who cannot see it. */
export function describeSeries(name: string, series: LabSeries): string {
  const results = series.points.map((point) => {
    const status = point.draft ? "draft" : "verified";
    return `${point.label} on ${formatDay(point.collected, "")} (${
      point.baseline ? `baseline, ${status}` : status
    })`;
  });
  return `${name} in ${series.unit}: ${results.join(", ")}.`;
}

export interface ChartGeometry {
  /** Each point with where it sits: `x` from the first day (0) to the last (100), `y` from the top. */
  readonly points: ReadonlyArray<
    LabPoint & {
      readonly x: number;
      readonly y: number;
      /** Every second result of one day: its label goes under the dot, clear of its neighbour's. */
      readonly labelBelow: boolean;
    }
  >;
  readonly baselineY: number;
}

// The least the chart's height stands for, as a share of the largest value: a small change
// then looks small instead of filling the chart.
const MIN_VALUE_SPAN = 0.25;

// How far apart two results of one day sit, in percent of the plot's width.
const SAME_DAY_STEP = 8;
// The most of the width that results sharing a day may take from the days themselves.
const SAME_DAY_ROOM = 50;

const dayNumber = (isoDate: string) => Date.parse(`${isoDate}T00:00:00.000Z`) / 86_400_000;

/**
 * Where a series is drawn, in percent of the plot: days apart on the calendar are apart on the
 * chart, and the values fill the height unless they differ by little. Results of one day sit
 * side by side in the order they were filed, each a step after the one before, so none hides
 * another. A date that cannot be read spaces the points evenly.
 */
export function chartGeometry(series: LabSeries): ChartGeometry {
  const days = series.points.map((point) => dayNumber(point.collected));
  const evenly = days.some((day) => Number.isNaN(day));
  const firstDay = days[0] ?? 0;
  const span = (days.at(-1) ?? 0) - firstDay;
  // How many results before each one, itself included, came second or later on their day.
  let sameDay = 0;
  let nthOfDay = 0;
  const places = days.map((day, index) => {
    nthOfDay = index > 0 && day === days[index - 1] ? nthOfDay + 1 : 0;
    if (nthOfDay > 0) sameDay += 1;
    return { stepsBefore: sameDay, nthOfDay };
  });
  const step = sameDay === 0 ? 0 : Math.min(SAME_DAY_STEP, SAME_DAY_ROOM / sameDay);
  const room = 100 - sameDay * step;
  const values = series.points.map((point) => point.value);
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const range = Math.max(
    highest - lowest,
    MIN_VALUE_SPAN * Math.max(...values.map((value) => Math.abs(value))),
  );
  const middle = (highest + lowest) / 2;
  const yOf = (value: number) => (range === 0 ? 50 : 50 + ((middle - value) / range) * 100);
  const last = series.points.length - 1;
  const points = series.points.map((point, index) => ({
    ...point,
    x: evenly
      ? last === 0
        ? 50
        : (index / last) * 100
      : (span === 0 ? room / 2 : (((days[index] ?? firstDay) - firstDay) / span) * room) +
        (places[index]?.stepsBefore ?? 0) * step,
    y: yOf(point.value),
    labelBelow: (places[index]?.nthOfDay ?? 0) % 2 === 1,
  }));
  return { points, baselineY: points.find((point) => point.baseline)?.y ?? 50 };
}

const MINUS = "−";

// Past these digits a double holds what a subtraction left behind, not the result.
const EXACT_DIGITS = 12;

/**
 * A number the store worked out (a converted value, a change), for display. It keeps
 * `significant` digits and every digit before the decimal point, so a small value never reads
 * as zero and two different values rarely read alike. A result as written is never passed
 * through here: it is shown as written.
 */
export function formatLabNumber(value: number, significant = 4): string {
  const size = Math.abs(Number(value.toPrecision(EXACT_DIGITS)));
  if (size === 0 || !Number.isFinite(size)) return size === 0 ? "0" : String(value);
  const wholeDigits = size >= 1 ? Math.floor(Math.log10(size)) + 1 : 0;
  const text =
    wholeDigits >= significant
      ? size.toFixed(0)
      : new Intl.NumberFormat("en-US", {
          maximumSignificantDigits: significant,
          maximumFractionDigits: 20,
          roundingPriority: "lessPrecision",
          useGrouping: false,
        }).format(size);
  return value < 0 ? `${MINUS}${text}` : text;
}

const signed = (value: number, significant?: number) => {
  const text = formatLabNumber(value, significant);
  return value > 0 && text !== "0" ? `+${text}` : text;
};

const NOT_COMPARED = {
  in_inbox: "Not compared: no patient yet",
  first_result: "Not compared: first result",
  result_has_no_number: "No number to compare",
  result_has_no_unit: "Not compared: no unit",
  baseline_has_no_unit: "Not compared: baseline has no unit",
  no_verified_conversion: "Not compared: no verified conversion",
} as const satisfies Record<NonNullable<MedLab["notCompared"]>, string>;

// A difference this small beside the value itself is what a unit conversion left behind.
const NO_CHANGE = 1e-12;

/** How a result stands to the baseline, in the store's own numbers. */
export function changeLabel(lab: MedLab): string {
  if (lab.isBaseline) return "Baseline";
  if (lab.changeFromBaseline !== null) {
    const unit = lab.changeUnit === null || lab.changeUnit === "" ? "" : ` ${lab.changeUnit}`;
    if (Math.abs(lab.changeFromBaseline) <= Math.abs(lab.valueInBaselineUnit ?? 0) * NO_CHANGE) {
      return `0${unit}${lab.changePercent === null ? "" : " (0%)"}`;
    }
    const percent = lab.changePercent === null ? "" : ` (${signed(lab.changePercent, 2)}%)`;
    return `${signed(lab.changeFromBaseline)}${unit}${percent}`;
  }
  return lab.notCompared === null ? "Not compared" : NOT_COMPARED[lab.notCompared];
}

/** The result as it was written, with its unit when it has one. */
export function valueLabel(lab: MedLab): string {
  return lab.unit === "" ? lab.valueText : `${lab.valueText} ${lab.unit}`;
}

const isOpen = (plan: MedPlan) => plan.status === "draft" || plan.status === "planned";

const byDue = (a: MedPlan, b: MedPlan) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);

/** The plans still ahead (or overdue), soonest due first. */
export function nextPlans(plans: ReadonlyArray<MedPlan>, limit: number): ReadonlyArray<MedPlan> {
  return plans.filter(isOpen).toSorted(byDue).slice(0, limit);
}

/** Open plans soonest first; done and cancelled ones latest first. */
export function plansForPanel(plans: ReadonlyArray<MedPlan>): {
  readonly open: ReadonlyArray<MedPlan>;
  readonly closed: ReadonlyArray<MedPlan>;
} {
  return {
    open: plans.filter(isOpen).toSorted(byDue),
    closed: plans.filter((plan) => !isOpen(plan)).toSorted((a, b) => byDue(b, a)),
  };
}

export function draftCounts(record: Pick<MedPatientRecord, "labs" | "plans">): {
  readonly labs: number;
  readonly plans: number;
} {
  return {
    labs: record.labs.filter((lab) => lab.status === "draft").length,
    plans: record.plans.filter((plan) => plan.status === "draft").length,
  };
}

export type TimelineEntry =
  | { readonly kind: "note"; readonly day: string; readonly note: MedNote }
  | { readonly kind: "labs"; readonly day: string; readonly labs: ReadonlyArray<MedLab> }
  | { readonly kind: "plan"; readonly day: string; readonly plan: MedPlan };

const TIMELINE_ORDER = { note: 0, labs: 1, plan: 2 } as const;

export interface PatientTimeline {
  /** Plans still open, overdue ones too, soonest first: none of them has happened yet. */
  readonly comingUp: ReadonlyArray<MedPlan>;
  /**
   * What has happened, newest day first: notes by their date, results as one batch per
   * collected day, plans done or cancelled by their due date. Within a day: the note, its
   * results, then plans.
   */
  readonly history: ReadonlyArray<TimelineEntry>;
}

export function patientTimeline(
  record: Pick<MedPatientRecord, "labs" | "plans" | "notes">,
): PatientTimeline {
  const batches = new Map<string, Array<MedLab>>();
  for (const lab of record.labs) {
    const batch = batches.get(lab.collected);
    if (batch === undefined) batches.set(lab.collected, [lab]);
    else batch.push(lab);
  }
  const { open, closed } = plansForPanel(record.plans);
  const entries: ReadonlyArray<TimelineEntry> = [
    ...record.notes.map((note) => ({ kind: "note" as const, day: note.date, note })),
    ...[...batches.entries()].map(([day, labs]) => ({ kind: "labs" as const, day, labs })),
    ...closed.map((plan) => ({ kind: "plan" as const, day: plan.due, plan })),
  ];
  return {
    comingUp: open,
    history: entries.toSorted((a, b) =>
      a.day === b.day ? TIMELINE_ORDER[a.kind] - TIMELINE_ORDER[b.kind] : a.day < b.day ? 1 : -1,
    ),
  };
}

/** One row of the right panel's launcher, as upstream's `RightPanelTabs` builds them. */
export interface SurfaceAction {
  /** Set by the fork on the upstream rows it keeps: a label is upstream's to reword. */
  readonly id?: string;
  /** A line the launcher shows under this row while it cannot be opened. */
  readonly note?: string | undefined;
  readonly label: string;
  readonly description?: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly shortcut: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
}

// The upstream surfaces a doctor still uses, by the id `RightPanelTabs` gives them, with the
// key each takes here. Summary takes S, so the side chat moves to C.
const KEPT_UPSTREAM_SURFACES: Readonly<Record<string, string | null>> = {
  files: null,
  "side-chat": "C",
};

/**
 * The launcher of a patient workspace: the patient surfaces, then the upstream surfaces a
 * doctor still uses. With the fork switch off it is upstream's list, untouched.
 */
export function patientLauncherActions(
  upstream: ReadonlyArray<SurfaceAction>,
  patient: ReadonlyArray<SurfaceAction>,
  enabled: boolean,
): ReadonlyArray<SurfaceAction> {
  if (!enabled) return upstream;
  return [
    ...patient,
    ...upstream.flatMap((action) => {
      if (action.id === undefined || !Object.hasOwn(KEPT_UPSTREAM_SURFACES, action.id)) return [];
      const shortcut = KEPT_UPSTREAM_SURFACES[action.id];
      return [shortcut == null ? action : { ...action, shortcut }];
    }),
  ];
}
