/**
 * T3 Med: the patient surfaces of the right panel: Summary, Labs, Plan and Timeline of the
 * patient the open thread is linked to. They only read. Every lab number is shown as the
 * store has it: no unit is converted and no change is worked out here.
 */
import { useAtom } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MedLab, MedPatientRecord } from "@t3tools/contracts/med";
import { FlaskConicalIcon } from "lucide-react";
import type { ReactNode } from "react";

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
import {
  patientRecordAtom,
  selectedLabTestAtom,
  useMedQuery,
  useThreadPatient,
  useToday,
} from "./medData";
import { draftsLabel, formatDay } from "./medLogic";
import { MedLabChart } from "./MedLabChart";
import { MedLink } from "./MedLink";
import { MedPage } from "./MedPage";
import {
  changeLabel,
  draftCounts,
  groupLabTests,
  labSeries,
  type LabTestGroup,
  nextPlans,
  plansForPanel,
  timelineEntries,
  valueLabel,
} from "./medPanelLogic";
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
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <MedPage.Lead>
        <h3 className="m-0 font-medium text-xs">{title}</h3>
        {aside === undefined ? null : <span className="tabular-nums">{aside}</span>}
      </MedPage.Lead>
      {children}
    </section>
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
}: {
  readonly tests: ReadonlyArray<LabTestGroup>;
  readonly today: string;
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
                <span className="font-medium">{name}</span>
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

function Summary({ record, today }: { readonly record: MedPatientRecord; readonly today: string }) {
  const { patient } = record;
  const counts = draftCounts(record);
  const drafts = draftsLabel(counts.labs, counts.plans);
  const open = plansForPanel(record.plans).open;
  const plans = nextPlans(record.plans, SUMMARY_PLAN_LIMIT);
  const tests = groupLabTests(record.labs);
  return (
    <>
      <div className="flex flex-col gap-1.5 px-2.5">
        <h2 className="m-0 font-semibold text-lg tracking-tight">
          <MedLink to="/patients/$patientId" params={{ patientId: patient.id }}>
            {patient.name}
          </MedLink>
        </h2>
        <PatientFacts patient={patient} today={today} />
        {drafts === null ? null : (
          <p className="m-0 text-muted-foreground text-sm">{drafts} to check.</p>
        )}
      </div>
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
          <LatestResults tests={tests} today={today} />
        )}
      </Section>
    </>
  );
}

/** Every result of one test, newest first, with the store's comparison to the baseline. */
function TestResults({ test, today }: { readonly test: LabTestGroup; readonly today: string }) {
  return (
    <div className="px-0.5">
      <Table aria-label={`Results of ${test.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">
              <Quiet>Collected</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Result</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Reference</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Flag</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>From baseline</Quiet>
            </TableHead>
            <TableHead className="h-8">
              <Quiet>Status</Quiet>
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
                <span className="font-medium tabular-nums">{valueLabel(result)}</span>
              </TableCell>
              <TableCell>
                <Quiet>{result.referenceRange}</Quiet>
              </TableCell>
              <TableCell>
                <FlagBadge flag={result.flag} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="tabular-nums">{changeLabel(result)}</span>
              </TableCell>
              <TableCell>
                <StatusCell status={result.status} />
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
  // Until the doctor picks, the first test that has a trend to draw.
  const test =
    tests.find((entry) => entry.labTestId === selected) ??
    tests.find((entry) => (labSeries(entry.results)?.points.length ?? 0) > 1) ??
    tests[0];
  if (test === undefined) {
    return (
      <MedPage.Note>
        No lab results are filed for {record.patient.name} yet. Paste a lab sheet into the chat to
        file them.
      </MedPage.Note>
    );
  }
  const series = labSeries(test.results);
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-2.5">
          <Select value={test.labTestId} onValueChange={(value) => setSelected(String(value))}>
            <SelectTrigger size="sm" aria-label="Test">
              <SelectValue>
                {series === null ? test.name : `${test.name}, ${series.unit}`}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
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
      <Section title={`Results of ${test.name}`} aside={test.results.length}>
        <TestResults test={test} today={today} />
      </Section>
      <Section title="Latest result of every test" aside={tests.length}>
        <LatestResults tests={tests} today={today} />
      </Section>
    </>
  );
}

function Plans({ record, today }: { readonly record: MedPatientRecord; readonly today: string }) {
  const { open, closed } = plansForPanel(record.plans);
  if (record.plans.length === 0) {
    return (
      <MedPage.Note>
        No plans are filed for {record.patient.name} yet. Tell the chat what to do and by when.
      </MedPage.Note>
    );
  }
  return (
    <>
      <Section title="Open" aside="Due">
        {open.length === 0 ? (
          <MedPage.Note>Nothing is open.</MedPage.Note>
        ) : (
          <MedPage.List aria-label="Open plans">
            {open.map((plan) => (
              <MedPlanRow key={plan.id} plan={plan} today={today} showStatus />
            ))}
          </MedPage.List>
        )}
      </Section>
      {closed.length === 0 ? null : (
        <Section title="Done or cancelled" aside="Due">
          <MedPage.List aria-label="Done or cancelled plans">
            {closed.map((plan) => (
              <MedPlanRow key={plan.id} plan={plan} today={today} showStatus />
            ))}
          </MedPage.List>
        </Section>
      )}
    </>
  );
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function Timeline({
  record,
  today,
}: {
  readonly record: MedPatientRecord;
  readonly today: string;
}) {
  const entries = timelineEntries(record);
  if (entries.length === 0) {
    return <MedPage.Note>Nothing is filed for {record.patient.name} yet.</MedPage.Note>;
  }
  const days = [...new Set(entries.map((entry) => entry.day))];
  return (
    <>
      {days.map((day) => (
        <Section key={day} title={formatDay(day, today)}>
          <MedPage.List aria-label={formatDay(day, today)}>
            {entries
              .filter((entry) => entry.day === day)
              .map((entry) => {
                if (entry.kind === "note") {
                  return (
                    <MedPage.ThreadRow key={entry.note.id} threadId={entry.note.threadId}>
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
                if (entry.kind === "plan") {
                  return (
                    <MedPlanRow key={entry.plan.id} plan={entry.plan} today={today} showStatus />
                  );
                }
                const drafts = entry.labs.filter((result) => result.status === "draft").length;
                return (
                  <MedPage.Row key={`labs:${day}`} className="items-start">
                    <FlaskConicalIcon
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <MedPage.Primary>{counted(entry.labs.length, "lab result")}</MedPage.Primary>
                      <MedPage.Detail>
                        {entry.labs
                          .map((result) => `${result.testName} ${valueLabel(result)}`)
                          .join("\n")}
                      </MedPage.Detail>
                    </span>
                    {drafts === 0 ? null : (
                      <Badge variant="outline" size="sm">
                        {drafts === entry.labs.length ? "Draft" : counted(drafts, "draft")}
                      </Badge>
                    )}
                  </MedPage.Row>
                );
              })}
          </MedPage.List>
        </Section>
      ))}
    </>
  );
}

function PatientSurface({
  kind,
  patientId,
}: {
  readonly kind: MedSurface["kind"];
  readonly patientId: string;
}) {
  const query = useMedQuery(patientRecordAtom(patientId));
  const today = useToday();
  return (
    <Shell>
      <MedPage.Query query={query}>
        {(record) => {
          switch (kind) {
            case "med-summary":
              return <Summary record={record} today={today} />;
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
  const patient = useThreadPatient(threadRef.environmentId, threadRef.threadId);
  if (patient === null) {
    return (
      <Shell>
        <MedPage.Note>
          No patient is linked to this chat yet. Give the chat the patient's URN and it links them.
        </MedPage.Note>
      </Shell>
    );
  }
  return <PatientSurface kind={surface.kind} patientId={patient.id} />;
}
