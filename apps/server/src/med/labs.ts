/**
 * Lab result arithmetic. Everything here refuses rather than guesses: an unknown test, a qualified
 * or ambiguous test name, a missing unit, or a unit that does not belong to the test fails with a
 * `NoConversion` error, so the caller stores the result as written instead of a wrong number.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

class UnknownTestError extends Schema.TaggedError<UnknownTestError>()("UnknownTestError", {}) {
  override get message(): string {
    return "No verified conversion exists for this test.";
  }
}

class UnitNotForTestError extends Schema.TaggedError<UnitNotForTestError>()(
  "UnitNotForTestError",
  {},
) {
  override get message(): string {
    return "No verified conversion exists for this test between these units.";
  }
}

class UnitIsFilePathError extends Schema.TaggedError<UnitIsFilePathError>()(
  "UnitIsFilePathError",
  {},
) {
  override get message(): string {
    return "The unit is a file path, not a unit; write a unit that starts with / as cells/uL.";
  }
}

class MissingUnitError extends Schema.TaggedError<MissingUnitError>()("MissingUnitError", {}) {
  override get message(): string {
    return "A result without a unit cannot be converted or compared.";
  }
}

export type NoConversion =
  | UnknownTestError
  | UnitNotForTestError
  | UnitIsFilePathError
  | MissingUnitError;

// Each table maps a unit to how many base units one of that unit is worth; the base unit has
// factor 1. Factors are the standard SI conversion constants; tests pin them to published pairs.
const GLUCOSE = { "mg/dL": 1, "mmol/L": 18.016 };
const CHOLESTEROL = { "mg/dL": 1, "mmol/L": 38.67 };
const BILIRUBIN = { "mg/dL": 1, "umol/L": 1 / 17.104 };
const MASS_PER_VOLUME = { "g/dL": 1, "g/L": 0.1 };
const MONOVALENT_ION = { "mmol/L": 1, "mEq/L": 1 };
const CELL_COUNT = { "/uL": 1, "10^3/uL": 1e3, "10^9/L": 1e3 };
const ENZYME = { "U/L": 1 };

const UNIT_FACTORS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  glucose_fasting: GLUCOSE,
  glucose_random: GLUCOSE,
  glucose_2h_postprandial: GLUCOSE,
  cholesterol_total: CHOLESTEROL,
  ldl: CHOLESTEROL,
  hdl: CHOLESTEROL,
  triglycerides: { "mg/dL": 1, "mmol/L": 88.57 },
  creatinine: { "mg/dL": 1, "umol/L": 1 / 88.42 },
  urea: { "mg/dL": 1, "mmol/L": 6.006 },
  bun: { "mg/dL": 1, "mmol/L": 1 / 0.357 },
  uric_acid: { "mg/dL": 1, "umol/L": 1 / 59.48 },
  bilirubin_total: BILIRUBIN,
  bilirubin_direct: BILIRUBIN,
  bilirubin_indirect: BILIRUBIN,
  calcium: { "mg/dL": 1, "mmol/L": 4.008 },
  magnesium: { "mg/dL": 1, "mmol/L": 2.4305 },
  phosphate: { "mg/dL": 1, "mmol/L": 3.0974 },
  hemoglobin: MASS_PER_VOLUME,
  albumin: MASS_PER_VOLUME,
  total_protein: MASS_PER_VOLUME,
  sodium: MONOVALENT_ION,
  potassium: MONOVALENT_ION,
  chloride: MONOVALENT_ION,
  leukocytes: CELL_COUNT,
  platelets: CELL_COUNT,
  erythrocytes: { "/uL": 1, "10^6/uL": 1e6, "10^12/L": 1e6 },
  hematocrit: { "%": 1, "L/L": 100 },
  sgot: ENZYME,
  sgpt: ENZYME,
};

// Names as written on lab sheets (Indonesian and English), already normalised by `normaliseName`.
// Only whole names are listed: a name with a qualifier this table does not know ("Kreatinin
// (urin)", "Kalsium (ion)") is a different test, and abbreviations shared with another test
// (Tg, Cr, Ca) are left out. Fasting, random and 2-hour glucose never share a baseline.
const SYNONYMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ldl: [
    "ldl",
    "ldl c",
    "kolesterol ldl",
    "ldl kolesterol",
    "ldl cholesterol",
    "ldl direk",
    "ldl direct",
    "kolesterol ldl direk",
  ],
  hdl: ["hdl", "hdl c", "kolesterol hdl", "hdl kolesterol", "hdl cholesterol"],
  cholesterol_total: [
    "kolesterol total",
    "total kolesterol",
    "total cholesterol",
    "cholesterol total",
    "kolesterol",
    "cholesterol",
  ],
  triglycerides: ["trigliserida", "triglycerides", "triglyceride"],
  glucose_fasting: [
    "gdp",
    "gula darah puasa",
    "glukosa puasa",
    "glukosa darah puasa",
    "fasting glucose",
    "fasting blood glucose",
    "fbg",
    "fpg",
    "fbs",
  ],
  glucose_random: [
    "gds",
    "gula darah sewaktu",
    "glukosa sewaktu",
    "glukosa darah sewaktu",
    "random glucose",
    "random blood glucose",
    "rbg",
    "rbs",
  ],
  glucose_2h_postprandial: [
    "gd2pp",
    "gd2jpp",
    "gula darah 2 jam pp",
    "glukosa 2 jam pp",
    "glukosa darah 2 jam pp",
    "2 jam pp",
    "2h pp",
    "2 hour postprandial glucose",
  ],
  creatinine: ["kreatinin", "creatinine", "kreatinin serum", "serum creatinine"],
  urea: ["ureum", "urea"],
  bun: ["bun", "blood urea nitrogen"],
  uric_acid: ["asam urat", "uric acid"],
  bilirubin_total: ["bilirubin total", "total bilirubin"],
  bilirubin_direct: ["bilirubin direk", "bilirubin direct", "direct bilirubin"],
  bilirubin_indirect: ["bilirubin indirek", "bilirubin indirect", "indirect bilirubin"],
  calcium: ["kalsium", "calcium", "kalsium total", "total calcium"],
  magnesium: ["magnesium"],
  phosphate: ["fosfat", "phosphate", "fosfor", "phosphorus"],
  hemoglobin: ["hb", "hgb", "hemoglobin", "haemoglobin"],
  albumin: ["albumin"],
  total_protein: ["protein total", "total protein"],
  sodium: ["natrium", "sodium", "na"],
  potassium: ["kalium", "potassium", "k"],
  chloride: ["klorida", "chloride", "cl"],
  leukocytes: ["leukosit", "lekosit", "leukocytes", "wbc"],
  platelets: ["trombosit", "platelets", "plt", "thrombocytes"],
  erythrocytes: ["eritrosit", "erythrocytes", "rbc"],
  hematocrit: ["ht", "hct", "hematokrit", "hematocrit"],
  sgot: ["sgot", "ast", "sgot ast", "ast sgot"],
  sgpt: ["sgpt", "alt", "sgpt alt", "alt sgpt"],
  hba1c: ["hba1c", "a1c", "hb a1c", "glycated hemoglobin"],
};

/** Every Test ID of the catalogue. */
export const TEST_IDS: ReadonlyArray<string> = Object.keys(SYNONYMS);

const NAME_TO_TEST_ID = new Map(
  Object.entries(SYNONYMS).flatMap(([testId, names]) => [
    ...names.map((name) => [name, testId] as const),
    [testId.replaceAll("_", " "), testId] as const,
  ]),
);

// One English name per Test ID, so a test reads the same whichever sheet first named it.
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ldl: "LDL cholesterol",
  hdl: "HDL cholesterol",
  cholesterol_total: "Total cholesterol",
  triglycerides: "Triglycerides",
  glucose_fasting: "Fasting glucose",
  glucose_random: "Random glucose",
  glucose_2h_postprandial: "2-hour postprandial glucose",
  creatinine: "Creatinine",
  urea: "Urea",
  bun: "Blood urea nitrogen",
  uric_acid: "Uric acid",
  bilirubin_total: "Total bilirubin",
  bilirubin_direct: "Direct bilirubin",
  bilirubin_indirect: "Indirect bilirubin",
  calcium: "Calcium",
  magnesium: "Magnesium",
  phosphate: "Phosphate",
  hemoglobin: "Hemoglobin",
  albumin: "Albumin",
  total_protein: "Total protein",
  sodium: "Sodium",
  potassium: "Potassium",
  chloride: "Chloride",
  leukocytes: "Leukocytes",
  platelets: "Platelets",
  erythrocytes: "Erythrocytes",
  hematocrit: "Hematocrit",
  sgot: "AST (SGOT)",
  sgpt: "ALT (SGPT)",
  hba1c: "HbA1c",
};

/** The English name of a known Test ID; null for a test that has none. */
export const testDisplayName = (testId: string | null): string | null =>
  testId !== null && Object.hasOwn(DISPLAY_NAMES, testId) ? DISPLAY_NAMES[testId]! : null;

// Lower-cased spellings mapped to the unit as this module writes it.
const UNIT_SPELLINGS = new Map([
  ["mg/dl", "mg/dL"],
  ["mg%", "mg/dL"],
  ["mmol/l", "mmol/L"],
  ["umol/l", "umol/L"],
  ["g/dl", "g/dL"],
  ["g%", "g/dL"],
  ["gr/dl", "g/dL"],
  ["g/l", "g/L"],
  ["meq/l", "mEq/L"],
  ["/ul", "/uL"],
  ["10^3/ul", "10^3/uL"],
  ["ribu/ul", "10^3/uL"],
  ["10^9/l", "10^9/L"],
  ["10^6/ul", "10^6/uL"],
  ["juta/ul", "10^6/uL"],
  ["10^12/l", "10^12/L"],
  ["%", "%"],
  ["l/l", "L/L"],
  ["u/l", "U/L"],
  ["iu/l", "U/L"],
  ["mmol/mol", "mmol/mol"],
]);

const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  "²": "2",
  "³": "3",
  "⁶": "6",
  "⁹": "9",
  "¹": "1",
};

const normaliseName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// A symbol outside this set changes what is measured ("Kalsium++" is ionised calcium,
// "µ-Albumin" is urine microalbumin), so such a name is never matched.
const PLAIN_NAME = /^[A-Za-z0-9\s\-_.,/()]*$/;

/** The Test ID for a test name as written, or null. */
export const resolveTest = (name: string): string | null =>
  PLAIN_NAME.test(name) ? (NAME_TO_TEST_ID.get(normaliseName(name)) ?? null) : null;

/**
 * The unit in this module's spelling. An unknown unit comes back cleaned but with its case kept,
 * because case can carry meaning (mU and MU differ a billionfold).
 */
export const normaliseUnit = (unit: string): Result.Result<string, NoConversion> => {
  const cleaned = unit.trim().replaceAll(" ", "").replaceAll("µ", "u").replaceAll("μ", "u");
  // Two results with the unit left off are not known to share a unit.
  if (cleaned === "") return Result.fail(new MissingUnitError());
  // Git Bash rewrites an argument such as /uL into a Windows path.
  if (cleaned.includes(":") || cleaned.includes("\\")) {
    return Result.fail(new UnitIsFilePathError());
  }
  const text = cleaned
    .toLowerCase()
    .replace(
      /10([²³⁶⁹]|¹²)/g,
      (_, exponent: string) => `10^${[...exponent].map((digit) => SUPERSCRIPTS[digit]).join("")}`,
    )
    .replace(/^x(?=10\^)/, "")
    .replaceAll("/mm3", "/ul")
    .replace(/^(cells|sel)(?=\/)/, "");
  return Result.succeed(UNIT_SPELLINGS.get(text) ?? cleaned);
};

// HbA1c units are not proportional. NGSP/IFCC master equation: mmol/mol = 10.929 * (percent - 2.15).
const convertHba1c = (
  value: number,
  source: string,
  target: string,
): Result.Result<number, NoConversion> => {
  if (source === "%" && target === "mmol/mol") return Result.succeed(10.929 * (value - 2.15));
  if (source === "mmol/mol" && target === "%") return Result.succeed(value / 10.929 + 2.15);
  return Result.fail(new UnitNotForTestError());
};

/** `value` expressed in `toUnit` for the named test. */
export const convert = (
  test: string,
  value: number,
  fromUnit: string,
  toUnit: string,
): Result.Result<number, NoConversion> => {
  const source = normaliseUnit(fromUnit);
  if (Result.isFailure(source)) return Result.fail(source.failure);
  const target = normaliseUnit(toUnit);
  if (Result.isFailure(target)) return Result.fail(target.failure);
  if (source.success === target.success) return Result.succeed(value);
  const testId = resolveTest(test);
  if (testId === "hba1c") return convertHba1c(value, source.success, target.success);
  const factors = testId === null ? undefined : UNIT_FACTORS[testId];
  if (factors === undefined) return Result.fail(new UnknownTestError());
  if (!Object.hasOwn(factors, source.success) || !Object.hasOwn(factors, target.success)) {
    return Result.fail(new UnitNotForTestError());
  }
  return Result.succeed((value * factors[source.success]!) / factors[target.success]!);
};

/**
 * `value` in the baseline's unit and its change from the baseline, which is the patient's
 * earliest-collected result for the test.
 */
export const compareToBaseline = (input: {
  readonly test: string;
  readonly baseline: number;
  readonly baselineUnit: string;
  readonly value: number;
  readonly unit: string;
}) =>
  Result.gen(function* () {
    const value = yield* convert(input.test, input.value, input.unit, input.baselineUnit);
    const change = value - input.baseline;
    return {
      value,
      unit: yield* normaliseUnit(input.baselineUnit),
      change,
      // Relative to the baseline's size, so the sign follows the change.
      changePercent: input.baseline === 0 ? null : (change / Math.abs(input.baseline)) * 100,
    };
  });
