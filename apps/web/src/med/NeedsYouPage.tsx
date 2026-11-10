/** T3 Med: per patient, the notes that ask the doctor something or hold drafts to check. */
import { Link } from "@tanstack/react-router";

import { useEnvironmentQuery } from "../state/query";
import { needsYouAtom, useToday } from "./medData";
import { draftsLabel, firstLine, formatDay } from "./medLogic";
import { MedPage } from "./MedPage";

export function NeedsYouPage() {
  const query = useEnvironmentQuery(needsYouAtom);
  const today = useToday();
  return (
    <MedPage.Root title="Needs you">
      <MedPage.Query query={query}>
        {({ patients }) =>
          patients.length === 0 ? (
            <MedPage.Note>
              Nothing needs you. Questions an agent could not answer and drafts it filed show up
              here; open the chat to answer or to confirm them.
            </MedPage.Note>
          ) : (
            patients.map(({ patient, draftLabs, draftPlans, notes }) => (
              <section key={patient.id} className="flex flex-col gap-1">
                <MedPage.Lead>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: patient.id }}
                    className="min-w-0 truncate rounded-sm text-foreground text-sm outline-hidden ring-ring hover:underline focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    {patient.name}
                  </Link>
                  <span className="shrink-0">{draftsLabel(draftLabs, draftPlans)}</span>
                </MedPage.Lead>
                <MedPage.List aria-label={`What needs you for ${patient.name}`}>
                  {notes.map((note) => (
                    <MedPage.ThreadRow key={note.id} threadId={note.threadId}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <MedPage.Primary>{note.title}</MedPage.Primary>
                        <MedPage.Secondary className="text-xs">
                          {[firstLine(note.needsYou), draftsLabel(note.draftLabs, note.draftPlans)]
                            .filter((part) => part !== null && part !== "")
                            .join(" · ")}
                        </MedPage.Secondary>
                      </span>
                      <MedPage.Aside>{formatDay(note.date, today)}</MedPage.Aside>
                    </MedPage.ThreadRow>
                  ))}
                </MedPage.List>
              </section>
            ))
          )
        }
      </MedPage.Query>
    </MedPage.Root>
  );
}
