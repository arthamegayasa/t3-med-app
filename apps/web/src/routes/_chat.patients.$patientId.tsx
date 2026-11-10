import { createFileRoute } from "@tanstack/react-router";

import { refreshMedData } from "../med/medData";
import { PatientHomePage } from "../med/PatientHomePage";

function PatientHomeRoute() {
  const { patientId } = Route.useParams();
  return <PatientHomePage patientId={patientId} />;
}

export const Route = createFileRoute("/_chat/patients/$patientId")({
  component: PatientHomeRoute,
  onEnter: refreshMedData,
  // Going from one patient to another stays on this route.
  onStay: refreshMedData,
});
