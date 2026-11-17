/**
 * T3 Med: what the doctor can do to one note of a patient: confirm every draft it filed, or
 * send it back to the Inbox when it was filed for the wrong patient.
 */
import type { MedWaitingNote } from "@t3tools/contracts/med";
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
import { useMedMayChange } from "./medData";
import { draftsLabel } from "./medLogic";
import { MedRowMenu } from "./MedRowMenu";

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function verifyNote(note: MedWaitingNote) {
  return actOnMed({
    send: (client) => client.patients.verifyNote({ headers: {}, params: { noteId: note.id } }),
    done: ({ labsVerified, plansPlanned }) =>
      labsVerified + plansPlanned === 0
        ? `Nothing was left to verify in ${note.title}`
        : `Verified ${[
            ...(labsVerified === 0 ? [] : [counted(labsVerified, "result")]),
            ...(plansPlanned === 0 ? [] : [counted(plansPlanned, "plan")]),
          ].join(" and ")} from ${note.title}`,
    failed: "Could not verify this note",
  });
}

/** Confirms everything a note filed, where the page lists what waits for the doctor. */
export function VerifyNoteButton({ note }: { readonly note: MedWaitingNote }) {
  const mayChange = useMedMayChange();
  const drafts = draftsLabel(note.draftLabs, note.draftPlans);
  if (!mayChange || drafts === null) return null;
  return (
    <Button
      variant="outline"
      size="xs"
      aria-label={`Verify ${drafts} from ${note.title}`}
      onClick={() => void verifyNote(note)}
    >
      Verify
    </Button>
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
  const [moving, setMoving] = useState(false);
  if (!mayChange) return null;
  const drafts = draftsLabel(note.draftLabs, note.draftPlans);
  return (
    <>
      <MedRowMenu
        label={`Actions for ${note.title}`}
        actions={[
          ...(drafts === null
            ? []
            : [{ label: `Verify ${drafts}`, onSelect: () => void verifyNote(note) }]),
          { label: "Move to Inbox…", onSelect: () => setMoving(true) },
        ]}
      />
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
