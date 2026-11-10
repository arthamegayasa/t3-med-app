/** T3 Med: one patient: who they are, a new chat about them, and their earlier chats. */
import { useAtomSet } from "@effect/atom-react";
import type { MedPatientHome } from "@t3tools/contracts/med";
import { SquarePenIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useEnvironmentQuery } from "../state/query";
import { linkThreadAtom, patientHomeAtom, useToday } from "./medData";
import { ageOn, draftsLabel, formatDay } from "./medLogic";
import { MedPage } from "./MedPage";
import { MedPlanRow } from "./MedPlanRow";

const STATUS_LABEL = { new: "New", active: "Active", archived: "Archived" } as const;

function PatientFacts({
  patient,
  today,
}: {
  readonly patient: MedPatientHome["patient"];
  readonly today: string;
}) {
  const age = ageOn(patient.dateOfBirth, today);
  const who = [age === null ? null : String(age), patient.sex].filter((fact) => fact !== null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
      <span className="tabular-nums">{patient.urn === null ? "No URN" : `URN ${patient.urn}`}</span>
      {who.length === 0 ? null : <span>{who.join(", ")}</span>}
      <Badge variant="outline" size="sm">
        {STATUS_LABEL[patient.status]}
      </Badge>
    </div>
  );
}

function NewChatButton({ patient }: { readonly patient: MedPatientHome["patient"] }) {
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const linkThread = useAtomSet(linkThreadAtom, { mode: "promiseExit" });
  const startChat = async () => {
    if (defaultProjectRef === null) return;
    // The draft has its thread id before any message exists, so the link is in place by the
    // time the doctor can send one.
    const draft = await handleNewThread(defaultProjectRef);
    if (draft === null) return;
    const linked = await linkThread({ threadId: draft.threadId, patientId: patient.id });
    if (linked._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `This chat is not linked to ${patient.name}`,
        description: "Give the agent the URN in your message so it files for this patient.",
      });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void startChat()} disabled={defaultProjectRef === null}>
        <SquarePenIcon aria-hidden />
        New chat
      </Button>
      {defaultProjectRef === null ? (
        <span className="text-muted-foreground text-sm">Add a project to start a chat.</span>
      ) : null}
    </div>
  );
}

export function PatientHomePage({ patientId }: { readonly patientId: string }) {
  const query = useEnvironmentQuery(patientHomeAtom(patientId));
  const today = useToday();
  if (query.failure?._tag === "MedPatientNotFoundError") {
    return (
      <MedPage.Root title="Patient" underPatients>
        <MedPage.Note>This patient is not in T3 Med. Pick one from Patients.</MedPage.Note>
      </MedPage.Root>
    );
  }
  return (
    <MedPage.Root title={query.data?.patient.name ?? "Patient"} underPatients>
      <MedPage.Query query={query}>
        {({ patient, notes, draftLabs, draftPlans, upcomingPlans }) => {
          const drafts = draftsLabel(draftLabs, draftPlans);
          return (
            <>
              <div className="flex flex-col gap-1.5 px-2.5 pt-4">
                <h2 className="m-0 font-semibold text-2xl tracking-tight">{patient.name}</h2>
                <PatientFacts patient={patient} today={today} />
                {drafts === null ? null : (
                  <p className="m-0 text-muted-foreground text-sm">{drafts} to check.</p>
                )}
              </div>
              <div className="px-2.5">
                <NewChatButton patient={patient} />
              </div>
              <section className="flex flex-col gap-1 pt-2">
                <MedPage.Lead>
                  <span>Earlier chats</span>
                  <span className="tabular-nums">{notes.length}</span>
                </MedPage.Lead>
                {notes.length === 0 ? (
                  <MedPage.Note className="pt-1">
                    No chats yet. Start one to ask about {patient.name} or to paste their data.
                  </MedPage.Note>
                ) : (
                  <MedPage.List aria-label="Earlier chats">
                    {notes.map((note) => (
                      <MedPage.ThreadRow key={note.id} threadId={note.threadId}>
                        <MedPage.Primary className="max-w-[45%] shrink-0">
                          {note.title}
                        </MedPage.Primary>
                        <MedPage.Secondary className="flex-1 text-xs">
                          {note.summary}
                        </MedPage.Secondary>
                        {note.needsYou.trim() === "" ? null : (
                          <Badge variant="info" size="sm">
                            Needs you
                          </Badge>
                        )}
                        <MedPage.Aside className="ml-0">
                          {formatDay(note.date, today)}
                        </MedPage.Aside>
                      </MedPage.ThreadRow>
                    ))}
                  </MedPage.List>
                )}
              </section>
              {upcomingPlans.length === 0 ? null : (
                <section className="flex flex-col gap-1 pt-2">
                  <MedPage.Lead>
                    <span>Plans</span>
                    <span>Due</span>
                  </MedPage.Lead>
                  <MedPage.List aria-label="Plans">
                    {upcomingPlans.map((plan) => (
                      <MedPlanRow key={plan.id} plan={plan} today={today} />
                    ))}
                  </MedPage.List>
                </section>
              )}
            </>
          );
        }}
      </MedPage.Query>
    </MedPage.Root>
  );
}
