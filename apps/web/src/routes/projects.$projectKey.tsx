import { createFileRoute, redirect } from "@tanstack/react-router";

import { MED_HOME_PATH } from "../med/medHidden";
import { T3MED } from "../med/t3med";

export const Route = createFileRoute("/projects/$projectKey")({
  beforeLoad: async ({ context, params }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    if (T3MED) throw redirect({ to: MED_HOME_PATH, replace: true });
    throw redirect({
      to: "/settings/projects",
      search: { project: params.projectKey, machine: undefined },
      replace: true,
    });
  },
});
