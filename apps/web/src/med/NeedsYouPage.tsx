/** T3 Med: per patient, the notes that ask the doctor something or hold drafts to check. */
import { needsYouAtom, useMedMayChange, useMedQuery, useToday } from "./medData";
import { draftsLabel, formatDay } from "./medLogic";
import { MedLink } from "./MedLink";
import { VerifyNoteButton } from "./MedNoteActions";
import { MedPage } from "./MedPage";

export function NeedsYouPage() {
  const query = useMedQuery(needsYouAtom);
  const today = useToday();
  const mayChange = useMedMayChange();
  return (
    <MedPage.Root title="Needs you">
      <MedPage.Query query={query}>
        {({ patients }) =>
          patients.length === 0 ? (
            <MedPage.Note>
              Nothing needs you. Questions an agent could not answer and drafts it filed show up
              here; open the chat to answer, and verify the drafts here or in the chat.
            </MedPage.Note>
          ) : (
            patients.map(({ patient, draftLabs, draftPlans, notes }) => (
              <section key={patient.id} className="flex flex-col gap-1">
                <MedPage.Lead ends={mayChange ? "chevron-button" : "chevron"}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <MedLink
                      to="/patients/$patientId"
                      params={{ patientId: patient.id }}
                      className="min-w-0 truncate text-foreground text-sm hover:underline"
                    >
                      {patient.name}
                    </MedLink>
                    <MedPage.Urn urn={patient.urn} />
                  </span>
                  <span className="shrink-0">{draftsLabel(draftLabs, draftPlans)}</span>
                </MedPage.Lead>
                <MedPage.List aria-label={`What needs you for ${patient.name}`}>
                  {notes.map((note) => {
                    const drafts = draftsLabel(note.draftLabs, note.draftPlans);
                    return (
                      <MedPage.ThreadRow
                        key={note.id}
                        threadId={note.threadId}
                        actionsEnd={mayChange ? "button" : undefined}
                        actions={<VerifyNoteButton note={note} />}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <MedPage.Primary>{note.title}</MedPage.Primary>
                          {note.needsYou.trim() === "" ? null : (
                            <MedPage.Detail>{note.needsYou.trim()}</MedPage.Detail>
                          )}
                          {drafts === null ? null : (
                            <MedPage.Secondary className="text-xs">{drafts}</MedPage.Secondary>
                          )}
                        </span>
                        <MedPage.Aside>{formatDay(note.date, today)}</MedPage.Aside>
                      </MedPage.ThreadRow>
                    );
                  })}
                </MedPage.List>
              </section>
            ))
          )
        }
      </MedPage.Query>
    </MedPage.Root>
  );
}
