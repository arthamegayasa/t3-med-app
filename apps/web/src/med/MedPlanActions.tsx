/** T3 Med: what the doctor can do to one plan, and the form that changes its title or dates. */
import type { MedPlan, MedPlanChange } from "@t3tools/contracts/med";
import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { actOnMed } from "./medActions";
import {
  type PlanAction,
  planActions,
  planChangeOf,
  type PlanForm,
  planFormOf,
} from "./medChangeLogic";
import { type MedSend, useMedMayChange } from "./medData";
import { MedRowMenu } from "./MedRowMenu";

const ACTION_LABEL = {
  verify: "Verify",
  unverify: "Return to draft",
  done: "Mark done",
  cancel: "Cancel plan",
  reopen: "Reopen",
  change: "Change…",
  remove: "Remove",
} as const satisfies Record<PlanAction, string>;

const update =
  (planId: string, payload: MedPlanChange): MedSend<MedPlan> =>
  (client) =>
    client.patients.updatePlan({ headers: {}, params: { planId }, payload });

const setVerified =
  (planId: string, verified: boolean): MedSend<unknown> =>
  (client) =>
    client.patients.setPlanVerified({ headers: {}, params: { planId }, payload: { verified } });

const setRemoved =
  (planId: string, removed: boolean): MedSend<unknown> =>
  (client) =>
    client.patients.setPlanRemoved({ headers: {}, params: { planId }, payload: { removed } });

function ChangePlanDialog({
  plan,
  onClose,
}: {
  readonly plan: MedPlan;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState(() => planFormOf(plan));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (fields: Partial<PlanForm>) => setForm({ ...form, ...fields });

  const submit = async () => {
    const outcome = planChangeOf(plan, form);
    if (outcome.problem !== undefined) return setProblem(outcome.problem);
    const { change } = outcome;
    if (change === null) return onClose();
    setSaving(true);
    setProblem(null);
    const result = await actOnMed({
      send: update(plan.id, change),
      done: `Changed ${form.title.trim()}`,
      undo: {
        // What it had in the fields that changed, and only those.
        send: update(plan.id, {
          ...(change.title === undefined ? {} : { title: plan.title }),
          ...(change.due === undefined ? {} : { due: plan.due }),
          ...(change.doneOn === undefined || plan.doneOn === null ? {} : { doneOn: plan.doneOn }),
        }),
        done: `${plan.title} is as it was`,
        failed: "Could not undo the change",
      },
    });
    if (result.ok) return onClose();
    setSaving(false);
    setProblem(result.message);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Change this plan</DialogTitle>
            <DialogDescription>{plan.title}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={form.title}
                onChange={(event) => set({ title: event.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-due`}>Due</Label>
                <Input
                  id={`${id}-due`}
                  type="date"
                  value={form.due}
                  onChange={(event) => set({ due: event.target.value })}
                />
              </div>
              {plan.status === "done" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-done`}>Done on</Label>
                  <Input
                    id={`${id}-done`}
                    type="date"
                    value={form.doneOn}
                    onChange={(event) => set({ doneOn: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
            {problem === null ? null : (
              <p role="alert" className="m-0 text-destructive-foreground text-sm">
                {problem}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function PlanRowActions({ plan }: { readonly plan: MedPlan }) {
  const mayChange = useMedMayChange();
  const [changing, setChanging] = useState(false);
  if (!mayChange) return null;
  const { id, title } = plan;
  const reopen = {
    send: update(id, { status: "open" }),
    done: `${title} is open again`,
    failed: "Could not reopen this plan",
  };
  const run: Record<PlanAction, () => void> = {
    verify: () =>
      void actOnMed({
        send: setVerified(id, true),
        done: `Verified ${title}`,
        failed: "Could not verify this plan",
        undo: {
          send: setVerified(id, false),
          done: `${title} is a draft again`,
          failed: "Could not return it to draft",
        },
      }),
    unverify: () =>
      void actOnMed({
        send: setVerified(id, false),
        done: `${title} is a draft again`,
        failed: "Could not return it to draft",
        undo: {
          send: setVerified(id, true),
          done: `Verified ${title}`,
          failed: "Could not verify this plan",
        },
      }),
    done: () =>
      void actOnMed({
        send: update(id, { status: "done" }),
        done: `Marked done: ${title}`,
        failed: "Could not mark this plan done",
        undo: reopen,
      }),
    cancel: () =>
      void actOnMed({
        send: update(id, { status: "cancelled" }),
        done: `Cancelled ${title}`,
        failed: "Could not cancel this plan",
        undo: reopen,
      }),
    reopen: () =>
      void actOnMed({
        ...reopen,
        undo:
          plan.status === "done"
            ? {
                send: update(id, {
                  status: "done",
                  ...(plan.doneOn === null ? {} : { doneOn: plan.doneOn }),
                }),
                done: `${title} is done again`,
                failed: "Could not mark this plan done",
              }
            : {
                send: update(id, { status: "cancelled" }),
                done: `${title} is cancelled again`,
                failed: "Could not cancel this plan",
              },
      }),
    change: () => setChanging(true),
    remove: () =>
      void actOnMed({
        send: setRemoved(id, true),
        done: `Removed ${title}`,
        failed: "Could not remove this plan",
        undo: {
          send: setRemoved(id, false),
          done: `Put back ${title}`,
          failed: "Could not put it back",
        },
      }),
  };
  return (
    <>
      <MedRowMenu
        label={`Actions for ${title}`}
        actions={planActions(plan).map((action) => ({
          label: ACTION_LABEL[action],
          onSelect: run[action],
        }))}
      />
      {changing ? <ChangePlanDialog plan={plan} onClose={() => setChanging(false)} /> : null}
    </>
  );
}
