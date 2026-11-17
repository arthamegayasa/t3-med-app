/** T3 Med: the form that edits who a patient is. A saved edit can be undone from its toast. */
import type { MedPatientDetails } from "@t3tools/contracts/med";
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
import { Textarea } from "../components/ui/textarea";
import { actOnMed } from "./medActions";
import { patientEditOf, type PatientForm, patientFormOf, patientUndoOf } from "./medChangeLogic";
import { patientRecordAtom, useMedQuery } from "./medData";
import { MedPage } from "./MedPage";

const SEXES = [
  { value: "", label: "Not recorded" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
] as const;

const takenBy = (failure: unknown) =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "MedUrnTakenError" &&
  "patientName" in failure &&
  typeof failure.patientName === "string"
    ? failure.patientName
    : null;

function PatientEditForm({
  patient,
  onClose,
}: {
  readonly patient: MedPatientDetails;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState(() => patientFormOf(patient));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (fields: Partial<PatientForm>) => setForm({ ...form, ...fields });

  const submit = async () => {
    const outcome = patientEditOf(patient, form);
    if (outcome.problem !== undefined) return setProblem(outcome.problem);
    const { change } = outcome;
    if (change === null) return onClose();
    setSaving(true);
    setProblem(null);
    const result = await actOnMed({
      send: (client) =>
        client.patients.updatePatient({
          headers: {},
          params: { patientId: patient.id },
          payload: change,
        }),
      done: ({ name }) => `Saved the details of ${name}`,
      undo: {
        send: (client) =>
          client.patients.updatePatient({
            headers: {},
            params: { patientId: patient.id },
            payload: patientUndoOf(patient, change),
          }),
        done: `The details of ${patient.name} are as they were`,
        failed: "Could not undo the edit",
      },
    });
    if (result.ok) return onClose();
    setSaving(false);
    const holder = takenBy(result.failure);
    setProblem(
      holder === null ? result.message : `This URN belongs to ${holder}. Nothing was changed.`,
    );
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogPanel>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-urn`}>URN</Label>
            <Input
              id={`${id}-urn`}
              value={form.urn}
              onChange={(event) => set({ urn: event.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-born`}>Date of birth</Label>
            <Input
              id={`${id}-born`}
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => set({ dateOfBirth: event.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-sex`}>Sex</Label>
          <Select
            value={form.sex}
            items={SEXES}
            onValueChange={(value) =>
              set({ sex: SEXES.find((sex) => sex.value === value)?.value ?? "" })
            }
          >
            <SelectTrigger id={`${id}-sex`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {SEXES.map((sex) => (
                <SelectItem key={sex.value} value={sex.value}>
                  {sex.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-diagnoses`}>Diagnoses</Label>
          <Textarea
            id={`${id}-diagnoses`}
            rows={3}
            value={form.diagnoses}
            onChange={(event) => set({ diagnoses: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-spellings`}>Also written as</Label>
          <Textarea
            id={`${id}-spellings`}
            rows={2}
            value={form.alsoWrittenAs}
            aria-describedby={`${id}-spellings-note`}
            onChange={(event) => set({ alsoWrittenAs: event.target.value })}
          />
          <p id={`${id}-spellings-note`} className="m-0 text-muted-foreground text-xs">
            One spelling on each line. A search by name finds the patient by any of them.
          </p>
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
  );
}

/**
 * The form opens on the patient's record, not on the page's own data: the patient's page is
 * not sent the diagnoses.
 */
export function PatientEditDialog({
  patientId,
  onClose,
}: {
  readonly patientId: string;
  readonly onClose: () => void;
}) {
  const query = useMedQuery(patientRecordAtom(patientId));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit patient details</DialogTitle>
          <DialogDescription>
            A new name keeps the old one as a spelling unless you take it off the list.
          </DialogDescription>
        </DialogHeader>
        {query.data === null ? (
          <DialogPanel>
            <MedPage.Query query={query}>{() => null}</MedPage.Query>
          </DialogPanel>
        ) : (
          <PatientEditForm patient={query.data.patient} onClose={onClose} />
        )}
      </DialogPopup>
    </Dialog>
  );
}
