/** T3 Med: what the patient pages decide before they draw, kept free of React. */
import { urnKey } from "@t3tools/contracts/med";

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

// oxlint-disable-next-line t3code/no-em-dash-copy -- The mark of an empty cell, not punctuation in a sentence.
const NO_CHAT = "—";

/**
 * When a patient last had a chat: by day, so the label cannot go stale within one. A dash for
 * a patient who has had none.
 */
export function formatLastChat(timestamp: string | null, today: string): string {
  const at = timestamp === null ? null : new Date(timestamp);
  const todayMs = dayMs(today);
  if (at === null || Number.isNaN(at.getTime()) || todayMs === null) return NO_CHAT;
  const day = localIsoDate(at);
  if (day === today) return "Today";
  if (dayMs(day) === todayMs - DAY_MS) return "Yesterday";
  return formatDay(day, today);
}

const oneLine = (text: string) => text.trim().replace(/\s+/g, " ");

const nameKey = (text: string) => oneLine(text).toLowerCase();

/**
 * The line a chat started from a patient's page opens with. The agent links a thread by URN
 * only, so the URN is what the line gives it; the name is for the doctor. Null without a URN.
 */
export function newChatPrompt(patient: {
  readonly name: string;
  readonly urn: string | null;
}): string | null {
  const urn = oneLine(patient.urn ?? "");
  return urnKey(urn) === "" ? null : `URN ${urn} (${oneLine(patient.name)})\n`;
}

export type EarlierChat<N> =
  | { readonly kind: "note"; readonly day: string; readonly note: N }
  | { readonly kind: "thread"; readonly day: string; readonly threadId: string };

/**
 * A patient's chats, latest day first: each note, and each linked thread that filed no note
 * for the patient, so a chat in which nothing was filed is still listed.
 */
export function earlierChats<N extends { readonly threadId: string | null; readonly date: string }>(
  notes: ReadonlyArray<N>,
  threads: ReadonlyArray<{ readonly threadId: string; readonly linkedAt: string }>,
): ReadonlyArray<EarlierChat<N>> {
  const withNote = new Set(notes.map((note) => note.threadId));
  return [
    ...notes.map((note) => ({ kind: "note" as const, day: note.date, note })),
    ...threads
      .filter((thread) => !withNote.has(thread.threadId))
      .map((thread) => ({
        kind: "thread" as const,
        day: localIsoDate(new Date(thread.linkedAt)),
        threadId: thread.threadId,
      })),
  ].toSorted((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

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
