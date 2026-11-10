/** T3 Med: the linked patient in the chat header, as the way to the patient's page. */
import { Link } from "@tanstack/react-router";

import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../components/WorkspaceBreadcrumb";
import { useThreadPatient } from "./medData";

export function MedThreadPatientCrumb({ threadId }: { readonly threadId: string }) {
  const patient = useThreadPatient(threadId);
  if (patient === null) return null;
  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink">
        <Link
          to="/patients/$patientId"
          params={{ patientId: patient.id }}
          aria-label={`Open patient ${patient.name}`}
          className="inline-flex min-w-0 max-w-full items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <WorkspaceBreadcrumbText className="max-w-48">{patient.name}</WorkspaceBreadcrumbText>
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator>
        <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
      </WorkspaceBreadcrumbSeparator>
    </>
  );
}
