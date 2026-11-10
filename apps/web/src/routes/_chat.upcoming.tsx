import { createFileRoute } from "@tanstack/react-router";

import { refreshMedData } from "../med/medData";
import { UpcomingPage } from "../med/UpcomingPage";

export const Route = createFileRoute("/_chat/upcoming")({
  component: UpcomingPage,
  onEnter: refreshMedData,
});
