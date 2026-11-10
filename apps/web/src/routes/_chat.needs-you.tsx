import { createFileRoute } from "@tanstack/react-router";

import { refreshMedData } from "../med/medData";
import { NeedsYouPage } from "../med/NeedsYouPage";

export const Route = createFileRoute("/_chat/needs-you")({
  component: NeedsYouPage,
  onEnter: refreshMedData,
});
