/** T3 Med: the shell the patient pages share: a top bar and one centred column. */
import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { usePrimaryEnvironmentId } from "../state/environments";
import type { EnvironmentQueryView } from "../state/query";

const ROW_CLASS =
  "flex min-h-9 items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm outline-hidden ring-ring";
const ROW_LINK_CLASS = "hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset";

function Root({
  title,
  underPatients = false,
  children,
}: {
  readonly title: string;
  /** Shows `Patients /` before the title, as the way back to the directory. */
  readonly underPatients?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="bg-background">
        <WorkspaceBreadcrumb ariaLabel="Page breadcrumb" className="overflow-hidden">
          {underPatients ? (
            <>
              <WorkspaceBreadcrumbItem>
                <Link
                  to="/patients"
                  className="rounded-sm outline-hidden ring-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset"
                >
                  Patients
                </Link>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">{title}</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer className="max-w-2xl gap-4">{children}</WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

/** A small muted line above a list: what it holds on the left, a column name on the right. */
function Lead({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-2.5 text-muted-foreground text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("m-0 flex list-none flex-col gap-px p-0", className)} {...props} />;
}

/** A row that opens its thread, or plain text when the note has none. */
function ThreadRow({
  threadId,
  children,
}: {
  readonly threadId: string | null;
  readonly children: ReactNode;
}) {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <li>
      {threadId !== null && environmentId !== null ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className={cn(ROW_CLASS, ROW_LINK_CLASS)}
        >
          {children}
        </Link>
      ) : (
        <div className={ROW_CLASS}>{children}</div>
      )}
    </li>
  );
}

function PatientRow({
  patientId,
  children,
}: {
  readonly patientId: string;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <Link
        to="/patients/$patientId"
        params={{ patientId }}
        className={cn(ROW_CLASS, ROW_LINK_CLASS)}
      >
        {children}
      </Link>
    </li>
  );
}

function Row({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn(ROW_CLASS, className)} {...props} />;
}

function Primary({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-0 truncate font-medium", className)} {...props} />;
}

function Secondary({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-0 truncate text-muted-foreground", className)} {...props} />;
}

/** The trailing date or count of a row. */
function Aside({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("ml-auto shrink-0 pl-2 text-muted-foreground text-xs tabular-nums", className)}
      {...props}
    />
  );
}

/** One sentence: what the screen is for and what to do. */
function Note({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("m-0 px-2.5 text-muted-foreground text-sm", className)} {...props} />;
}

/**
 * The states of one query. Nothing loaded yet shows still placeholder rows; a failed first
 * load says so and offers a retry; a failed refresh keeps what was loaded and says it is old.
 */
function Query<A>({
  query,
  children,
}: {
  readonly query: EnvironmentQueryView<A>;
  readonly children: (data: A) => ReactNode;
}) {
  if (query.data === null) {
    return query.error === null ? (
      <div aria-busy="true" className="flex flex-col gap-2 px-2.5 pt-1">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    ) : (
      <div role="alert" className="flex flex-col items-start gap-2 px-2.5">
        <Note className="px-0">Could not load this from T3 Med. {query.error}</Note>
        <Button variant="outline" size="sm" onClick={query.refresh}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <>
      {query.error === null ? null : (
        <div role="alert" className="flex items-center gap-3 px-2.5">
          <Note className="px-0">Could not refresh, so this may be out of date.</Note>
          <Button variant="outline" size="compact" onClick={query.refresh}>
            Try again
          </Button>
        </div>
      )}
      {children(query.data)}
    </>
  );
}

export const MedPage = {
  Root,
  Lead,
  List,
  Row,
  ThreadRow,
  PatientRow,
  Primary,
  Secondary,
  Aside,
  Note,
  Query,
};
