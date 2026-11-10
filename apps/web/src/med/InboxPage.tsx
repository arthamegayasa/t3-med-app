/** T3 Med: notes an agent filed without knowing whose they are. */
import { useEnvironmentQuery } from "../state/query";
import { needsYouAtom, useToday } from "./medData";
import { draftsLabel, firstLine, formatDay } from "./medLogic";
import { MedPage } from "./MedPage";

export function InboxPage() {
  const query = useEnvironmentQuery(needsYouAtom);
  const today = useToday();
  return (
    <MedPage.Root title="Inbox">
      <MedPage.Query query={query}>
        {({ inbox }) =>
          inbox.length === 0 ? (
            <MedPage.Note>
              Nothing is waiting for a patient. A note lands here when a chat does not say whose
              data it is; open it and give the agent the patient&apos;s URN.
            </MedPage.Note>
          ) : (
            <div className="flex flex-col gap-1">
              <MedPage.Lead>
                <span>
                  {inbox.length} {inbox.length === 1 ? "note" : "notes"} without a patient
                </span>
              </MedPage.Lead>
              <MedPage.List aria-label="Inbox notes">
                {inbox.map((note) => (
                  <MedPage.ThreadRow key={note.id} threadId={note.threadId}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <MedPage.Primary>{note.title}</MedPage.Primary>
                      <MedPage.Secondary className="text-xs">
                        {firstLine(note.needsYou) ||
                          draftsLabel(note.draftLabs, note.draftPlans) ||
                          note.summary ||
                          "No patient yet"}
                      </MedPage.Secondary>
                    </span>
                    <MedPage.Aside>{formatDay(note.date, today)}</MedPage.Aside>
                  </MedPage.ThreadRow>
                ))}
              </MedPage.List>
            </div>
          )
        }
      </MedPage.Query>
    </MedPage.Root>
  );
}
