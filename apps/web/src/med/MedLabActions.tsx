/** T3 Med: what the doctor can do to one filed result, and the form that corrects it. */
import type { MedLab } from "@t3tools/contracts/med";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { actOnMed } from "./medActions";
import {
  followWritten,
  type LabAction,
  labActions,
  labCorrectionOf,
  type LabForm,
  labFormOf,
  revisionChanges,
} from "./medChangeLogic";
import { type MedSend, useMedMayChange } from "./medData";
import { formatDay } from "./medLogic";
import { valueLabel } from "./medPanelLogic";
import { MedRowMenu } from "./MedRowMenu";

const ACTION_LABEL = {
  verify: "Verify",
  unverify: "Return to draft",
  correct: "Correct…",
  "undo-correction": "Undo last correction",
  remove: "Remove",
} as const satisfies Record<LabAction, string>;

const FLAGS = [
  { value: "", label: "No flag" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
] as const;

const setVerified =
  (labId: string, verified: boolean): MedSend<unknown> =>
  (client) =>
    client.patients.setLabVerified({ headers: {}, params: { labId }, payload: { verified } });

const setRemoved =
  (labId: string, removed: boolean): MedSend<unknown> =>
  (client) =>
    client.patients.setLabRemoved({ headers: {}, params: { labId }, payload: { removed } });

const undoCorrection =
  (labId: string): MedSend<unknown> =>
  (client) =>
    client.patients.undoLabCorrection({ headers: {}, params: { labId } });

/** What each correction replaced, the latest first, under the result it belongs to. */
export function LabRevisions({ lab, today }: { readonly lab: MedLab; readonly today: string }) {
  if (lab.revisions.length === 0) return null;
  return (
    <ul aria-label="Earlier values" className="m-0 flex list-none flex-col gap-0.5 p-0">
      {lab.revisions.map((revision, index) => {
        const changes = revisionChanges(lab.revisions[index - 1] ?? lab, revision, today);
        return (
          <li
            key={revision.replacedAt}
            className="whitespace-normal text-muted-foreground text-xs tabular-nums"
          >
            Was {changes.length === 0 ? "the same" : changes.join(", ")}, corrected{" "}
            {formatDay(revision.replacedAt.slice(0, 10), today)}
          </li>
        );
      })}
    </ul>
  );
}

function CorrectLabDialog({
  lab,
  onClose,
}: {
  readonly lab: MedLab;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState(() => labFormOf(lab));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (fields: Partial<LabForm>) => setForm({ ...form, ...fields });

  const submit = async () => {
    const outcome = labCorrectionOf(lab, form);
    if (outcome.problem !== undefined) return setProblem(outcome.problem);
    const { change } = outcome;
    if (change === null) return onClose();
    setSaving(true);
    setProblem(null);
    const result = await actOnMed({
      send: (client) =>
        client.patients.correctLab({ headers: {}, params: { labId: lab.id }, payload: change }),
      done: `Corrected ${lab.testName}. It is a draft until you verify it.`,
      undo: {
        send: undoCorrection(lab.id),
        done: "Correction undone",
        failed: "Could not undo the correction",
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
            <DialogTitle>Correct this result</DialogTitle>
            <DialogDescription>
              {lab.testName}, {valueLabel(lab)}. What it says now is kept, so the correction can be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-test`}>Test</Label>
              <Input
                id={`${id}-test`}
                value={form.testAsWritten}
                onChange={(event) => set({ testAsWritten: event.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-written`}>Result as written</Label>
                <Input
                  id={`${id}-written`}
                  value={form.valueText}
                  onChange={(event) => setForm(followWritten(form, event.target.value))}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-unit`}>Unit</Label>
                <Input
                  id={`${id}-unit`}
                  value={form.unit}
                  onChange={(event) => set({ unit: event.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-number`}>Number</Label>
              <Input
                id={`${id}-number`}
                inputMode="decimal"
                value={form.number}
                aria-describedby={`${id}-number-note`}
                onChange={(event) => set({ number: event.target.value })}
                autoComplete="off"
              />
              <p id={`${id}-number-note`} className="m-0 text-muted-foreground text-xs">
                Used for the chart and the change from baseline. Leave empty for a result that is
                not a number.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-reference`}>Reference range</Label>
                <Input
                  id={`${id}-reference`}
                  value={form.referenceRange}
                  onChange={(event) => set({ referenceRange: event.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-flag`}>Flag</Label>
                <Select
                  value={form.flag}
                  items={FLAGS}
                  onValueChange={(value) =>
                    set({ flag: FLAGS.find((flag) => flag.value === value)?.value ?? "" })
                  }
                >
                  <SelectTrigger id={`${id}-flag`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {FLAGS.map((flag) => (
                      <SelectItem key={flag.value} value={flag.value}>
                        {flag.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-collected`}>Collected</Label>
              <Input
                id={`${id}-collected`}
                type="date"
                value={form.collected}
                onChange={(event) => set({ collected: event.target.value })}
              />
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
              {saving ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function LabRowActions({ lab, today }: { readonly lab: MedLab; readonly today: string }) {
  const mayChange = useMedMayChange();
  const [correcting, setCorrecting] = useState(false);
  if (!mayChange) return null;
  const name = `${lab.testName} ${valueLabel(lab)}`;
  const run: Record<LabAction, () => void> = {
    verify: () =>
      void actOnMed({
        send: setVerified(lab.id, true),
        done: `Verified ${name}`,
        failed: "Could not verify this result",
        undo: {
          send: setVerified(lab.id, false),
          done: `${name} is a draft again`,
          failed: "Could not return it to draft",
        },
      }),
    unverify: () =>
      void actOnMed({
        send: setVerified(lab.id, false),
        done: `${name} is a draft again`,
        failed: "Could not return it to draft",
        undo: {
          send: setVerified(lab.id, true),
          done: `Verified ${name}`,
          failed: "Could not verify this result",
        },
      }),
    correct: () => setCorrecting(true),
    "undo-correction": () =>
      void actOnMed({
        send: undoCorrection(lab.id),
        done: `Put back what ${lab.testName} said before`,
        failed: "Could not undo the correction",
      }),
    remove: () =>
      void actOnMed({
        send: setRemoved(lab.id, true),
        done: `Removed ${name}`,
        failed: "Could not remove this result",
        undo: {
          send: setRemoved(lab.id, false),
          done: `Put back ${name}`,
          failed: "Could not put it back",
        },
      }),
  };
  return (
    <>
      <MedRowMenu
        label={`Actions for ${lab.testName}, ${formatDay(lab.collected, today)}`}
        actions={labActions(lab).map((action) => ({
          label: ACTION_LABEL[action],
          onSelect: run[action],
        }))}
      />
      {correcting ? <CorrectLabDialog lab={lab} onClose={() => setCorrecting(false)} /> : null}
    </>
  );
}
