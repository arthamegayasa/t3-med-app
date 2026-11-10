import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { compareToBaseline, convert, normaliseUnit, resolveTest } from "./labs.ts";

// Mirrors pytest.approx: an absolute tolerance alone ignores the relative one.
const expectApprox = (
  actual: number,
  expected: number,
  tolerance: { readonly rel?: number; readonly abs?: number } = {},
) => {
  const allowed =
    tolerance.rel === undefined && tolerance.abs !== undefined
      ? tolerance.abs
      : Math.max((tolerance.rel ?? 1e-6) * Math.abs(expected), tolerance.abs ?? 1e-12);
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(allowed);
};

const converted = (...args: Parameters<typeof convert>) => Result.getOrThrow(convert(...args));

const refusal = <A>(result: Result.Result<A, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : "converted";

// Expected values are published pairs, not recomputed with the factors the code uses: the SI
// conversion table of the AMA Manual of Style, and the LDL threshold that NCEP ATP III and
// ESC/EAS state in both units (100 mg/dL is 2.6 mmol/L). Published pairs are rounded.
describe("convert", () => {
  it("converts LDL in mmol/L to mg/dL", () => {
    expectApprox(converted("LDL", 2.6, "mmol/L", "mg/dL"), 100, { rel: 1e-2 });
  });

  it.each([
    ["glucose_fasting", 100, "mg/dL", "mmol/L", 5.55],
    ["cholesterol_total", 200, "mg/dL", "mmol/L", 5.17],
    ["ldl", 100, "mg/dL", "mmol/L", 2.59],
    ["hdl", 40, "mg/dL", "mmol/L", 1.03],
    ["triglycerides", 150, "mg/dL", "mmol/L", 1.69],
    ["creatinine", 1.0, "mg/dL", "umol/L", 88.4],
    ["urea", 30, "mg/dL", "mmol/L", 5.0],
    ["bun", 14, "mg/dL", "mmol/L", 5.0],
    ["uric_acid", 6.0, "mg/dL", "umol/L", 357],
    ["bilirubin_total", 1.0, "mg/dL", "umol/L", 17.1],
    ["calcium", 10.0, "mg/dL", "mmol/L", 2.5],
    ["magnesium", 2.0, "mg/dL", "mmol/L", 0.82],
    ["phosphate", 3.0, "mg/dL", "mmol/L", 0.97],
    ["hemoglobin", 14.0, "g/dL", "g/L", 140],
    ["albumin", 4.0, "g/dL", "g/L", 40],
    ["sodium", 140, "mEq/L", "mmol/L", 140],
    ["potassium", 4.0, "mEq/L", "mmol/L", 4.0],
    ["leukocytes", 9800, "/uL", "10^3/uL", 9.8],
    ["leukocytes", 9.8, "10^3/uL", "10^9/L", 9.8],
    ["platelets", 256000, "/uL", "10^3/uL", 256],
    ["erythrocytes", 4.5, "10^6/uL", "10^12/L", 4.5],
    ["hematocrit", 42, "%", "L/L", 0.42],
  ] as const)(
    "converts %s %d %s to %s and back (AMA SI table)",
    (test, value, fromUnit, toUnit, expected) => {
      expectApprox(converted(test, value, fromUnit, toUnit), expected, { rel: 6e-3 });
      expectApprox(converted(test, expected, toUnit, fromUnit), value, { rel: 6e-3 });
    },
  );

  it("returns the value unchanged when the unit is the same", () => {
    expect(converted("sgpt", 37, "U/L", "U/L")).toBe(37);
  });
});

// The helper must refuse rather than guess, and must read units and test names the way
// Indonesian lab sheets actually write them.
describe("refusals", () => {
  it("refuses an unknown test instead of guessing", () => {
    expect(refusal(convert("procalcitonin", 0.5, "ng/mL", "ug/L"))).toBe("NoConversion");
  });

  it("refuses a unit that does not belong to the test", () => {
    expect(refusal(convert("ldl", 100, "mg/dL", "g/L"))).toBe("NoConversion");
    expect(refusal(convert("ldl", 100, "toString", "mg/dL"))).toBe("NoConversion");
  });

  it("returns an unknown test with identical units unchanged", () => {
    expect(converted("procalcitonin", 0.5, "ng/mL", "ng/mL")).toBe(0.5);
  });

  it("does not treat unknown units that differ only in case as the same", () => {
    expect(refusal(convert("procalcitonin", 5, "mU/L", "MU/L"))).toBe("NoConversion");
    expect(Result.getOrThrow(normaliseUnit(" mU / L "))).toBe("mU/L");
  });

  it("refuses a unit mangled into a file path", () => {
    const mangled = "C:/Program Files/Git/uL";
    expect(refusal(convert("Leukosit", 9800, mangled, mangled))).toBe("NoConversion");
    expect(refusal(normaliseUnit("\\Git\\uL"))).toBe("NoConversion");
  });
});

describe("units as lab sheets write them", () => {
  it.each([
    ["mg/dl", "ldl", "mmol/L", 100, 2.59],
    ["MG/DL", "ldl", "mmol/L", 100, 2.59],
    ["mg%", "glucose_random", "mmol/L", 100, 5.55],
    ["mmol/l", "ldl", "mg/dL", 2.59, 100],
    ["µmol/L", "creatinine", "mg/dL", 88.4, 1.0], // micro sign
    ["μmol/L", "creatinine", "mg/dL", 88.4, 1.0], // Greek mu
    ["umol/l", "creatinine", "mg/dL", 88.4, 1.0],
    ["g%", "hemoglobin", "g/L", 14, 140],
    ["gr/dL", "hemoglobin", "g/L", 14, 140],
    ["ribu/µL", "leukocytes", "/uL", 9.8, 9800],
    ["10³/µL", "leukocytes", "/uL", 9.8, 9800],
    ["x10^3/uL", "leukocytes", "/uL", 9.8, 9800],
    ["/mm3", "leukocytes", "10^3/uL", 9800, 9.8],
    ["/µL", "platelets", "10^3/uL", 256000, 256],
    ["juta/uL", "erythrocytes", "10^12/L", 4.5, 4.5],
    ["meq/l", "sodium", "mmol/L", 140, 140],
    ["IU/L", "sgpt", "U/L", 37, 37],
  ] as const)("reads %s for %s", (written, test, toUnit, value, expected) => {
    expectApprox(converted(test, value, written, toUnit), expected, { rel: 1e-2 });
  });

  it.each(["cells/uL", "sel/µL", "Cells/uL"])(
    "reads a count per microlitre written as %s",
    (written) => {
      expectApprox(converted("Leukosit", 9800, written, "10^3/uL"), 9.8, { rel: 6e-3 });
    },
  );
});

describe("resolveTest", () => {
  it.each([
    ["LDL", "ldl"],
    ["Kolesterol LDL", "ldl"],
    ["LDL-C", "ldl"],
    ["LDL Direk", "ldl"],
    ["Kolesterol Total", "cholesterol_total"],
    ["Trigliserida", "triglycerides"],
    ["GDP", "glucose_fasting"],
    ["Gula Darah Puasa", "glucose_fasting"],
    ["GDS", "glucose_random"],
    ["Gula darah sewaktu", "glucose_random"],
    ["GD2PP", "glucose_2h_postprandial"],
    ["Kreatinin", "creatinine"],
    ["Ureum", "urea"],
    ["BUN", "bun"],
    ["Asam Urat", "uric_acid"],
    ["Hb", "hemoglobin"],
    ["Hemoglobin", "hemoglobin"],
    ["Leukosit", "leukocytes"],
    ["Trombosit", "platelets"],
    ["Eritrosit", "erythrocytes"],
    ["Hematokrit", "hematocrit"],
    ["Natrium", "sodium"],
    ["Kalium", "potassium"],
    ["SGOT", "sgot"],
    ["AST", "sgot"],
    ["SGPT (ALT)", "sgpt"],
    ["HbA1c", "hba1c"],
  ] as const)("resolves %s to %s", (written, expected) => {
    expect(resolveTest(written)).toBe(expected);
  });

  it("never merges fasting and random glucose", () => {
    expect(resolveTest("GDP")).not.toBe(resolveTest("GDS"));
  });

  it("resolves an unrecognised name to nothing", () => {
    expect(resolveTest("Anti-NMDA receptor antibody")).toBeNull();
  });

  it("lets convert accept the name as written on the sheet", () => {
    expectApprox(converted("Kolesterol LDL", 100, "mg/dl", "mmol/l"), 2.59, { rel: 1e-2 });
  });

  it.each([
    "Urea (BUN)", // ambiguous between two tests with different factors
    "BUN (Ureum)",
    "Kreatinin (urin)", // urine, not serum
    "Kalsium (ion)", // ionised, not total
    "Ca++",
    "Hb (glikosilasi)",
    "Hemoglobin (HbA1c)",
    "Tg", // thyroglobulin or triglycerides
    "Cr",
  ])("resolves the qualified or ambiguous name %s to nothing", (written) => {
    expect(resolveTest(written)).toBeNull();
  });
});

// HbA1c pairs come from the NGSP/IFCC conversion table. Baseline changes are worked by hand from
// published pairs (LDL 2.6 mmol/L is 100 mg/dL), never from the factor under test.
describe("HbA1c", () => {
  it.each([
    [5.0, 31],
    [6.0, 42],
    [6.5, 48],
    [7.0, 53],
    [8.0, 64],
    [10.0, 86],
  ])("converts %d percent to %d mmol/mol and back (NGSP/IFCC table)", (percent, mmolPerMol) => {
    expectApprox(converted("HbA1c", percent, "%", "mmol/mol"), mmolPerMol, { abs: 0.6 });
    expectApprox(converted("HbA1c", mmolPerMol, "mmol/mol", "%"), percent, { abs: 0.06 });
  });

  it("refuses any other pair of HbA1c units", () => {
    expect(refusal(convert("HbA1c", 6.5, "%", "g/dL"))).toBe("NoConversion");
  });
});

describe("compareToBaseline", () => {
  const compared = (...args: Parameters<typeof compareToBaseline>) =>
    Result.getOrThrow(compareToBaseline(...args));

  it("compares a later result in the same unit with the baseline", () => {
    const result = compared({
      test: "LDL",
      baseline: 162,
      baselineUnit: "mg/dL",
      value: 78,
      unit: "mg/dL",
    });
    expect(result.value).toBe(78);
    expect(result.unit).toBe("mg/dL");
    expectApprox(result.change, -84);
    expectApprox(result.changePercent!, -51.9, { abs: 0.1 });
  });

  it("converts a later result in another unit to the baseline unit first", () => {
    // 2.6 mmol/L is 100 mg/dL; 100 - 190 = -90; -90 / 190 = -47.4 %.
    const result = compared({
      test: "LDL",
      baseline: 190,
      baselineUnit: "mg/dL",
      value: 2.6,
      unit: "mmol/L",
    });
    expectApprox(result.value, 100, { rel: 1e-2 });
    expect(result.unit).toBe("mg/dL");
    expectApprox(result.change, -90, { abs: 1.0 });
    expectApprox(result.changePercent!, -47.4, { abs: 0.6 });
  });

  it("reports a rise from baseline as positive", () => {
    const result = compared({
      test: "Kreatinin",
      baseline: 0.9,
      baselineUnit: "mg/dL",
      value: 1.0,
      unit: "mg/dL",
    });
    expectApprox(result.change, 0.1);
    expectApprox(result.changePercent!, 11.1, { abs: 0.1 });
  });

  it("refuses the comparison when the units cannot be converted", () => {
    expect(
      refusal(
        compareToBaseline({
          test: "LDL",
          baseline: 162,
          baselineUnit: "mg/dL",
          value: 2.0,
          unit: "g/L",
        }),
      ),
    ).toBe("NoConversion");
  });

  it("gives no percentage change for a zero baseline", () => {
    const result = compared({
      test: "sgpt",
      baseline: 0,
      baselineUnit: "U/L",
      value: 12,
      unit: "U/L",
    });
    expect(result.change).toBe(12);
    expect(result.changePercent).toBeNull();
  });
});
