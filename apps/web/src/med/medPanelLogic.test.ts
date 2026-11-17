import type { MedLab, MedNote, MedPlan } from "@t3tools/contracts/med";
import { describe, expect, it } from "vite-plus/test";

import {
  changeLabel,
  chartGeometry,
  draftCounts,
  formatLabNumber,
  groupLabTests,
  labSeries,
  nextPlans,
  patientLauncherActions,
  plansForPanel,
  timelineEntries,
  valueLabel,
} from "./medPanelLogic";

const lab = (fields: Partial<MedLab> & Pick<MedLab, "id" | "collected">): MedLab => ({
  labTestId: "test-ldl",
  testId: "ldl",
  testName: "LDL cholesterol",
  testAsWritten: "LDL",
  value: null,
  valueText: "",
  unit: "mg/dL",
  referenceRange: "",
  flag: null,
  status: "verified",
  isBaseline: false,
  valueInBaselineUnit: null,
  changeFromBaseline: null,
  changePercent: null,
  changeUnit: null,
  notCompared: null,
  noteId: "note-1",
  ...fields,
});

const baseline = lab({
  id: "l1",
  collected: "2026-08-21",
  value: 162,
  valueText: "162",
  isBaseline: true,
  notCompared: "first_result",
});
// Written in mmol/L; the store, not the client, expressed it in the baseline's mg/dL.
const converted = lab({
  id: "l2",
  collected: "2026-09-18",
  value: 3.31,
  valueText: "3.31",
  unit: "mmol/L",
  valueInBaselineUnit: 128,
  changeFromBaseline: -34,
  changePercent: -20.99,
  changeUnit: "mg/dL",
});
const draft = lab({
  id: "l3",
  collected: "2026-11-06",
  value: 78,
  valueText: "78",
  status: "draft",
  valueInBaselineUnit: 78,
  changeFromBaseline: -84,
  changePercent: -51.85,
  changeUnit: "mg/dL",
});
const unitless = lab({
  id: "l4",
  collected: "2026-10-16",
  value: 96,
  valueText: "96",
  unit: "",
  notCompared: "result_has_no_unit",
});
const hba1c = lab({
  id: "h1",
  collected: "2026-09-18",
  labTestId: "test-hba1c",
  testId: "hba1c",
  testName: "HbA1c",
  value: 8.1,
  valueText: "8.1",
  unit: "%",
  isBaseline: true,
});
const antibody = lab({
  id: "a1",
  collected: "2026-09-18",
  labTestId: "test-anti",
  testId: null,
  testName: "Anti-dsDNA",
  valueText: "negative",
  unit: "",
  notCompared: "result_has_no_number",
});

describe("groupLabTests", () => {
  it("groups results by catalogue test, named A to Z, each oldest first with its latest", () => {
    const groups = groupLabTests([baseline, antibody, hba1c, converted, unitless, draft]);
    expect(
      groups.map((group) => [
        group.name,
        group.results.map((result) => result.id),
        group.latest.id,
      ]),
    ).toEqual([
      ["Anti-dsDNA", ["a1"], "a1"],
      ["HbA1c", ["h1"], "h1"],
      ["LDL cholesterol", ["l1", "l2", "l4", "l3"], "l3"],
    ]);
  });
});

describe("labSeries", () => {
  it("plots the baseline and every result the store compared, in the baseline's unit", () => {
    expect(labSeries([baseline, converted, unitless, draft])).toEqual({
      unit: "mg/dL",
      points: [
        { id: "l1", collected: "2026-08-21", value: 162, draft: false, baseline: true },
        { id: "l2", collected: "2026-09-18", value: 128, draft: false, baseline: false },
        { id: "l3", collected: "2026-11-06", value: 78, draft: true, baseline: false },
      ],
      notPlotted: 1,
    });
  });

  it("never plots a value the store did not express in the baseline's unit", () => {
    // 3.31 mmol/L beside 162 mg/dL would read as a fall to almost nothing.
    const uncompared = { ...converted, valueInBaselineUnit: null, changeFromBaseline: null };
    expect(labSeries([baseline, uncompared])?.points.map((point) => point.value)).toEqual([162]);
  });

  it("has no series for a test with no numeric baseline", () => {
    expect(labSeries([antibody])).toBeNull();
    expect(labSeries([])).toBeNull();
  });
});

describe("chartGeometry", () => {
  const point = (id: string, collected: string, value: number, isBaseline = false) => ({
    id,
    collected,
    value,
    draft: false,
    baseline: isBaseline,
  });

  it("spaces points by the days between them and puts the highest value at the top", () => {
    // 21 Aug to 18 Sep is 28 days of the 77 to 6 Nov; 128 is 34 of the 84 between 162 and 78.
    const geometry = chartGeometry({
      unit: "mg/dL",
      notPlotted: 0,
      points: [
        point("l1", "2026-08-21", 162, true),
        point("l2", "2026-09-18", 128),
        point("l3", "2026-11-06", 78),
      ],
    });
    expect(geometry.points.map(({ x, y }) => [Math.round(x), Math.round(y)])).toEqual([
      [0, 0],
      [36, 40],
      [100, 100],
    ]);
    expect(geometry.baselineY).toBe(0);
  });

  it("does not stretch a small change to the full height of the chart", () => {
    // Creatinine 0.9 to 1.0 is a ninth of the value, not a climb from the floor to the ceiling.
    const geometry = chartGeometry({
      unit: "mg/dL",
      notPlotted: 0,
      points: [point("c1", "2026-08-21", 0.9, true), point("c2", "2026-11-06", 1)],
    });
    expect(geometry.points.map(({ y }) => Math.round(y))).toEqual([70, 30]);
  });

  it("centres a single result, and results that do not differ", () => {
    const one = chartGeometry({
      unit: "%",
      notPlotted: 0,
      points: [point("h1", "2026-09-18", 8.1, true)],
    });
    expect(one.points.map(({ x, y }) => [x, y])).toEqual([[50, 50]]);
    const flat = chartGeometry({
      unit: "%",
      notPlotted: 0,
      points: [point("h1", "2026-09-18", 8.1, true), point("h2", "2026-09-18", 8.1)],
    });
    expect(flat.points.map(({ x, y }) => [x, y])).toEqual([
      [0, 50],
      [100, 50],
    ]);
  });
});

describe("changeLabel", () => {
  it.each([
    [baseline, "Baseline"],
    [converted, "−34 mg/dL (−21%)"],
    [{ ...converted, changeFromBaseline: 12.25, changePercent: 7.6 }, "+12.3 mg/dL (+8%)"],
    [{ ...converted, changeFromBaseline: 0, changePercent: 0 }, "0 mg/dL (0%)"],
    [{ ...converted, changeFromBaseline: 4, changePercent: null }, "+4 mg/dL"],
    [unitless, "Not compared: no unit"],
    [antibody, "Not compared: not a number"],
    [
      { ...converted, changeFromBaseline: null, notCompared: "no_verified_conversion" as const },
      "Not compared: no verified conversion",
    ],
    [
      { ...converted, changeFromBaseline: null, notCompared: "baseline_has_no_unit" as const },
      "Not compared: baseline has no unit",
    ],
  ])("says how %j stands to the baseline", (result, expected) => {
    expect(changeLabel(result)).toBe(expected);
  });
});

describe("valueLabel and formatLabNumber", () => {
  it("shows a value as written, with its unit when it has one", () => {
    expect(valueLabel(converted)).toBe("3.31 mmol/L");
    expect(valueLabel(antibody)).toBe("negative");
  });

  it.each([
    [162, "162"],
    [128.04, "128"],
    [12.25, "12.3"],
    [7.4, "7.4"],
    [0.857, "0.86"],
    [-84, "−84"],
  ])("writes %d as %s", (value, expected) => {
    expect(formatLabNumber(value)).toBe(expected);
  });
});

const plan = (id: string, due: string, status: MedPlan["status"]): MedPlan => ({
  id,
  patientId: "p1",
  title: id,
  due,
  type: "follow_up",
  status,
});

const plans = [
  plan("done-old", "2026-09-01", "done"),
  plan("overdue", "2026-11-02", "planned"),
  plan("cancelled", "2026-11-05", "cancelled"),
  plan("draft", "2026-11-14", "draft"),
  plan("later", "2026-12-01", "planned"),
  plan("much-later", "2027-01-10", "planned"),
];

describe("plans", () => {
  it("offers the next few plans that are still open, soonest first", () => {
    expect(nextPlans(plans, 3).map((entry) => entry.id)).toEqual(["overdue", "draft", "later"]);
  });

  it("lists open plans soonest first, then closed ones latest first", () => {
    const panel = plansForPanel(plans);
    expect(panel.open.map((entry) => entry.id)).toEqual([
      "overdue",
      "draft",
      "later",
      "much-later",
    ]);
    expect(panel.closed.map((entry) => entry.id)).toEqual(["cancelled", "done-old"]);
  });

  it("counts what is still a draft", () => {
    expect(draftCounts({ labs: [baseline, draft], plans })).toEqual({ labs: 1, plans: 1 });
  });
});

describe("timelineEntries", () => {
  it("mixes lab batches by collected day, plans and notes, newest first", () => {
    const note = (id: string, date: string): MedNote => ({
      id,
      threadId: null,
      title: id,
      date,
      summary: "",
      needsYou: "",
    });
    const entries = timelineEntries({
      labs: [baseline, hba1c, converted, antibody, draft],
      plans: [plan("visit", "2026-11-14", "planned"), plan("eeg", "2026-09-18", "done")],
      notes: [note("n-nov", "2026-11-06"), note("n-sep", "2026-09-18")],
    });
    expect(
      entries.map((entry) =>
        entry.kind === "labs"
          ? [entry.day, "labs", entry.labs.map((result) => result.id)]
          : entry.kind === "plan"
            ? [entry.day, "plan", entry.plan.id]
            : [entry.day, "note", entry.note.id],
      ),
    ).toEqual([
      ["2026-11-14", "plan", "visit"],
      ["2026-11-06", "note", "n-nov"],
      ["2026-11-06", "labs", ["l3"]],
      ["2026-09-18", "note", "n-sep"],
      ["2026-09-18", "labs", ["h1", "l2", "a1"]],
      ["2026-09-18", "plan", "eeg"],
      ["2026-08-21", "labs", ["l1"]],
    ]);
  });
});

describe("patientLauncherActions", () => {
  const action = (label: string, shortcut: string) => ({
    label,
    shortcut,
    icon: () => null,
    available: true,
    disabledReason: "",
    onClick: () => {},
  });
  const upstream = [
    action("Browser", "B"),
    action("Terminal", "T"),
    action("Files", "F"),
    action("Diff", "D"),
    action("Pull request", "P"),
    action("Linked pull requests", "L"),
    action("Device", "M"),
    action("Side chat", "S"),
  ];
  const patient = [
    action("Summary", "S"),
    action("Labs", "L"),
    action("Plan", "P"),
    action("Timeline", "T"),
  ];

  it("puts the patient surfaces first and keeps only Files and Side chat of the coding ones", () => {
    const actions = patientLauncherActions(upstream, patient, true);
    expect(actions.map((entry) => [entry.label, entry.shortcut])).toEqual([
      ["Summary", "S"],
      ["Labs", "L"],
      ["Plan", "P"],
      ["Timeline", "T"],
      ["Files", "F"],
      ["Side chat", "C"],
    ]);
    // One key opens one surface.
    expect(new Set(actions.map((entry) => entry.shortcut)).size).toBe(actions.length);
  });

  it("leaves upstream's launcher alone when the fork switch is off", () => {
    expect(patientLauncherActions(upstream, patient, false)).toBe(upstream);
  });
});
