/** T3 Med: what the patient pages decide before they draw, kept free of React. */

const DAY_MS = 86_400_000;

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_AND_YEAR_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// A calendar day as UTC midnight, so days subtract without daylight-saving drift.
function dayMs(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** The calendar day on this machine's clock, written as the store writes dates. */
export function localIsoDate(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** Full years from the date of birth to `today`; null when it is unknown or not yet reached. */
export function ageOn(dateOfBirth: string | null, today: string): number | null {
  if (dateOfBirth === null || dayMs(dateOfBirth) === null || dateOfBirth > today) return null;
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** A plan is overdue from the day after it was due. */
export function isOverdue(due: string, today: string): boolean {
  return due < today;
}

export function overdueLabel(due: string, today: string): string | null {
  const dueMs = dayMs(due);
  const todayMs = dayMs(today);
  if (dueMs === null || todayMs === null || !isOverdue(due, today)) return null;
  const days = Math.round((todayMs - dueMs) / DAY_MS);
  return `Overdue ${days} ${days === 1 ? "day" : "days"}`;
}

/** `6 Nov`, with the year when it is not this year's. Text that is no date is shown as it is. */
export function formatDay(isoDate: string, today: string): string {
  const ms = dayMs(isoDate);
  if (ms === null) return isoDate;
  const format = isoDate.slice(0, 4) === today.slice(0, 4) ? DAY_FORMAT : DAY_AND_YEAR_FORMAT;
  return format.format(ms);
}

/** When a patient was last worked on: by day, so the label cannot go stale within one. */
export function formatLastActivity(timestamp: string, today: string): string {
  const at = new Date(timestamp);
  const todayMs = dayMs(today);
  if (Number.isNaN(at.getTime()) || todayMs === null) return "";
  const day = localIsoDate(at);
  if (day === today) return "Today";
  if (dayMs(day) === todayMs - DAY_MS) return "Yesterday";
  return formatDay(day, today);
}

const nameKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

// The store's URN key: upper case, letters and digits only.
const urnKey = (urn: string) => urn.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The patients a search means: its text inside the name or another spelling, or its URN key
 * inside the patient's, so a URN is found however it is punctuated.
 */
export function filterPatients<
  P extends {
    readonly name: string;
    readonly urn: string | null;
    readonly alsoWrittenAs: ReadonlyArray<string>;
  },
>(patients: ReadonlyArray<P>, query: string): ReadonlyArray<P> {
  const wanted = nameKey(query);
  if (wanted === "") return patients;
  const wantedUrn = urnKey(query);
  return patients.filter(
    (patient) =>
      [patient.name, ...patient.alsoWrittenAs].some((spelling) =>
        nameKey(spelling).includes(wanted),
      ) ||
      (wantedUrn !== "" && patient.urn !== null && urnKey(patient.urn).includes(wantedUrn)),
  );
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `2 draft labs, 1 draft plan`, or null when nothing is a draft. */
export function draftsLabel(draftLabs: number, draftPlans: number): string | null {
  const parts = [
    ...(draftLabs > 0 ? [counted(draftLabs, "draft lab")] : []),
    ...(draftPlans > 0 ? [counted(draftPlans, "draft plan")] : []),
  ];
  return parts.length === 0 ? null : parts.join(", ");
}

/** The first thing a note asks; the thread holds the rest. */
export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}
