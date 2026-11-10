/** T3 Med: one plan in a list, marked when it is still a draft or past its due date. */
import type { MedPlan } from "@t3tools/contracts/med";
import type { ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { formatDay, overdueLabel } from "./medLogic";
import { MedPage } from "./MedPage";

const PLAN_TYPE_LABEL = {
  follow_up: "Follow-up",
  lab: "Lab",
  imaging: "Imaging",
  procedure: "Procedure",
  other: "Other",
} as const satisfies Record<MedPlan["type"], string>;

export function MedPlanRow({
  plan,
  today,
  patient,
}: {
  readonly plan: MedPlan;
  readonly today: string;
  /** Whose plan it is, on a list that spans patients. */
  readonly patient?: ReactNode;
}) {
  const overdue = overdueLabel(plan.due, today);
  return (
    <MedPage.Row>
      <span className="flex min-w-0 flex-1 flex-col">
        <MedPage.Primary>{plan.title}</MedPage.Primary>
        <MedPage.Secondary className="text-xs">
          {patient === undefined ? null : <>{patient} · </>}
          {PLAN_TYPE_LABEL[plan.type]}
        </MedPage.Secondary>
      </span>
      {plan.status === "draft" ? (
        <Badge variant="outline" size="sm">
          Draft
        </Badge>
      ) : null}
      {overdue === null ? null : (
        <Badge variant="warning" size="sm">
          {overdue}
        </Badge>
      )}
      <MedPage.Aside className="ml-0 w-20 text-right">{formatDay(plan.due, today)}</MedPage.Aside>
    </MedPage.Row>
  );
}
