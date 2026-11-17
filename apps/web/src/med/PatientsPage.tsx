/** T3 Med: the patient directory. Type to narrow it by name or URN, click to open a patient. */
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { patientsAtom, useMedQuery, useToday } from "./medData";
import { filterPatients, formatLastChat } from "./medLogic";
import { MedPage } from "./MedPage";

export function PatientsPage() {
  const query = useMedQuery(patientsAtom);
  const today = useToday();
  const [search, setSearch] = useState("");
  return (
    <MedPage.Root title="Patients">
      <InputGroup size="lg">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          size="lg"
          autoFocus
          aria-label="Search name or URN"
          placeholder="Search name or URN"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </InputGroup>
      <MedPage.Query query={query}>
        {({ patients }) => {
          const shown = filterPatients(patients, search);
          if (patients.length === 0) {
            return (
              <MedPage.Note>
                No patients yet. Tell the agent about a patient in a chat, with the URN, and they
                are listed here.
              </MedPage.Note>
            );
          }
          return (
            <div className="flex flex-col gap-1">
              <MedPage.Lead>
                <span>
                  {shown.length === patients.length
                    ? `${patients.length} ${patients.length === 1 ? "patient" : "patients"}`
                    : `${shown.length} of ${patients.length} patients`}
                </span>
                <span>Last chat</span>
              </MedPage.Lead>
              {shown.length === 0 ? (
                <MedPage.Note className="pt-2">No patient has this name or URN.</MedPage.Note>
              ) : (
                <MedPage.List aria-label="Patients">
                  {shown.map((patient) => (
                    <MedPage.PatientRow key={patient.id} patientId={patient.id}>
                      <MedPage.Primary className="flex-1">{patient.name}</MedPage.Primary>
                      {patient.status === "archived" ? (
                        <MedPage.Secondary className="shrink-0 text-xs">Archived</MedPage.Secondary>
                      ) : null}
                      <MedPage.Secondary className="w-28 shrink-0 text-xs tabular-nums">
                        {patient.urn ?? "No URN"}
                      </MedPage.Secondary>
                      <MedPage.Aside className="ml-0 w-20 text-right">
                        {formatLastChat(patient.lastChatAt, today)}
                      </MedPage.Aside>
                    </MedPage.PatientRow>
                  ))}
                </MedPage.List>
              )}
            </div>
          );
        }}
      </MedPage.Query>
    </MedPage.Root>
  );
}
