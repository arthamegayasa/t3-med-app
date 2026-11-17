/** T3 Med: every plan still ahead, soonest first, with the overdue ones marked. */
import { upcomingAtom, useMedQuery, useToday } from "./medData";
import { MedPage } from "./MedPage";
import { MedPlanRow } from "./MedPlanRow";

export function UpcomingPage() {
  const query = useMedQuery(upcomingAtom);
  const today = useToday();
  return (
    <MedPage.Root title="Upcoming">
      <MedPage.Query query={query}>
        {({ plans }) =>
          plans.length === 0 ? (
            <MedPage.Note>
              No plans ahead. Tell the agent a plan and its date in a patient&apos;s chat, such as a
              follow-up or a repeat lab, and it is listed here by due date.
            </MedPage.Note>
          ) : (
            <div className="flex flex-col gap-1">
              <MedPage.Lead>
                <span>
                  {plans.length} {plans.length === 1 ? "plan" : "plans"}
                </span>
                <span>Due</span>
              </MedPage.Lead>
              <MedPage.List aria-label="Upcoming plans">
                {plans.map((plan) => (
                  <MedPlanRow
                    key={plan.id}
                    plan={plan}
                    today={today}
                    patient={
                      plan.patientName === null ? (
                        "No patient yet"
                      ) : (
                        <>
                          {plan.patientName} · <MedPage.Urn urn={plan.patientUrn} />
                        </>
                      )
                    }
                  />
                ))}
              </MedPage.List>
            </div>
          )
        }
      </MedPage.Query>
    </MedPage.Root>
  );
}
