import type { MedLab, MedNote, MedPlan } from "@t3tools/contracts/med";
import { describe, expect, it } from "vite-plus/test";

import {
  changeLabel,
  chartGeometry,
  describeSeries,
  draftCounts,
  formatLabNumber,
  groupLabTests,
  labSeries,
  nextPlans,
  notOnChartLabel,
  patientLauncherActions,
  patientTimeline,
  plansForPanel,
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
        {
          id: "l1",
          collected: "2026-08-21",
          value: 162,
          label: "162",
          written: "162 mg/dL",
          converted: false,
          draft: false,
          baseline: true,
        },
        // Written in mmol/L: the label is the store's number in the chart's unit.
        {
          id: "l2",
          collected: "2026-09-18",
          value: 128,
          label: "128",
          written: "3.31 mmol/L",
          converted: true,
          draft: false,
          baseline: false,
        },
        {
          id: "l3",
          collected: "2026-11-06",
          value: 78,
          label: "78",
          written: "78 mg/dL",
          converted: false,
          draft: true,
          baseline: false,
        },
      ],
      notNumeric: 0,
      notConverted: 1,
    });
  });

  it("labels a point with the result as written, as the table shows it", () => {
    const first = { ...baseline, value: 0.9, valueText: "0.90" };
    const second = lab({
      id: "c2",
      collected: "2026-11-06",
      value: 1,
      valueText: "1.0",
      valueInBaselineUnit: 1,
    });
    expect(labSeries([first, second])?.points.map((point) => point.label)).toEqual(["0.90", "1.0"]);
  });

  it("never plots a value the store did not express in the baseline's unit", () => {
    // 3.31 mmol/L beside 162 mg/dL would read as a fall to almost nothing.
    const uncompared = { ...converted, valueInBaselineUnit: null, changeFromBaseline: null };
    expect(labSeries([baseline, uncompared])?.points.map((point) => point.value)).toEqual([162]);
  });

  it("counts what is not a number apart from what could not be converted", () => {
    const words = { ...antibody, id: "l5", labTestId: "test-ldl" };
    const uncompared = { ...converted, id: "l6", valueInBaselineUnit: null };
    const series = labSeries([baseline, words, unitless, uncompared]);
    expect(series).toMatchObject({ notNumeric: 1, notConverted: 2 });
    expect(series === null ? null : notOnChartLabel(series)).toBe(
      "Not on the chart: 1 result is not a number, 2 could not be converted to mg/dL.",
    );
    expect(notOnChartLabel({ unit: "%", notNumeric: 2, notConverted: 0 })).toBe(
      "Not on the chart: 2 results are not numbers.",
    );
    expect(notOnChartLabel({ unit: "%", notNumeric: 0, notConverted: 1 })).toBe(
      "Not on the chart: 1 result could not be converted to %.",
    );
    expect(notOnChartLabel({ unit: "%", notNumeric: 0, notConverted: 0 })).toBeNull();
  });

  it("has no series for a test with no numeric baseline", () => {
    expect(labSeries([antibody])).toBeNull();
    expect(labSeries([])).toBeNull();
  });
});

describe("describeSeries", () => {
  it("says of every point whether it is a draft or verified, the baseline included", () => {
    const series = labSeries([{ ...baseline, status: "draft" }, converted, draft]);
    expect(series === null ? null : describeSeries("LDL cholesterol", series)).toBe(
      "LDL cholesterol in mg/dL: 162 on 21 Aug 2026 (baseline, draft), 128 on 18 Sept 2026 (verified), 78 on 6 Nov 2026 (draft).",
    );
  });
});

describe("chartGeometry", () => {
  const point = (id: string, collected: string, value: number, isBaseline = false) => ({
    id,
    collected,
    value,
    label: String(value),
    written: String(value),
    converted: false,
    draft: false,
    baseline: isBaseline,
  });
  const series = (points: ReadonlyArray<ReturnType<typeof point>>) => ({
    unit: "mg/dL",
    notNumeric: 0,
    notConverted: 0,
    points,
  });

  it("spaces points by the days between them and puts the highest value at the top", () => {
    // 21 Aug to 18 Sep is 28 days of the 77 to 6 Nov; 128 is 34 of the 84 between 162 and 78.
    const geometry = chartGeometry({
      unit: "mg/dL",
      notNumeric: 0,
      notConverted: 0,
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
      notNumeric: 0,
      notConverted: 0,
      points: [point("c1", "2026-08-21", 0.9, true), point("c2", "2026-11-06", 1)],
    });
    expect(geometry.points.map(({ y }) => Math.round(y))).toEqual([70, 30]);
  });

  it("centres a single result, and results that do not differ", () => {
    const one = chartGeometry({
      unit: "%",
      notNumeric: 0,
      notConverted: 0,
      points: [point("h1", "2026-09-18", 8.1, true)],
    });
    expect(one.points.map(({ x, y }) => [x, y])).toEqual([[50, 50]]);
    const flat = chartGeometry(
      series([point("h1", "2026-09-18", 8.1, true), point("h2", "2026-11-06", 8.1)]),
    );
    expect(flat.points.map(({ x, y }) => [x, y])).toEqual([
      [0, 50],
      [100, 50],
    ]);
  });

  it("lays results of one day side by side in filing order, never on one spot", () => {
    // Two results on the last day: the day keeps its place at the right edge and the earlier
    // filing sits a step before it.
    const geometry = chartGeometry(
      series([
        point("l1", "2026-08-21", 162, true),
        point("l2", "2026-11-06", 128),
        point("l3", "2026-11-06", 78),
      ]),
    );
    expect(geometry.points.map(({ x }) => x)).toEqual([0, 92, 100]);
    expect(geometry.points.map(({ labelBelow }) => labelBelow)).toEqual([false, false, true]);
    // A day in the middle keeps its share of the days on either side of its results.
    const middle = chartGeometry(
      series([
        point("m1", "2026-11-01", 5, true),
        point("m2", "2026-11-06", 6),
        point("m3", "2026-11-06", 7),
        point("m4", "2026-11-11", 8),
      ]),
    );
    expect(middle.points.map(({ x }) => x)).toEqual([0, 46, 54, 100]);
    // Every result on one day: a row around the middle, since no time passed between them.
    const oneDay = chartGeometry(
      series([
        point("d1", "2026-11-06", 5, true),
        point("d2", "2026-11-06", 6),
        point("d3", "2026-11-06", 7),
      ]),
    );
    expect(oneDay.points.map(({ x }) => x)).toEqual([42, 50, 58]);
  });
});

describe("changeLabel", () => {
  it.each([
    [baseline, "Baseline"],
    [converted, "−34 mg/dL (−21%)"],
    [{ ...converted, changeFromBaseline: 12.25, changePercent: 7.6 }, "+12.25 mg/dL (+7.6%)"],
    // A small change is never shown as none, and keeps its sign.
    [
      { ...converted, changeFromBaseline: 0.004, changePercent: 100, changeUnit: "ng/mL" },
      "+0.004 ng/mL (+100%)",
    ],
    [{ ...converted, changeFromBaseline: -0.4, changePercent: -0.25 }, "−0.4 mg/dL (−0.25%)"],
    // What binary arithmetic leaves behind a subtraction is not shown.
    [
      { ...converted, changeFromBaseline: 0.012 - 0.008, changePercent: 50.000000000000014 },
      "+0.004 mg/dL (+50%)",
    ],
    [{ ...converted, changeFromBaseline: 0, changePercent: 0 }, "0 mg/dL (0%)"],
    // What a unit conversion leaves behind in the last binary digit is no change.
    [{ ...converted, changeFromBaseline: 2.8e-14, changePercent: 1.7e-14 }, "0 mg/dL (0%)"],
    [{ ...converted, changeFromBaseline: 4, changePercent: null }, "+4 mg/dL"],
    [unitless, "Not compared: no unit"],
    [antibody, "No number to compare"],
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
    [149.6, "149.6"],
    [12.25, "12.25"],
    [7.4, "7.4"],
    [0.857, "0.857"],
    // Small values stay themselves and apart from each other, and none reads as zero.
    [0.004, "0.004"],
    [0.008, "0.008"],
    [0.012, "0.012"],
    [0.012 - 0.008, "0.004"],
    [0.00001234, "0.00001234"],
    [-0.004, "−0.004"],
    // No digit before the decimal point is ever rounded away.
    [1234567.8, "1234568"],
    [-84, "−84"],
    [0, "0"],
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

describe("patientTimeline", () => {
  it("keeps open plans out of the history: coming up soonest first, history newest first", () => {
    const note = (id: string, date: string): MedNote => ({
      id,
      threadId: null,
      title: id,
      date,
      summary: "",
      needsYou: "",
    });
    const timeline = patientTimeline({
      labs: [baseline, hba1c, converted, antibody, draft],
      plans: [
        plan("mri", "2026-12-01", "planned"),
        plan("visit", "2026-11-14", "draft"),
        // Overdue and still open: it is yet to happen, so it is not history.
        plan("overdue", "2026-11-02", "planned"),
        plan("eeg", "2026-09-18", "done"),
        plan("dropped", "2026-11-20", "cancelled"),
      ],
      notes: [note("n-nov", "2026-11-06"), note("n-sep", "2026-09-18")],
    });
    expect(timeline.comingUp.map((entry) => entry.id)).toEqual(["overdue", "visit", "mri"]);
    expect(
      timeline.history.map((entry) =>
        entry.kind === "labs"
          ? [entry.day, "labs", entry.labs.map((result) => result.id)]
          : entry.kind === "plan"
            ? [entry.day, "plan", entry.plan.id]
            : [entry.day, "note", entry.note.id],
      ),
    ).toEqual([
      ["2026-11-20", "plan", "dropped"],
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
  const action = (label: string, shortcut: string, id?: string) => ({
    label,
    shortcut,
    icon: () => null,
    available: true,
    disabledReason: "",
    onClick: () => {},
    ...(id === undefined ? {} : { id }),
  });
  const upstream = [
    action("Browser", "B"),
    action("Terminal", "T"),
    action("Files", "F", "files"),
    action("Diff", "D"),
    action("Pull request", "P"),
    action("Linked pull requests", "L"),
    action("Device", "M"),
    action("Side chat", "S", "side-chat"),
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

  it("keeps a surface by its id, whatever upstream calls it", () => {
    const renamed = [action("Documents", "F", "files"), action("Ask aside", "S", "side-chat")];
    expect(
      patientLauncherActions(renamed, [], true).map((entry) => [entry.label, entry.shortcut]),
    ).toEqual([
      ["Documents", "F"],
      ["Ask aside", "C"],
    ]);
    // A row that only has a kept row's label is not kept.
    expect(patientLauncherActions([action("Files", "F")], [], true)).toEqual([]);
  });

  it("leaves upstream's launcher alone when the fork switch is off", () => {
    expect(patientLauncherActions(upstream, patient, false)).toBe(upstream);
  });
});
