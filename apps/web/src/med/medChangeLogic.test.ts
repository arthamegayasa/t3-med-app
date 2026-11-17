import type { MedLab, MedPatientDetails, MedPlan } from "@t3tools/contracts/med";
import { describe, expect, it } from "vite-plus/test";

import {
  correctedLabel,
  draftLabLabel,
  draftPlanLabel,
  followWritten,
  labActions,
  labCorrectionOf,
  labFormOf,
  noteRowsOf,
  patientEditOf,
  patientFormOf,
  patientUndoOf,
  planActions,
  planChangeOf,
  planFormOf,
  questionWaits,
  revisionChanges,
  rowsLabel,
} from "./medChangeLogic";

const lab: MedLab = {
  id: "l1",
  labTestId: "test-ldl",
  testId: "ldl",
  testName: "LDL cholesterol",
  testAsWritten: "LDL",
  value: 8,
  valueText: "8",
  unit: "mg/dL",
  referenceRange: "< 100",
  flag: null,
  collected: "2026-03-10",
  status: "verified",
  isBaseline: false,
  valueInBaselineUnit: null,
  changeFromBaseline: null,
  changePercent: null,
  changeUnit: null,
  notCompared: null,
  noteId: "note-1",
  revisions: [],
};

describe("labCorrectionOf", () => {
  const form = labFormOf(lab);

  it("sends nothing when the form says what the result already says", () => {
    expect(form).toEqual({
      testAsWritten: "LDL",
      valueText: "8",
      number: "8",
      unit: "mg/dL",
      referenceRange: "< 100",
      flag: "",
      collected: "2026-03-10",
    });
    expect(labCorrectionOf(lab, form)).toEqual({ change: null });
    expect(labCorrectionOf(lab, { ...form, unit: " mg/dL " })).toEqual({ change: null });
  });

  it("sends only what changed, and the number with the text as written", () => {
    expect(labCorrectionOf(lab, followWritten(form, "80"))).toEqual({
      change: { value: 80, valueText: "80" },
    });
    expect(
      labCorrectionOf(lab, { ...form, flag: "high", collected: "2026-03-11", unit: "mmol/L" }),
    ).toEqual({ change: { flag: "high", collected: "2026-03-11", unit: "mmol/L" } });
    expect(labCorrectionOf({ ...lab, flag: "high" }, form)).toEqual({ change: { flag: null } });
    expect(labCorrectionOf(lab, { ...form, testAsWritten: "HDL" })).toEqual({
      change: { testAsWritten: "HDL" },
    });
  });

  it("fills the number from a text that reads one way, and never keeps the old number", () => {
    expect(followWritten(form, "80").number).toBe("80");
    expect(followWritten(form, "-0.5").number).toBe("-0.5");
    expect(followWritten(form, "2,6").number).toBe("2.6");
    expect(followWritten(form, "1.234,5").number).toBe("1234.5");
    // Two readings or none: the number is emptied, never left saying what the text said before.
    expect(followWritten(form, "9.800").number).toBe("");
    expect(followWritten(form, "negative").number).toBe("");
    expect(labCorrectionOf(lab, followWritten(form, "2,6"))).toEqual({
      change: { value: 2.6, valueText: "2,6" },
    });
    expect(labCorrectionOf(lab, followWritten(form, "negative"))).toEqual({
      change: { value: null, valueText: "negative" },
    });
  });

  it("asks for the number when the text reads two ways, and refuses a pair that disagrees", () => {
    const ambiguous = followWritten(form, "9.800");
    expect(labCorrectionOf(lab, ambiguous)).toEqual({
      problem: "9.800 reads as 9.8 or 9800. Enter the number used for comparison.",
    });
    expect(labCorrectionOf(lab, { ...ambiguous, number: "9800" })).toEqual({
      change: { value: 9800, valueText: "9.800" },
    });
    expect(labCorrectionOf(lab, { ...form, valueText: "165", number: "" })).toEqual({
      problem: "165 reads as 165. Enter the number used for comparison.",
    });
    // The number typed alone, or kept beside a text that no longer says it.
    const disagree = {
      problem: "The result as written and the number used for comparison do not agree.",
    };
    expect(labCorrectionOf(lab, { ...form, number: "80" })).toEqual(disagree);
    expect(labCorrectionOf(lab, { ...form, valueText: "2,6", number: "8" })).toEqual(disagree);
    expect(labCorrectionOf(lab, { ...form, valueText: "negative", number: "8" })).toEqual({
      problem:
        "The result as written is not a number, so leave the number used for comparison empty.",
    });
  });

  it("refuses what the store would refuse, in the form's own words", () => {
    expect(labCorrectionOf(lab, { ...form, number: "eight" })).toEqual({
      problem: "Number must be a number, or empty for a result that is not one.",
    });
    expect(labCorrectionOf(lab, { ...form, valueText: " ", number: "" })).toEqual({
      problem: "Write the result as the sheet has it.",
    });
    expect(labCorrectionOf(lab, { ...form, testAsWritten: "" })).toEqual({
      problem: "The test needs a name.",
    });
    expect(labCorrectionOf(lab, { ...form, collected: "" })).toEqual({
      problem: "Choose the day the sample was collected.",
    });
  });
});

describe("revisionChanges", () => {
  const before = {
    id: "rev-1",
    correctedBy: "agent" as const,
    testAsWritten: "LDL",
    value: 8,
    valueText: "8",
    unit: "mg/dL",
    referenceRange: "< 100",
    flag: null,
    collected: "2026-03-10",
    status: "verified" as const,
    replacedAt: "2026-11-17T02:00:00.000Z",
  };

  it("says what a correction replaced, and nothing it left alone", () => {
    expect(revisionChanges({ ...lab, valueText: "80" }, before, "2026-11-17")).toEqual(["8 mg/dL"]);
    expect(
      revisionChanges(
        { ...lab, testAsWritten: "HDL", collected: "2026-03-11", flag: "high", referenceRange: "" },
        before,
        "2026-11-17",
      ),
    ).toEqual(["test LDL", "reference < 100", "no flag", "collected 10 Mar"]);
    expect(revisionChanges({ ...lab, unit: "mmol/L" }, before, "2026-11-17")).toEqual(["8 mg/dL"]);
  });

  it("says who corrected, and nobody when that was not recorded", () => {
    expect(correctedLabel(before, "2026-11-17")).toBe("corrected by agent, 17 Nov");
    expect(correctedLabel({ ...before, correctedBy: "doctor" }, "2026-11-17")).toBe(
      "corrected by you, 17 Nov",
    );
    expect(correctedLabel({ ...before, correctedBy: null }, "2026-11-17")).toBe("corrected 17 Nov");
  });
});

describe("a note's drafts", () => {
  const note = {
    draftLabRows: [
      {
        id: "l1",
        testName: "LDL cholesterol",
        valueText: "162",
        unit: "mg/dL",
        collected: "2026-11-06",
      },
      {
        id: "l2",
        testName: "Anti-dsDNA",
        valueText: "negative",
        unit: "",
        collected: "2026-11-06",
      },
    ],
    draftPlanRows: [{ id: "pl1", title: "Clinic visit", due: "2026-11-25" }],
  };

  it("names each draft, and verifies the rows listed and no others", () => {
    expect(note.draftLabRows.map((row) => draftLabLabel(row, "2026-11-17"))).toEqual([
      "LDL cholesterol 162 mg/dL, 6 Nov",
      "Anti-dsDNA negative, 6 Nov",
    ]);
    expect(draftPlanLabel(note.draftPlanRows[0]!, "2026-11-17")).toBe("Clinic visit, due 25 Nov");
    expect(noteRowsOf(note)).toEqual({ labIds: ["l1", "l2"], planIds: ["pl1"] });
    expect(rowsLabel(noteRowsOf(note))).toBe("2 results and 1 plan");
    expect(rowsLabel({ labIds: ["l1"], planIds: [] })).toBe("1 result");
    expect(rowsLabel({ labIds: [], planIds: [] })).toBeNull();
  });

  it("counts a question as waiting until it is marked as handled", () => {
    expect(questionWaits({ needsYou: "Which lab?", needsYouHandledAt: null })).toBe(true);
    expect(
      questionWaits({ needsYou: "Which lab?", needsYouHandledAt: "2026-11-17T02:00:00.000Z" }),
    ).toBe(false);
    expect(questionWaits({ needsYou: " ", needsYouHandledAt: null })).toBe(false);
  });
});

describe("row actions", () => {
  it("offers a result what its status allows, undo only after a correction", () => {
    expect(labActions({ status: "draft", revisions: [] })).toEqual(["verify", "correct", "remove"]);
    expect(labActions({ status: "verified", revisions: lab.revisions })).toEqual([
      "correct",
      "unverify",
      "remove",
    ]);
    expect(
      labActions({
        status: "draft",
        revisions: [
          {
            id: "rev-1",
            correctedBy: null,
            testAsWritten: "LDL",
            value: 8,
            valueText: "8",
            unit: "mg/dL",
            referenceRange: "",
            flag: null,
            collected: "2026-03-10",
            status: "verified",
            replacedAt: "2026-11-17T02:00:00.000Z",
          },
        ],
      }),
    ).toEqual(["verify", "correct", "undo-correction", "remove"]);
  });

  it("offers a plan what its status allows", () => {
    expect(planActions({ status: "draft" })).toEqual([
      "verify",
      "done",
      "cancel",
      "change",
      "remove",
    ]);
    expect(planActions({ status: "planned" })).toEqual([
      "done",
      "cancel",
      "change",
      "unverify",
      "remove",
    ]);
    expect(planActions({ status: "done" })).toEqual(["reopen", "change", "remove"]);
    expect(planActions({ status: "cancelled" })).toEqual(["reopen", "change", "remove"]);
  });
});

describe("planChangeOf", () => {
  const plan: MedPlan = {
    id: "p1",
    patientId: "patient-1",
    title: "Clinic visit",
    due: "2026-11-25",
    type: "follow_up",
    status: "planned",
    doneOn: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
  };

  it("sends only what changed, and the done day only of a plan that is done", () => {
    const form = planFormOf(plan);
    expect(planChangeOf(plan, form)).toEqual({ change: null });
    expect(planChangeOf(plan, { ...form, title: " Clinic visit, with MRI " })).toEqual({
      change: { title: "Clinic visit, with MRI" },
    });
    expect(planChangeOf(plan, { ...form, due: "2026-12-02", doneOn: "2026-11-20" })).toEqual({
      change: { due: "2026-12-02" },
    });
    const done = { ...plan, status: "done" as const, doneOn: "2026-11-20" };
    expect(planChangeOf(done, { ...planFormOf(done), doneOn: "2026-11-21" })).toEqual({
      change: { doneOn: "2026-11-21" },
    });
    expect(planChangeOf(plan, { ...form, title: " " })).toEqual({
      problem: "The plan needs a title.",
    });
    expect(planChangeOf(plan, { ...form, due: "" })).toEqual({ problem: "Choose a due date." });
  });
});

describe("patientEditOf", () => {
  const patient: MedPatientDetails = {
    id: "p1",
    name: "I Wayan Sudarma",
    urn: "00-45-67-89",
    status: "active",
    alsoWrittenAs: ["Pak Yan"],
    lastChatAt: null,
    sex: "male",
    dateOfBirth: "1968-03-02",
    diagnoses: "Ischemic stroke",
  };
  const form = patientFormOf(patient);

  it("sends only what changed, and an emptied field as none", () => {
    expect(patientEditOf(patient, form)).toEqual({ change: null });
    expect(
      patientEditOf(patient, {
        ...form,
        name: " I Wayan  Sudarma, S.H. ",
        urn: "",
        sex: "",
        dateOfBirth: "",
        diagnoses: "Ischemic stroke\nHypertension",
        alsoWrittenAs: "Pak Yan\n\n Pak Wayan \n",
      }),
    ).toEqual({
      change: {
        name: "I Wayan Sudarma, S.H.",
        urn: null,
        sex: null,
        dateOfBirth: null,
        diagnoses: "Ischemic stroke\nHypertension",
        alsoWrittenAs: ["Pak Yan", "Pak Wayan"],
      },
    });
    expect(patientEditOf(patient, { ...form, name: "" })).toEqual({
      problem: "The patient needs a name.",
    });
  });

  it("undoes an edit field by field, and only the spellings that edit changed", () => {
    // A rename kept the old name as a spelling; the undo takes that and the new name off.
    const renamed = { name: "Wayan S.", alsoWrittenAs: ["Pak Yan", "I Wayan Sudarma"] };
    expect(patientUndoOf(patient, renamed, { name: "Wayan S.", urn: null })).toEqual({
      name: "I Wayan Sudarma",
      urn: "00-45-67-89",
      removeSpellings: ["I Wayan Sudarma", "Wayan S."],
    });
    // The list is never sent whole: a spelling an agent adds after the edit is not named, so
    // it stays.
    expect(patientUndoOf(patient, renamed, { name: "Wayan S." })).not.toHaveProperty(
      "alsoWrittenAs",
    );
    // An edit of the list itself: what it took off goes back on, what it put on comes off.
    expect(
      patientUndoOf(
        patient,
        { name: patient.name, alsoWrittenAs: ["Pak Wayan"] },
        { alsoWrittenAs: ["Pak Wayan"] },
      ),
    ).toEqual({ removeSpellings: ["Pak Wayan"], addSpellings: ["Pak Yan"] });
    expect(patientUndoOf(patient, patient, { diagnoses: "Migraine" })).toEqual({
      diagnoses: "Ischemic stroke",
    });
  });
});
