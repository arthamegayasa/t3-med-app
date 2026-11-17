/** T3 Med: the linked patient in the chat header, as the way to the patient's page. */
import type { EnvironmentId } from "@t3tools/contracts";

import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../components/WorkspaceBreadcrumb";
import { useThreadPatient } from "./medData";
import { MedLink } from "./MedLink";

export function MedThreadPatientCrumb({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const patient = useThreadPatient(environmentId, threadId);
  if (patient === null) return null;
  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink">
        <MedLink
          to="/patients/$patientId"
          params={{ patientId: patient.id }}
          aria-label={`Open patient ${patient.name}`}
          className="inline-flex min-w-0 max-w-full items-center text-muted-foreground transition-colors"
        >
          <WorkspaceBreadcrumbText className="max-w-48">{patient.name}</WorkspaceBreadcrumbText>
        </MedLink>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator>
        <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
      </WorkspaceBreadcrumbSeparator>
    </>
  );
}
