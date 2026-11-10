import { createFileRoute } from "@tanstack/react-router";

import { refreshMedData } from "../med/medData";
import { PatientsPage } from "../med/PatientsPage";

export const Route = createFileRoute("/_chat/patients/")({
  component: PatientsPage,
  onEnter: refreshMedData,
});
