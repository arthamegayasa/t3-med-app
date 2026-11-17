/**
 * T3 Med: what was removed for a patient, folded away at the foot of a page, with the control
 * that puts each row back. Nothing filed is deleted, so this list is the way back once the
 * toast of a removal has closed.
 */
import type { MedRemovedList } from "@t3tools/contracts/med";
import { ChevronRightIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { actOnMed } from "./medActions";
import { draftLabLabel, draftPlanLabel } from "./medChangeLogic";
import { patientRemovedAtom, useMedMayChange, useMedQuery, useToday } from "./medData";
import { setLabRemoved } from "./MedLabActions";
import { formatDay } from "./medLogic";
import { setPlanRemoved } from "./MedPlanActions";

type RemovedKind = keyof MedRemovedList;

interface RemovedRow {
  readonly key: string;
  readonly label: string;
  readonly removedAt: string;
  readonly restore: () => void;
}

function Row({ row, today, mayChange }: { row: RemovedRow; today: string; mayChange: boolean }) {
  return (
    <li className="flex min-h-9 items-center gap-3 px-2.5 py-1 text-sm">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate">{row.label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          Removed {formatDay(row.removedAt.slice(0, 10), today)}
        </span>
      </span>
      {mayChange ? (
        <Button
          variant="outline"
          size="xs"
          aria-label={`Restore ${row.label}`}
          onClick={row.restore}
        >
          Restore
        </Button>
      ) : null}
    </li>
  );
}

/** Collapsed until opened, and absent while nothing of these kinds is removed. */
export function MedRemoved({
  patientId,
  kinds = ["labs", "plans"],
}: {
  readonly patientId: string;
  /** A surface that shows only results, or only plans, lists only those. */
  readonly kinds?: ReadonlyArray<RemovedKind>;
}) {
  const query = useMedQuery(patientRemovedAtom(patientId));
  const today = useToday();
  const mayChange = useMedMayChange();
  if (query.data === null) return null;
  const rows: ReadonlyArray<RemovedRow> = [
    ...(kinds.includes("labs") ? query.data.labs : []).map((lab) => {
      const label = draftLabLabel(lab, today);
      return {
        key: `lab:${lab.id}`,
        label,
        removedAt: lab.removedAt,
        restore: () =>
          void actOnMed({
            send: setLabRemoved(lab.id, false),
            done: `Put back ${label}`,
            failed: "Could not put it back",
            undo: ({ updatedAt }) => ({
              send: setLabRemoved(lab.id, true, updatedAt),
              done: `Removed ${label}`,
              failed: "Could not remove this result",
            }),
          }),
      };
    }),
    ...(kinds.includes("plans") ? query.data.plans : []).map((plan) => {
      const label = `Plan: ${draftPlanLabel(plan, today)}`;
      return {
        key: `plan:${plan.id}`,
        label,
        removedAt: plan.removedAt,
        restore: () =>
          void actOnMed({
            send: setPlanRemoved(plan.id, false),
            done: `Put back ${plan.title}`,
            failed: "Could not put it back",
            undo: ({ updatedAt }) => ({
              send: setPlanRemoved(plan.id, true, updatedAt),
              done: `Removed ${plan.title}`,
              failed: "Could not remove this plan",
            }),
          }),
      };
    }),
  ];
  if (rows.length === 0) return null;
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="group flex items-center gap-1.5 self-start rounded-sm px-2.5 py-1 text-muted-foreground text-xs font-medium hover:text-foreground">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-data-panel-open:rotate-90"
        />
        Removed
        <span className="tabular-nums">{rows.length}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul aria-label="Removed" className="m-0 flex list-none flex-col gap-px p-0">
          {rows.map((row) => (
            <Row key={row.key} row={row} today={today} mayChange={mayChange} />
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
