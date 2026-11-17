/** T3 Med: one patient: who they are, a new chat about them, and their earlier chats. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import type { MedPatientHome } from "@t3tools/contracts/med";
import { SquarePenIcon } from "lucide-react";
import { useId } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { resolveDefaultProjectRef, useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useQuietThreadShell } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { patientHomeAtom, useMedEnvironmentId, useMedQuery, useToday } from "./medData";
import { ageOn, draftsLabel, earlierChats, formatDay, newChatPrompt } from "./medLogic";
import { MedPage } from "./MedPage";
import { MedPlanRow } from "./MedPlanRow";

const STATUS_LABEL = { new: "New", active: "Active", archived: "Archived" } as const;

export function PatientFacts({
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
      <MedPage.Urn urn={patient.urn} className="text-sm" />
      {who.length === 0 ? null : <span>{who.join(", ")}</span>}
      <Badge variant="outline" size="sm">
        {STATUS_LABEL[patient.status]}
      </Badge>
    </div>
  );
}

/** Where a chat about a patient starts: the first project of the environment their data is in. */
function useMedProjectRef(): ScopedProjectRef | null {
  const environmentId = useMedEnvironmentId();
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  return resolveDefaultProjectRef(
    projects.filter((project) => project.environmentId === environmentId),
    projectOrder,
    // No last-used project: a patient chat starts in the first project, by the sidebar order.
    null,
  );
}

/**
 * Opens a draft whose composer already names the patient by URN. Nothing links the draft to
 * the patient: the agent does, from that URN, when the doctor sends the message.
 */
function NewChatButton({ patient }: { readonly patient: MedPatientHome["patient"] }) {
  const projectRef = useMedProjectRef();
  const openDraft = useNewThreadHandler();
  const reasonId = useId();
  const prompt = newChatPrompt(patient);
  const unavailable =
    prompt === null
      ? "This patient has no URN yet, and a chat started here names them by URN."
      : projectRef === null
        ? "Add a project on this machine to start a chat."
        : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={unavailable !== null}
        aria-describedby={unavailable === null ? undefined : reasonId}
        onClick={() => {
          if (projectRef !== null && prompt !== null) void openDraft(projectRef, { prompt });
        }}
      >
        <SquarePenIcon aria-hidden />
        New chat
      </Button>
      {unavailable === null ? null : (
        <span id={reasonId} className="text-muted-foreground text-sm">
          {unavailable}
        </span>
      )}
    </div>
  );
}

/** A chat about the patient in which nothing was filed for them: named as the thread list names it. */
function LinkedThreadRow({
  threadId,
  day,
  today,
}: {
  readonly threadId: string;
  readonly day: string;
  readonly today: string;
}) {
  const environmentId = useMedEnvironmentId();
  const thread = useQuietThreadShell(
    environmentId === null ? null : scopeThreadRef(environmentId, ThreadId.make(threadId)),
  );
  return (
    <MedPage.ThreadRow threadId={threadId}>
      <MedPage.Primary className="max-w-[45%] shrink-0">
        {thread?.title ?? "Untitled chat"}
      </MedPage.Primary>
      <MedPage.Secondary className="flex-1 text-xs">Nothing filed</MedPage.Secondary>
      <MedPage.Aside className="ml-0">{formatDay(day, today)}</MedPage.Aside>
    </MedPage.ThreadRow>
  );
}

export function PatientHomePage({ patientId }: { readonly patientId: string }) {
  const query = useMedQuery(patientHomeAtom(patientId));
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
        {({ patient, notes, threads, draftLabs, draftPlans, upcomingPlans }) => {
          const drafts = draftsLabel(draftLabs, draftPlans);
          const chats = earlierChats(notes, threads);
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
                  <span className="tabular-nums">{chats.length}</span>
                </MedPage.Lead>
                {chats.length === 0 ? (
                  <MedPage.Note className="pt-1">
                    No chats yet. Start one to ask about {patient.name} or to paste their data.
                  </MedPage.Note>
                ) : (
                  <MedPage.List aria-label="Earlier chats">
                    {chats.map((chat) =>
                      chat.kind === "thread" ? (
                        <LinkedThreadRow
                          key={chat.threadId}
                          threadId={chat.threadId}
                          day={chat.day}
                          today={today}
                        />
                      ) : (
                        <MedPage.ThreadRow key={chat.note.id} threadId={chat.note.threadId}>
                          <MedPage.Primary className="max-w-[45%] shrink-0">
                            {chat.note.title}
                          </MedPage.Primary>
                          <MedPage.Secondary className="flex-1 text-xs">
                            {chat.note.summary}
                          </MedPage.Secondary>
                          {chat.note.needsYou.trim() === "" ? null : (
                            <Badge variant="info" size="sm">
                              Needs you
                            </Badge>
                          )}
                          <MedPage.Aside className="ml-0">
                            {formatDay(chat.day, today)}
                          </MedPage.Aside>
                        </MedPage.ThreadRow>
                      ),
                    )}
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
