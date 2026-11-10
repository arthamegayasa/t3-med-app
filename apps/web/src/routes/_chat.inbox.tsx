import { createFileRoute } from "@tanstack/react-router";

import { InboxPage } from "../med/InboxPage";
import { refreshMedData } from "../med/medData";

export const Route = createFileRoute("/_chat/inbox")({
  component: InboxPage,
  onEnter: refreshMedData,
});
