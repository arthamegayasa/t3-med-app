/** T3 Med: the shell the patient pages share: a top bar and one centred column. */
import { ChevronRightIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import type { EnvironmentQueryView } from "../state/query";
import { useMedEnvironmentId } from "./medData";
import { MedLink } from "./MedLink";

const ROW_CLASS = "flex min-h-9 items-center gap-3 px-2.5 py-1.5 text-sm";
const PLACEHOLDER_CLASS = "h-5 rounded-sm bg-muted-foreground/15";

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
                <MedLink to="/patients">Patients</MedLink>
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

/** What the rows of a list end with: the width the line above them leaves free. */
type RowEnd = "chevron" | "menu" | "chevron-menu";

const ACTIONS_SLOT = { menu: "w-6" } as const;

/**
 * A small muted line above a list: what it holds on the left, a column name on the right. It
 * ends where the rows' last column ends, before the width they keep for a chevron or for the
 * doctor's actions.
 */
function Lead({
  className,
  children,
  ends = "chevron",
  ...props
}: ComponentProps<"div"> & { readonly ends?: RowEnd }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-2.5 text-muted-foreground text-xs font-medium",
        ends === "chevron-menu" && "mr-7",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">{children}</div>
      <span aria-hidden className={cn("shrink-0", ends === "menu" ? "w-6" : "size-4")} />
    </div>
  );
}

function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("m-0 flex list-none flex-col gap-px p-0", className)} {...props} />;
}

/**
 * A row that opens nothing. It keeps the width of the chevron a row that opens something ends
 * with, so the two cannot be mistaken for each other and their columns still line up. `actions`
 * takes that place: the menu of what the doctor can do to the row.
 */
function Row({
  className,
  children,
  actions,
  ...props
}: ComponentProps<"li"> & { readonly actions?: ReactNode }) {
  return (
    <li className={cn(ROW_CLASS, className)} {...props}>
      {children}
      {actions === undefined ? (
        <span aria-hidden className="size-4 shrink-0" />
      ) : (
        <span className={cn("flex shrink-0 justify-end", ACTIONS_SLOT.menu)}>{actions}</span>
      )}
    </li>
  );
}

function Opens() {
  return <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * A row that opens its thread, or a plain row without one. `actions` sit after the link, never
 * in it, in a width every row of the list names in `actionsEnd`. `below` belongs to the row
 * and is outside the link too: what it would confirm, and the controls that confirm it.
 */
function ThreadRow({
  threadId,
  actions,
  actionsEnd,
  below,
  children,
}: {
  readonly threadId: string | null;
  readonly actions?: ReactNode;
  readonly actionsEnd?: keyof typeof ACTIONS_SLOT | undefined;
  readonly below?: ReactNode;
  readonly children: ReactNode;
}) {
  const environmentId = useMedEnvironmentId();
  const opens = threadId !== null && environmentId !== null;
  if (below !== undefined) {
    const cells = (
      <>
        {children}
        {opens ? <Opens /> : <span aria-hidden className="size-4 shrink-0" />}
      </>
    );
    return (
      <li className="flex flex-col">
        {opens ? (
          <MedLink
            variant="row"
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId }}
            className={ROW_CLASS}
          >
            {cells}
          </MedLink>
        ) : (
          <div className={ROW_CLASS}>{cells}</div>
        )}
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">{below}</div>
      </li>
    );
  }
  if (!opens && actionsEnd === undefined) return <Row>{children}</Row>;
  return (
    <li className="flex items-center gap-1">
      {opens ? (
        <MedLink
          variant="row"
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className={cn(ROW_CLASS, "min-w-0 flex-1")}
        >
          {children}
          <Opens />
        </MedLink>
      ) : (
        <div className={cn(ROW_CLASS, "min-w-0 flex-1")}>
          {children}
          <span aria-hidden className="size-4 shrink-0" />
        </div>
      )}
      {actionsEnd === undefined ? null : (
        <span className={cn("flex shrink-0 justify-end", ACTIONS_SLOT[actionsEnd])}>{actions}</span>
      )}
    </li>
  );
}

/** A row that opens its patient's page, or a plain row for what has no patient yet. */
function PatientRow({
  patientId,
  children,
}: {
  readonly patientId: string | null;
  readonly children: ReactNode;
}) {
  if (patientId === null) return <Row>{children}</Row>;
  return (
    <li>
      <MedLink variant="row" to="/patients/$patientId" params={{ patientId }} className={ROW_CLASS}>
        {children}
        <Opens />
      </MedLink>
    </li>
  );
}

function Primary({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-0 truncate font-medium", className)} {...props} />;
}

function Secondary({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-0 truncate text-muted-foreground", className)} {...props} />;
}

/** Text the doctor has to read whole, such as a question: wrapped, never cut. */
function Detail({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "min-w-0 whitespace-pre-line break-words text-muted-foreground text-xs",
        className,
      )}
      {...props}
    />
  );
}

/** The URN beside a patient's name, which tells two patients of one name apart. */
function Urn({ urn, className }: { readonly urn: string | null; readonly className?: string }) {
  return (
    <span className={cn("shrink-0 text-muted-foreground text-xs tabular-nums", className)}>
      {urn === null ? "No URN" : `URN ${urn}`}
    </span>
  );
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

/** Placeholder rows that do not move, for what has not arrived yet. */
function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 px-2.5 pt-1">
      <div className={cn(PLACEHOLDER_CLASS, "w-2/3")} />
      <div className={cn(PLACEHOLDER_CLASS, "w-1/2")} />
      <div className={cn(PLACEHOLDER_CLASS, "w-3/5")} />
    </div>
  );
}

/** A read that failed with nothing to show in its place: what went wrong and a retry. */
function Failed({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-2.5">
      <Note className="px-0">Could not load this from T3 Med. {error}</Note>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The states of one query. Nothing loaded yet shows placeholder rows; a failed first load says
 * so and offers a retry; a failed refresh keeps what was loaded and says it is old.
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
      <Loading />
    ) : (
      <Failed error={query.error} onRetry={query.refresh} />
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
  Detail,
  Urn,
  Aside,
  Note,
  Loading,
  Failed,
  Query,
};
