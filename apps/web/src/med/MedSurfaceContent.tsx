/**
 * T3 Med: the patient surfaces of the right panel: Summary, Labs, Plan and Timeline of the
 * patient the open thread is linked to. Every lab number is shown as the store has it: no unit
 * is converted and no change is worked out here. Labs and Plan carry the doctor's row actions.
 */
import { useAtom, useAtomSet } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MedLab, MedPatientRecord } from "@t3tools/contracts/med";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useRightPanelStore } from "../rightPanelStore";
import {
  patientRecordAtom,
  selectedLabTestAtom,
  useMedQuery,
  useThreadPatientState,
  useToday,
} from "./medData";
import { LabRevisions, LabRowActions } from "./MedLabActions";
import { MedLabChart } from "./MedLabChart";
import { MedLink } from "./MedLink";
import { draftsLabel, formatDay } from "./medLogic";
import { MedPage } from "./MedPage";
import {
  changeLabel,
  draftCounts,
  groupLabTests,
  labSeries,
  type LabTestGroup,
  nextPlans,
  patientTimeline,
  plansForPanel,
  type TimelineEntry,
  valueLabel,
} from "./medPanelLogic";
import { PlanRowActions } from "./MedPlanActions";
import { MedPlanRow } from "./MedPlanRow";
import type { MedSurface } from "./medSurfaces";
import { PatientFacts } from "./PatientHomePage";

const SUMMARY_PLAN_LIMIT = 3;

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-2 py-4">{children}</div>
    </div>
  );
}

function Section({
  title,
  aside,
  nested = false,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  /** Under a group's own heading, so one level further down. */
  readonly nested?: boolean;
  readonly children: ReactNode;
}) {
  const Heading = nested ? "h4" : "h3";
  return (
    <section className="flex flex-col gap-1.5">
      <MedPage.Lead>
        <Heading className="m-0 font-medium text-xs">{title}</Heading>
        {aside === undefined ? null : <span className="tabular-nums">{aside}</span>}
      </MedPage.Lead>
      {children}
    </section>
  );
}

/**
 * Whose record this is, at the top of every patient surface: a tab can stay open while the
 * doctor reads another chat, so the name and URN are never left to memory.
 */
function PatientHeading({
  patient,
  today,
  children,
}: {
  readonly patient: MedPatientRecord["patient"];
  readonly today: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-2.5">
      <h2 className="m-0 font-semibold text-lg tracking-tight">
        <MedLink to="/patients/$patientId" params={{ patientId: patient.id }}>
          {patient.name}
        </MedLink>
      </h2>
      <PatientFacts patient={patient} today={today} />
      {children}
    </div>
  );
}

/** Table text that is not the result itself: headings, dates, reference ranges. */
function Quiet({ children }: { readonly children: ReactNode }) {
  return <span className="text-muted-foreground tabular-nums">{children}</span>;
}

const FLAG = {
  high: { label: "High", variant: "warning" },
  low: { label: "Low", variant: "info" },
  normal: { label: "Normal", variant: "outline" },
} as const;

function FlagBadge({ flag }: { readonly flag: MedLab["flag"] }) {
  return flag === null ? null : (
    <Badge variant={FLAG[flag].variant} size="sm">
      {FLAG[flag].label}
    </Badge>
  );
}

function StatusCell({ status }: { readonly status: MedLab["status"] }) {
  return status === "draft" ? (
    <Badge variant="outline" size="sm">
      Draft
    </Badge>
  ) : (
    <Quiet>Verified</Quiet>
  );
}

/** The latest result of every test, so no test is hidden behind the Labs picker. */
function LatestResults({
  tests,
  today,
  opens,
  onOpenTest,
}: {
  readonly tests: ReadonlyArray<LabTestGroup>;
  readonly today: string;
  /** What choosing a test does, for a reader who cannot see where it leads. */
  readonly opens: string;
  readonly onOpenTest: (labTestId: string) => void;
}) {
  return (
    <div className="px-0.5">
      <Table aria-label="Latest result of every test">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">
              <Quiet>Test</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Result</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Flag</Quiet>
            </TableHead>
            <TableHead className="h-8 text-right">
              <Quiet>Collected</Quiet>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tests.map(({ labTestId, name, latest }) => (
            <TableRow key={labTestId}>
              <TableCell className="whitespace-normal">
                <button
                  type="button"
                  aria-label={`${name}: ${opens}`}
                  onClick={() => onOpenTest(labTestId)}
                  className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm text-left font-medium outline-hidden ring-ring hover:underline focus-visible:ring-2 focus-visible:ring-inset"
                >
                  {name}
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </button>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {valueLabel(latest)}
                  {latest.status === "draft" ? (
                    <Badge variant="outline" size="sm">
                      Draft
                    </Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell>
                <FlagBadge flag={latest.flag} />
              </TableCell>
              <TableCell className="text-right">
                <Quiet>{formatDay(latest.collected, today)}</Quiet>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Summary({
  record,
  today,
  threadRef,
}: {
  readonly record: MedPatientRecord;
  readonly today: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const { patient } = record;
  const counts = draftCounts(record);
  const drafts = draftsLabel(counts.labs, counts.plans);
  const open = plansForPanel(record.plans).open;
  const plans = nextPlans(record.plans, SUMMARY_PLAN_LIMIT);
  const tests = groupLabTests(record.labs);
  const selectTest = useAtomSet(selectedLabTestAtom(patient.id));
  return (
    <>
      <PatientHeading patient={patient} today={today}>
        {drafts === null ? null : (
          <p className="m-0 text-muted-foreground text-sm">{drafts} to check.</p>
        )}
      </PatientHeading>
      <Section title="Diagnoses">
        {patient.diagnoses.trim() === "" ? (
          <MedPage.Note>None recorded.</MedPage.Note>
        ) : (
          <p className="m-0 whitespace-pre-line break-words px-2.5 text-sm">{patient.diagnoses}</p>
        )}
      </Section>
      <Section title="Next plans" aside={plans.length === 0 ? undefined : "Due"}>
        {plans.length === 0 ? (
          <MedPage.Note>No plans ahead.</MedPage.Note>
        ) : (
          <>
            <MedPage.List aria-label="Next plans">
              {plans.map((plan) => (
                <MedPlanRow key={plan.id} plan={plan} today={today} />
              ))}
            </MedPage.List>
            {open.length > plans.length ? (
              <MedPage.Note className="text-xs">
                {open.length - plans.length} more in Plan.
              </MedPage.Note>
            ) : null}
          </>
        )}
      </Section>
      <Section title="Latest results">
        {tests.length === 0 ? (
          <MedPage.Note>No lab results filed yet.</MedPage.Note>
        ) : (
          <LatestResults
            tests={tests}
            today={today}
            opens="open in Labs"
            onOpenTest={(labTestId) => {
              selectTest(labTestId);
              useRightPanelStore.getState().open(threadRef, "med-labs");
            }}
          />
        )}
      </Section>
    </>
  );
}

/** Every result of one test, newest first, with the store's comparison to the baseline. */
function TestResults({ test, today }: { readonly test: LabTestGroup; readonly today: string }) {
  return (
    <div className="@container px-0.5">
      <Table aria-label={`Results of ${test.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">
              <Quiet>Collected</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Result</Quiet>
            </TableHead>
            <TableHead className="hidden h-8 @md:table-cell">
              <Quiet>Reference</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Flag</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>From baseline</Quiet>
            </TableHead>
            <TableHead className="hidden h-8 @md:table-cell">
              <Quiet>Status</Quiet>
            </TableHead>
            <TableHead className="h-8 w-8">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {test.results.toReversed().map((result) => (
            <TableRow key={result.id}>
              <TableCell>
                <Quiet>{formatDay(result.collected, today)}</Quiet>
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium tabular-nums">{valueLabel(result)}</span>
                  <span className="flex items-center gap-1.5 @md:hidden">
                    {result.referenceRange === "" ? null : (
                      <Quiet>Ref. {result.referenceRange}</Quiet>
                    )}
                    <StatusCell status={result.status} />
                  </span>
                  <LabRevisions lab={result} today={today} />
                </span>
              </TableCell>
              <TableCell className="hidden @md:table-cell">
                <Quiet>{result.referenceRange}</Quiet>
              </TableCell>
              <TableCell>
                <FlagBadge flag={result.flag} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="tabular-nums">{changeLabel(result)}</span>
              </TableCell>
              <TableCell className="hidden @md:table-cell">
                <StatusCell status={result.status} />
              </TableCell>
              <TableCell className="w-8">
                <LabRowActions lab={result} today={today} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Labs({ record, today }: { readonly record: MedPatientRecord; readonly today: string }) {
  const tests = groupLabTests(record.labs);
  const [selected, setSelected] = useAtom(selectedLabTestAtom(record.patient.id));
  const chartRef = useRef<HTMLDivElement>(null);
  // Until the doctor picks, the first test that has a trend to draw.
  const test =
    tests.find((entry) => entry.labTestId === selected) ??
    tests.find((entry) => (labSeries(entry.results)?.points.length ?? 0) > 1) ??
    tests[0];
  if (test === undefined) {
    return (
      <>
        <PatientHeading patient={record.patient} today={today} />
        <MedPage.Note>
          No lab results are filed for {record.patient.name} yet. Paste a lab sheet into the chat to
          file them.
        </MedPage.Note>
      </>
    );
  }
  const series = labSeries(test.results);
  return (
    <>
      <PatientHeading patient={record.patient} today={today} />
      <div ref={chartRef} className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-2.5">
          <Select value={test.labTestId} onValueChange={(value) => setSelected(String(value))}>
            <SelectTrigger size="sm" aria-label="Test">
              <SelectValue>
                {series === null ? test.name : `${test.name}, ${series.unit}`}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {tests.map((entry) => (
                <SelectItem key={entry.labTestId} hideIndicator value={entry.labTestId}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {series === null ? (
          <MedPage.Note>
            {test.name} has no result with a number, so there is no trend to draw.
          </MedPage.Note>
        ) : (
          <MedLabChart name={test.name} series={series} />
        )}
      </div>
      <Section title={`Results of ${test.name}`}>
        <TestResults test={test} today={today} />
      </Section>
      <Section title="Latest result of every test">
        <LatestResults
          tests={tests}
          today={today}
          opens="show its results"
          onOpenTest={(labTestId) => {
            setSelected(labTestId);
            // The chart is above this table: bring what the choice changed into view.
            chartRef.current?.scrollIntoView({ block: "nearest" });
          }}
        />
      </Section>
    </>
  );
}

function Plans({ record, today }: { readonly record: MedPatientRecord; readonly today: string }) {
  const { open, closed } = plansForPanel(record.plans);
  if (record.plans.length === 0) {
    return (
      <>
        <PatientHeading patient={record.patient} today={today} />
        <MedPage.Note>
          No plans are filed for {record.patient.name} yet. Tell the chat what to do and by when.
        </MedPage.Note>
      </>
    );
  }
  return (
    <>
      <PatientHeading patient={record.patient} today={today} />
      <Section title="Open" aside="Due">
        {open.length === 0 ? (
          <MedPage.Note>Nothing is open.</MedPage.Note>
        ) : (
          <MedPage.List aria-label="Open plans">
            {open.map((plan) => (
              <MedPlanRow
                key={plan.id}
                plan={plan}
                today={today}
                showStatus
                actions={<PlanRowActions plan={plan} />}
              />
            ))}
          </MedPage.List>
        )}
      </Section>
      {closed.length === 0 ? null : (
        <Section title="Done or cancelled" aside="Due">
          <MedPage.List aria-label="Done or cancelled plans">
            {closed.map((plan) => (
              <MedPlanRow
                key={plan.id}
                plan={plan}
                today={today}
                showStatus
                actions={<PlanRowActions plan={plan} />}
              />
            ))}
          </MedPage.List>
        </Section>
      )}
    </>
  );
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One collected day's results, each on its own line with what marks it out. */
function LabBatchRow({ labs }: { readonly labs: ReadonlyArray<MedLab> }) {
  const drafts = labs.filter((result) => result.status === "draft").length;
  return (
    <MedPage.Row className="items-start">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <MedPage.Primary>
          {counted(labs.length, "lab result")}
          {drafts === 0
            ? ""
            : drafts === labs.length
              ? labs.length === 1
                ? ", a draft"
                : ", all drafts"
              : `, ${counted(drafts, "draft")}`}
        </MedPage.Primary>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {labs.map((result) => (
            <li
              key={result.id}
              className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs"
            >
              <span className="min-w-0 break-words tabular-nums">
                {result.testName} {valueLabel(result)}
              </span>
              {result.flag === "normal" ? null : <FlagBadge flag={result.flag} />}
              {result.status === "draft" ? <StatusCell status="draft" /> : null}
            </li>
          ))}
        </ul>
      </span>
    </MedPage.Row>
  );
}

function HistoryRow({ entry, today }: { readonly entry: TimelineEntry; readonly today: string }) {
  if (entry.kind === "labs") return <LabBatchRow labs={entry.labs} />;
  if (entry.kind === "plan") {
    return <MedPlanRow plan={entry.plan} today={today} showStatus showDue={false} />;
  }
  return (
    <MedPage.ThreadRow threadId={entry.note.threadId}>
      <span className="flex min-w-0 flex-1 flex-col">
        <MedPage.Primary>{entry.note.title}</MedPage.Primary>
        {entry.note.summary.trim() === "" ? null : (
          <MedPage.Detail>{entry.note.summary}</MedPage.Detail>
        )}
      </span>
      {entry.note.needsYou.trim() === "" ? null : (
        <Badge variant="info" size="sm">
          Needs you
        </Badge>
      )}
    </MedPage.ThreadRow>
  );
}

const historyKey = (entry: TimelineEntry) =>
  entry.kind === "labs" ? "labs" : entry.kind === "plan" ? entry.plan.id : entry.note.id;

function GroupHeading({ children }: { readonly children: string }) {
  return <h3 className="m-0 px-2.5 font-semibold text-sm">{children}</h3>;
}

function Timeline({
  record,
  today,
}: {
  readonly record: MedPatientRecord;
  readonly today: string;
}) {
  const { comingUp, history } = patientTimeline(record);
  if (comingUp.length === 0 && history.length === 0) {
    return (
      <>
        <PatientHeading patient={record.patient} today={today} />
        <MedPage.Note>Nothing is filed for {record.patient.name} yet.</MedPage.Note>
      </>
    );
  }
  const days = [...new Set(history.map((entry) => entry.day))];
  return (
    <>
      <PatientHeading patient={record.patient} today={today} />
      <section className="flex flex-col gap-2">
        <GroupHeading>Coming up</GroupHeading>
        {comingUp.length === 0 ? (
          <MedPage.Note>No open plans.</MedPage.Note>
        ) : (
          <>
            <MedPage.Lead>
              <span>Open plans, soonest first</span>
              <span>Due</span>
            </MedPage.Lead>
            <MedPage.List aria-label="Coming up">
              {comingUp.map((plan) => (
                <MedPlanRow key={plan.id} plan={plan} today={today} />
              ))}
            </MedPage.List>
          </>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <GroupHeading>History</GroupHeading>
        {days.length === 0 ? (
          <MedPage.Note>Nothing has been filed yet.</MedPage.Note>
        ) : (
          days.map((day) => (
            <Section key={day} nested title={formatDay(day, today)}>
              <MedPage.List aria-label={formatDay(day, today)}>
                {history
                  .filter((entry) => entry.day === day)
                  .map((entry) => (
                    <HistoryRow key={historyKey(entry)} entry={entry} today={today} />
                  ))}
              </MedPage.List>
            </Section>
          ))
        )}
      </section>
    </>
  );
}

function PatientSurface({
  kind,
  patientId,
  threadRef,
}: {
  readonly kind: MedSurface["kind"];
  readonly patientId: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const query = useMedQuery(patientRecordAtom(patientId));
  const today = useToday();
  return (
    <Shell>
      <MedPage.Query query={query}>
        {(record) => {
          switch (kind) {
            case "med-summary":
              return <Summary record={record} today={today} threadRef={threadRef} />;
            case "med-labs":
              return <Labs record={record} today={today} />;
            case "med-plan":
              return <Plans record={record} today={today} />;
            case "med-timeline":
              return <Timeline record={record} today={today} />;
          }
        }}
      </MedPage.Query>
    </Shell>
  );
}

/** What a patient surface's tab shows, for the thread the panel belongs to. */
export function MedSurfaceContent({
  surface,
  threadRef,
}: {
  readonly surface: MedSurface;
  readonly threadRef: ScopedThreadRef;
}) {
  const state = useThreadPatientState(threadRef.environmentId, threadRef.threadId);
  switch (state.kind) {
    case "loading":
      return (
        <Shell>
          <MedPage.Loading />
        </Shell>
      );
    case "failed":
      return (
        <Shell>
          <MedPage.Failed error={state.error} onRetry={state.retry} />
        </Shell>
      );
    case "none":
      return (
        <Shell>
          <MedPage.Note>
            No patient is linked to this chat yet. Give the chat the patient's URN and it links
            them.
          </MedPage.Note>
        </Shell>
      );
    case "linked":
      return (
        <PatientSurface kind={surface.kind} patientId={state.patient.id} threadRef={threadRef} />
      );
  }
}
