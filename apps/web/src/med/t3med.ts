/**
 * T3 Med: the one switch for what a patient workspace hides or renames in upstream's UI. Each
 * upstream file reads it in a one-line condition, listed in `docs/t3-med/FORK.md`; turning it
 * off gives upstream's chrome back. Typed `boolean` so those conditions stay live code.
 */
export const T3MED: boolean = true;

/** The word after the T3 mark in the sidebar. */
export const BRAND_WORD = T3MED ? "Med" : "Code";

// Editors, scripts and Git have no place beside a patient; the other rows are about the chat.
const CODING_THREAD_DETAILS: ReadonlySet<string> = new Set([
  "openIn",
  "scripts",
  "branch",
  "gitActions",
  "changes",
]);

/** Whether the thread details menu offers this row. */
export const showsThreadDetailsItem = (id: string): boolean =>
  !T3MED || !CODING_THREAD_DETAILS.has(id);
