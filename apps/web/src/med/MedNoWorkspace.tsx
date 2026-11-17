import { Link } from "@tanstack/react-router";

import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { MED_HOME_PATH } from "./medHidden";

/**
 * T3 Med: the home page when the server opened no workspace folder, in place of upstream's offer
 * to add a project. The patient pages need no project, so they stay reachable from here.
 */
export function MedNoWorkspace() {
  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Home")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty size="hero" className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle>The patient workspace is not open</EmptyTitle>
              <EmptyDescription>
                T3 Med could not open its workspace folder, so a new chat cannot start. Check that
                the folder exists, then start T3 Med again. Patients and their records are still
                here.
              </EmptyDescription>
              <div className="mt-6 flex justify-center gap-2">
                <Button size="sm" render={<Link to={MED_HOME_PATH} />}>
                  Open patients
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
