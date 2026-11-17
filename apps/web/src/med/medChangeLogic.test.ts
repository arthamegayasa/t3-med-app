import type { MedLab, MedPatientDetails, MedPlan } from "@t3tools/contracts/med";
import { describe, expect, it } from "vite-plus/test";

import {
  followWritten,
  labActions,
  labCorrectionOf,
  labFormOf,
  patientEditOf,
  patientFormOf,
  patientUndoOf,
  planActions,
  planChangeOf,
  planFormOf,
  revisionChanges,
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

  it("follows a plainly written number, and never guesses at any other text", () => {
    expect(followWritten(form, "80").number).toBe("80");
    expect(followWritten(form, "-0.5").number).toBe("-0.5");
    // A comma is a decimal mark on one sheet and a thousands mark on another: the doctor says.
    expect(followWritten(form, "2,6").number).toBe("8");
    expect(followWritten(form, "negative").number).toBe("8");
    expect(labCorrectionOf(lab, { ...form, valueText: "2,6", number: "2.6" })).toEqual({
      change: { value: 2.6, valueText: "2,6" },
    });
    expect(labCorrectionOf(lab, { ...form, valueText: "negative", number: "" })).toEqual({
      change: { value: null, valueText: "negative" },
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

  it("undoes an edit with what the patient had, spellings included", () => {
    // A rename keeps the old name as a spelling, so the undo puts the old list back too.
    expect(patientUndoOf(patient, { name: "Wayan S.", urn: null })).toEqual({
      name: "I Wayan Sudarma",
      urn: "00-45-67-89",
      alsoWrittenAs: ["Pak Yan"],
    });
    expect(patientUndoOf(patient, { status: "archived" })).toEqual({
      status: "active",
      alsoWrittenAs: ["Pak Yan"],
    });
  });
});
