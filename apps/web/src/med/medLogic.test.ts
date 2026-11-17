import { describe, expect, it } from "vite-plus/test";

import {
  ageOn,
  draftsLabel,
  earlierChats,
  filterPatients,
  formatDay,
  formatLastChat,
  isOverdue,
  localIsoDate,
  newChatPrompt,
  overdueLabel,
} from "./medLogic";

const patient = (name: string, urn: string | null, alsoWrittenAs: ReadonlyArray<string> = []) => ({
  name,
  urn,
  alsoWrittenAs,
});

describe("filterPatients", () => {
  const ketut = patient("I Ketut Rai", null);
  const wayan = patient("I Wayan Sudarma", "00-45-67-89", ["Pak Yan"]);
  const made = patient("Ni Made Ayu", "00-12-34-56");
  const all = [ketut, wayan, made];

  it.each([
    ["", all],
    ["   ", all],
    ["SUDAR", [wayan]],
    ["  wayan   sudarma ", [wayan]],
    ["pak yan", [wayan]],
    ["4567", [wayan]],
    ["00 45-67", [wayan]],
    ["00456789", [wayan]],
    ["00", [wayan, made]],
    ["9999", []],
    // Punctuation alone is no URN, so it cannot match every patient that has one.
    ["-", []],
  ])("keeps the patients %j names by name, other spelling or URN", (query, expected) => {
    expect(filterPatients(all, query)).toEqual(expected);
  });
});

describe("ageOn", () => {
  it.each([
    ["1968-03-02", "2026-11-11", 58],
    ["1968-11-11", "2026-11-11", 58],
    ["1968-11-12", "2026-11-11", 57],
    ["2024-02-29", "2025-02-28", 0],
    ["2024-02-29", "2025-03-01", 1],
    ["2026-11-11", "2026-11-11", 0],
  ])("counts full years from %s to %s", (born, today, age) => {
    expect(ageOn(born, today)).toBe(age);
  });

  it.each([[null], [""], ["1968"], ["not a date"], ["2027-01-01"]])("has no age for %j", (born) => {
    expect(ageOn(born, "2026-11-11")).toBeNull();
  });
});

describe("overdue plans", () => {
  it("is overdue from the day after it was due", () => {
    expect(isOverdue("2026-11-10", "2026-11-11")).toBe(true);
    expect(isOverdue("2026-11-11", "2026-11-11")).toBe(false);
    expect(isOverdue("2026-11-12", "2026-11-11")).toBe(false);
  });

  it.each([
    ["2026-11-10", "Overdue 1 day"],
    ["2026-11-07", "Overdue 4 days"],
    ["2026-10-31", "Overdue 11 days"],
    ["2026-11-11", null],
    ["2026-12-01", null],
  ])("labels a plan due %s", (due, label) => {
    expect(overdueLabel(due, "2026-11-11")).toBe(label);
  });
});

describe("dates as the doctor reads them", () => {
  it("takes the calendar day from the local clock, not from UTC", () => {
    expect(localIsoDate(new Date(2026, 10, 11, 0, 30))).toBe("2026-11-11");
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("leaves the year out of a day in the current year", () => {
    expect(formatDay("2026-11-06", "2026-11-11")).toBe("6 Nov");
    expect(formatDay("2025-11-06", "2026-11-11")).toBe("6 Nov 2025");
    expect(formatDay("2027-01-02", "2026-11-11")).toBe("2 Jan 2027");
    expect(formatDay("someday", "2026-11-11")).toBe("someday");
  });

  it("names today and yesterday, and dates anything older", () => {
    const at = (year: number, month: number, day: number, hour: number) =>
      new Date(year, month - 1, day, hour).toISOString();
    expect(formatLastChat(at(2026, 11, 11, 0), "2026-11-11")).toBe("Today");
    expect(formatLastChat(at(2026, 11, 10, 23), "2026-11-11")).toBe("Yesterday");
    expect(formatLastChat(at(2026, 11, 9, 12), "2026-11-11")).toBe("9 Nov");
    expect(formatLastChat(at(2026, 10, 31, 12), "2026-11-01")).toBe("Yesterday");
    expect(formatLastChat(at(2025, 12, 31, 12), "2026-01-01")).toBe("Yesterday");
    expect(formatLastChat(at(2025, 3, 2, 12), "2026-11-11")).toBe("2 Mar 2025");
  });

  it("shows a dash for a patient who has had no chat, never a day", () => {
    expect(formatLastChat(null, "2026-11-11")).toBe("\u2014");
    expect(formatLastChat("never", "2026-11-11")).toBe("\u2014");
  });
});

describe("a chat started from a patient's page", () => {
  it("opens with one line that names the patient by URN, for the agent to link by", () => {
    expect(newChatPrompt({ name: "Ni Made Suartini", urn: "00-12-34-56" })).toBe(
      "URN 00-12-34-56 (Ni Made Suartini)\n",
    );
    expect(newChatPrompt({ name: "  Ni  Made\nSuartini ", urn: " 00-12-34-56 " })).toBe(
      "URN 00-12-34-56 (Ni Made Suartini)\n",
    );
  });

  it.each([[null], [""], ["  "], ["--"]])("has no line for a patient whose URN is %j", (urn) => {
    expect(newChatPrompt({ name: "Ni Made Suartini", urn })).toBeNull();
  });
});

describe("a patient's earlier chats", () => {
  const note = (id: string, threadId: string | null, date: string) => ({ id, threadId, date });
  const linked = (threadId: string, year: number, month: number, day: number) => ({
    threadId,
    linkedAt: new Date(year, month - 1, day, 9).toISOString(),
  });

  it("lists every linked thread once, and a note without a thread, latest day first", () => {
    const visit = note("note-visit", "thread-1", "2026-11-06");
    const scan = note("note-scan", null, "2026-11-09");
    const admission = note("note-admission", "thread-2", "2026-08-21");
    expect(
      earlierChats(
        [scan, visit, admission],
        [
          linked("thread-9", 2026, 11, 10),
          linked("thread-1", 2026, 11, 6),
          linked("thread-8", 2026, 11, 6),
          linked("thread-2", 2026, 8, 21),
        ],
      ),
    ).toEqual([
      { kind: "thread", threadId: "thread-9", day: "2026-11-10" },
      { kind: "note", note: scan, day: "2026-11-09" },
      { kind: "note", note: visit, day: "2026-11-06" },
      { kind: "thread", threadId: "thread-8", day: "2026-11-06" },
      { kind: "note", note: admission, day: "2026-08-21" },
    ]);
  });

  it("keeps a note whose thread is linked to another patient now, and has no rows for none", () => {
    const moved = note("note-moved", "thread-5", "2026-11-06");
    expect(earlierChats([moved], [])).toEqual([{ kind: "note", note: moved, day: "2026-11-06" }]);
    expect(earlierChats([], [])).toEqual([]);
  });
});

describe("what waits, in a line", () => {
  it.each([
    [0, 0, null],
    [1, 0, "1 draft lab"],
    [2, 0, "2 draft labs"],
    [0, 1, "1 draft plan"],
    [3, 2, "3 draft labs, 2 draft plans"],
  ])("counts %i labs and %i plans", (labs, plans, label) => {
    expect(draftsLabel(labs, plans)).toBe(label);
  });
});
