/**
 * T3 Med: one test's results over time. The line is an SVG stretched to the plot; dots and
 * labels are positioned in percent over it, so the chart follows the panel's width without
 * being measured and its text keeps its size.
 */
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { formatDay } from "./medLogic";
import { chartGeometry, formatLabNumber, type LabSeries } from "./medPanelLogic";

// Past this many points the value labels would run into each other; the table has every value.
const MAX_LABELLED_POINTS = 6;

const dayWithYear = (isoDate: string) => formatDay(isoDate, "");

function describeSeries(name: string, series: LabSeries): string {
  const results = series.points.map(
    (point) =>
      `${formatLabNumber(point.value)} on ${dayWithYear(point.collected)}${
        point.baseline ? " (baseline)" : point.draft ? " (draft)" : ""
      }`,
  );
  return `${name} in ${series.unit}: ${results.join(", ")}.`;
}

function LegendItem({ swatch, children }: { readonly swatch: string; readonly children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("shrink-0", swatch)} />
      {children}
    </span>
  );
}

export function MedLabChart({
  name,
  series,
}: {
  readonly name: string;
  readonly series: LabSeries;
}) {
  const { points, baselineY } = chartGeometry(series);
  const first = points[0];
  const last = points.at(-1);
  const labelled = points.length <= MAX_LABELLED_POINTS;
  const hasDraft = points.some((point) => point.draft);
  const baseline = points.find((point) => point.baseline);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div role="img" aria-label={describeSeries(name, series)} className="px-7 pt-6 pb-5">
        <div className="relative h-28">
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <line
              x1="-6"
              x2="106"
              y1={baselineY}
              y2={baselineY}
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-foreground/50"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {points.slice(1).map((point, index) => {
              const previous = points[index];
              return previous === undefined ? null : (
                <line
                  key={point.id}
                  x1={previous.x}
                  y1={previous.y}
                  x2={point.x}
                  y2={point.y}
                  vectorEffect="non-scaling-stroke"
                  className="stroke-info"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={point.draft ? "4 4" : undefined}
                />
              );
            })}
          </svg>
          {points.map((point, index) => (
            <Tooltip key={point.id}>
              <TooltipTrigger
                render={
                  <span
                    // Positions come from the data, so they cannot be classes.
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    className={cn(
                      "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                      point.draft ? "border-2 border-info bg-background" : "bg-info",
                    )}
                  />
                }
              >
                {labelled || index === 0 || index === points.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 font-medium text-foreground text-xs tabular-nums"
                  >
                    {formatLabNumber(point.value)}
                  </span>
                ) : null}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {`${dayWithYear(point.collected)}: ${formatLabNumber(point.value)} ${series.unit}${
                  point.draft ? " (draft)" : ""
                }`}
              </TooltipPopup>
            </Tooltip>
          ))}
          <div
            aria-hidden
            className="absolute inset-x-0 top-full mt-2 flex justify-between text-muted-foreground text-xs tabular-nums"
          >
            {first === undefined || last === undefined ? null : first.id === last.id ? (
              <span className="mx-auto">{dayWithYear(first.collected)}</span>
            ) : (
              <>
                <span className="-ml-5">{dayWithYear(first.collected)}</span>
                <span className="-mr-5">{dayWithYear(last.collected)}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2.5 text-muted-foreground text-xs">
        <LegendItem swatch="size-2 rounded-full bg-info">Verified</LegendItem>
        {hasDraft ? (
          <LegendItem swatch="size-2 rounded-full border-2 border-info">Draft</LegendItem>
        ) : null}
        {baseline === undefined ? null : (
          <LegendItem swatch="w-4 border-muted-foreground/50 border-t border-dashed">
            {`Baseline ${formatLabNumber(baseline.value)} ${series.unit}`}
          </LegendItem>
        )}
      </figcaption>
      {series.notPlotted === 0 ? null : (
        <p className="m-0 px-2.5 text-muted-foreground text-xs">
          {series.notPlotted === 1
            ? "1 result is not on the chart: it could not be compared with the baseline."
            : `${series.notPlotted} results are not on the chart: they could not be compared with the baseline.`}
        </p>
      )}
    </figure>
  );
}
