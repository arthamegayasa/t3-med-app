/**
 * T3 Med: what the doctor can do to one note of a patient: confirm the drafts it filed, mark
 * its question as handled, or send it back to the Inbox when it was filed for the wrong
 * patient. Verifying confirms the rows the page shows, never one filed after it was read.
 */
import type { MedNoteRows, MedWaitingNote } from "@t3tools/contracts/med";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { actOnMed } from "./medActions";
import {
  draftLabLabel,
  draftPlanLabel,
  noteRowsOf,
  questionWaits,
  rowsLabel,
} from "./medChangeLogic";
import { type MedSend, useMedMayChange, useToday } from "./medData";
import { MedRowMenu } from "./MedRowMenu";

const unverify =
  (noteId: string, rows: MedNoteRows): MedSend<unknown> =>
  (client) =>
    client.patients.unverifyNote({ headers: {}, params: { noteId }, payload: rows });

function verifyNote(note: MedWaitingNote, patientName: string, today: string) {
  const shown = noteRowsOf(note);
  // What the toast lists is what the page listed, by the rows the server says it verified.
  const names = (verified: MedNoteRows) => [
    ...note.draftLabRows
      .filter((lab) => verified.labIds.includes(lab.id))
      .map((lab) => draftLabLabel(lab, today)),
    ...note.draftPlanRows
      .filter((plan) => verified.planIds.includes(plan.id))
      .map((plan) => draftPlanLabel(plan, today)),
  ];
  return actOnMed({
    send: (client) =>
      client.patients.verifyNote({ headers: {}, params: { noteId: note.id }, payload: shown }),
    done: (verified) => {
      const rows = rowsLabel(verified);
      return rows === null
        ? `Nothing was left to verify for ${patientName}`
        : `Verified ${rows} for ${patientName}`;
    },
    detail: (verified) => {
      const listed = names(verified);
      return listed.length === 0 ? undefined : listed.join("; ");
    },
    failed: "Could not verify this note",
    undo: (verified) => {
      const rows = rowsLabel(verified);
      return rows === null
        ? undefined
        : {
            send: unverify(note.id, { labIds: verified.labIds, planIds: verified.planIds }),
            done: `${rows} for ${patientName}: drafts again`,
            failed: "Could not return them to draft",
          };
    },
  });
}

const setHandled =
  (noteId: string, handled: boolean): MedSend<unknown> =>
  (client) =>
    client.patients.setQuestionHandled({ headers: {}, params: { noteId }, payload: { handled } });

function markHandled(note: MedWaitingNote, handled: boolean) {
  const waits = {
    done: `The question in ${note.title} waits for you again`,
    failed: "Could not undo",
  };
  const dealt = {
    done: `Marked the question in ${note.title} as handled`,
    failed: "Could not undo",
  };
  return actOnMed({
    send: setHandled(note.id, handled),
    done: handled ? dealt.done : waits.done,
    failed: "Could not change this question",
    undo: { send: setHandled(note.id, !handled), ...(handled ? waits : dealt) },
  });
}

/** The drafts of a note, one on a line: what verifying the note would confirm. */
export function NoteDraftRows({ note }: { readonly note: MedWaitingNote }) {
  const today = useToday();
  if (note.draftLabRows.length + note.draftPlanRows.length === 0) return null;
  return (
    <ul
      aria-label={`Drafts from ${note.title}`}
      className="m-0 flex list-none flex-col gap-0.5 p-0 text-muted-foreground text-xs tabular-nums"
    >
      {note.draftLabRows.map((lab) => (
        <li key={lab.id}>{draftLabLabel(lab, today)}</li>
      ))}
      {note.draftPlanRows.map((plan) => (
        <li key={plan.id}>Plan: {draftPlanLabel(plan, today)}</li>
      ))}
    </ul>
  );
}

/**
 * What a note on Needs you offers: verify the drafts listed above it, and mark its question
 * as handled. A note that only asks something leaves the page by the second.
 */
export function NoteWaitingActions({
  note,
  patientName,
}: {
  readonly note: MedWaitingNote;
  readonly patientName: string;
}) {
  const mayChange = useMedMayChange();
  const today = useToday();
  const rows = rowsLabel(noteRowsOf(note));
  const asks = questionWaits(note);
  if (!mayChange || (rows === null && !asks)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {rows === null ? null : (
        <Button
          variant="outline"
          size="xs"
          aria-label={`Verify ${rows} from ${note.title}`}
          onClick={() => void verifyNote(note, patientName, today)}
        >
          Verify {rows}
        </Button>
      )}
      {asks ? (
        <Button
          variant="outline"
          size="xs"
          aria-label={`Mark the question in ${note.title} as handled`}
          onClick={() => void markHandled(note, true)}
        >
          Mark question as handled
        </Button>
      ) : null}
    </div>
  );
}

export function NoteRowActions({
  note,
  patientName,
}: {
  readonly note: MedWaitingNote;
  readonly patientName: string;
}) {
  const mayChange = useMedMayChange();
  const today = useToday();
  const [moving, setMoving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  if (!mayChange) return null;
  const rows = rowsLabel(noteRowsOf(note));
  const asked = note.needsYou.trim() !== "";
  return (
    <>
      <MedRowMenu
        label={`Actions for ${note.title}`}
        actions={[
          // The rows are listed before anything is confirmed: this page shows only their count.
          ...(rows === null
            ? []
            : [{ label: `Verify ${rows}…`, onSelect: () => setVerifying(true) }]),
          ...(!asked
            ? []
            : questionWaits(note)
              ? [
                  {
                    label: "Mark question as handled",
                    onSelect: () => void markHandled(note, true),
                  },
                ]
              : [
                  {
                    label: "Question needs you again",
                    onSelect: () => void markHandled(note, false),
                  },
                ]),
          { label: "Move to Inbox…", onSelect: () => setMoving(true) },
        ]}
      />
      <AlertDialog open={verifying} onOpenChange={setVerifying}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Verify {rows ?? "the drafts"} from {note.title}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These drafts for {patientName} become verified. Anything filed after this list was
              read stays a draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <NoteDraftRows note={note} />
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setVerifying(false);
                void verifyNote(note, patientName, today);
              }}
            >
              Verify
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <AlertDialog open={moving} onOpenChange={setMoving}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {note.title} to the Inbox?</AlertDialogTitle>
            <AlertDialogDescription>
              The note leaves {patientName} with the results and plans filed from it. They become
              drafts again, and what was verified has to be verified again once the note has a
              patient.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setMoving(false);
                void actOnMed({
                  send: (client) =>
                    client.patients.moveNoteToInbox({ headers: {}, params: { noteId: note.id } }),
                  done: `Moved ${note.title} to the Inbox`,
                  failed: "Could not move this note",
                });
              }}
            >
              Move to Inbox
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
