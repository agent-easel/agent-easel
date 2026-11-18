import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { OpenInT3 } from "./open-in-t3.tsx";
import type { RunDetail } from "@t3-factory/contracts";
import { Maximize2 } from "lucide-react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDismiss,
  DialogSurface,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isSingleOutput } from "../block-kind.ts";
import { capturedExits } from "../flow-graph.ts";
import { clockTime } from "./execution-state.tsx";
import { InspectorDisclosure } from "./inspector-section.tsx";
import { CopyButton } from "./copy-button.tsx";

type RunReport = RunDetail["reports"][number];
type Density = "card" | "reader";

const typography: Record<Density, { title: string; heading: string; text: string }> = {
  card: {
    title: "text-sm font-semibold text-foreground",
    heading: "text-sm font-semibold text-foreground",
    text: "text-sm text-muted-foreground",
  },
  reader: {
    title: "text-lg font-semibold text-foreground",
    heading: "text-base font-semibold text-foreground",
    text: "text-base text-muted-foreground",
  },
};

/** Gives a Markdown element its design-system classes; react-markdown's `node` stays out of the DOM. */
function styled(tag: string, className: string) {
  return function Styled({
    node: _node,
    className: own,
    ...props
  }: ExtraProps & { className?: string | undefined }) {
    return createElement(tag, { ...props, className: cn(className, own) });
  };
}

function markdownComponents(density: Density): Components {
  const { title, heading, text } = typography[density];
  return {
    h1: styled("h1", title),
    h2: styled("h2", title),
    h3: styled("h3", heading),
    h4: styled("h4", heading),
    h5: styled("h5", heading),
    h6: styled("h6", heading),
    p: styled("p", text),
    ul: styled(
      "ul",
      cn(
        text,
        "flex list-disc flex-col gap-1.5 pl-5 marker:text-subtle-foreground [&.contains-task-list]:list-none [&.contains-task-list]:pl-1",
      ),
    ),
    ol: styled(
      "ol",
      cn(text, "flex list-decimal flex-col gap-1.5 pl-5 marker:text-subtle-foreground"),
    ),
    li: styled(
      "li",
      "pl-0.5 [&.task-list-item]:flex [&.task-list-item]:items-center [&.task-list-item]:gap-2 [&>ol]:mt-1.5 [&>ul]:mt-1.5",
    ),
    blockquote: styled("blockquote", "flex flex-col gap-2 border-l-2 pl-3"),
    hr: styled("hr", "border-border"),
    code: styled("code", "font-mono text-foreground"),
    pre: styled(
      "pre",
      "overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground",
    ),
    table: ({ node: _node, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props} className={cn(text, "border-collapse")} />
      </div>
    ),
    th: styled("th", "border px-2 py-1 text-left font-semibold text-foreground"),
    td: styled("td", "border px-2 py-1 align-top"),
    a: ({ node: _node, ...props }) => (
      <a {...props} className="text-link hover:underline" target="_blank" rel="noreferrer" />
    ),
    // Results never fetch remote images: an image reads as a link to it.
    img: ({ src, alt }) =>
      typeof src === "string" ? (
        <a className="text-link hover:underline" href={src} target="_blank" rel="noreferrer">
          {alt || src}
        </a>
      ) : null,
    input: ({ checked }) => (
      <Checkbox checked={!!checked} disabled aria-label={checked ? "Done" : "Not done"} />
    ),
  };
}

const components = { card: markdownComponents("card"), reader: markdownComponents("reader") };

/**
 * One rendering of an Agent's result: CommonMark with GitHub tables and task lists. Raw HTML stays
 * literal text and links open outside Factory.
 */
function ResultMarkdown({ text, density }: { text: string; density: Density }) {
  return (
    <div
      className={cn("flex min-w-0 flex-col break-words", density === "card" ? "gap-2" : "gap-3")}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components[density]}>
        {text}
      </Markdown>
    </div>
  );
}

/** A visit's finished reports in order; the newest is its result. */
function visitResults(run: RunDetail, report: RunReport) {
  if (!report.activationId || report.status !== "finished") return [report];
  return run.reports.filter(
    (r) => r.activationId === report.activationId && r.status === "finished",
  );
}

export function resultVersion(run: RunDetail, report: RunReport) {
  return visitResults(run, report).indexOf(report) + 1;
}

function blockName(run: RunDetail, blockId: string) {
  return run.blocks.find((b) => b.blockId === blockId)?.name ?? blockId;
}

type Intent = RunDetail["intents"][number];

function intentState(run: RunDetail, intent: Intent) {
  if (intent.state === "acknowledged") return "Delivered";
  if (intent.state === "cancelled") return "Cancelled";
  const released = run.events.some((e) => e.kind === "handoff-released" && e.causeId === intent.id);
  return released ? "Released · delivery unconfirmed" : "Held";
}

/** Where the result went: one phrase per handoff, or why it was not handed off again. */
function deliveries(run: RunDetail, report: RunReport) {
  const intents = run.intents.filter((i) => i.reportId === report.id);
  // A same-exit replacement after hand-off creates no handoffs of its own.
  if (!intents.length && report.recipients.length)
    return [
      `Result updated · not handed off again to ${report.recipients.map((id) => blockName(run, id)).join(", ")}`,
    ];
  return intents.map(
    (intent) =>
      `${intentState(run, intent)} → ${blockName(run, intent.blockId)}${intent.problem ? ` · ${intent.problem}` : ""}`,
  );
}

function resultFacts(run: RunDetail, report: RunReport) {
  const exit = capturedExits(run.definitions, report.blockId).find((e) => e.id === report.exitId);
  const results = visitResults(run, report);
  const version = results.indexOf(report) + 1;
  const visit = report.activationId
    ? run.activations
        .filter((a) => a.blockId === report.blockId)
        .findIndex((a) => a.id === report.activationId) + 1
    : 0;
  return {
    name: [blockName(run, report.blockId), visit > 0 && `Visit ${visit}`, "result"]
      .filter(Boolean)
      .join(" · "),
    block: blockName(run, report.blockId),
    visit: [visit > 0 && `Visit ${visit}`, version > 1 && `version ${version}`]
      .filter(Boolean)
      .join(" · "),
    // A single unnamed output has no name to show.
    exit: exit && isSingleOutput(exit) ? null : (exit?.name ?? report.exitId ?? "unspecified"),
    replacedBy: results.at(-1) !== report ? results.length : null,
    completion:
      results.at(-1) !== report
        ? `Replaced by version ${results.length}`
        : report.completionEligibleAt
          ? "Completion confirmed"
          : "Completion held",
    version: `${version} of ${results.length}`,
  };
}

/** Collapsed previews fade out only when the result is longer than the preview. */
function useOverflowing() {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, overflowing] as const;
}

/**
 * Figma WIP/ResultCard: an accepted report collapsed to its rendered beginning, with where it went.
 * Read result opens the full result in the reader. `received` reads the card from the recipient.
 */
export function ResultCard({
  run,
  report,
  received,
  children,
  titleOnly,
}: {
  run: RunDetail;
  report: RunReport;
  /** The handoff that brought this result to the block being inspected. */
  received?: Intent;
  children?: ReactNode;
  titleOnly?: { readonly workerLink: string | null };
}) {
  const [reading, setReading] = useState(false);
  const [preview, overflowing] = useOverflowing();
  const facts = resultFacts(run, report);
  const footer = received
    ? [`From ${facts.block}`, received.state !== "acknowledged" && intentState(run, received)]
    : [facts.replacedBy && `Replaced by version ${facts.replacedBy}`, ...deliveries(run, report)];
  if (titleOnly) {
    const firstLine = report.resultMessage?.trim().split("\n", 1)[0]?.trim();
    return (
      <article
        aria-label={facts.name}
        className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5"
      >
        <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{facts.block}</span>
          <span className="text-xs text-subtle-foreground">{facts.visit}</span>
          {titleOnly.workerLink && (
            <OpenInT3 href={titleOnly.workerLink} className="ml-auto text-sm" />
          )}
        </header>
        {firstLine && (
          <p className="break-words text-sm font-medium">{firstLine.replace(/^#{1,6}\s+/, "")}</p>
        )}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto w-fit p-0 text-label"
          onClick={() => setReading(true)}
        >
          Read result
        </Button>
        {children}
        {reading && <ResultReader run={run} report={report} onClose={() => setReading(false)} />}
      </article>
    );
  }
  return (
    <article
      aria-label={facts.name}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted p-3"
    >
      <header className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-sm font-semibold text-foreground">{facts.block}</span>
        <span className="shrink-0 text-xs text-subtle-foreground">{facts.visit}</span>
        {facts.exit && (
          <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">
            → {facts.exit}
          </span>
        )}
      </header>
      {report.resultMessage && (
        <div
          ref={preview}
          data-result-preview
          className={cn(
            "max-h-16 overflow-hidden",
            overflowing && "mask-b-from-50% mask-b-to-100%",
          )}
        >
          <ResultMarkdown text={report.resultMessage} density="card" />
        </div>
      )}
      <footer className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 flex-1 text-xs text-subtle-foreground">
          {[...footer, clockTime(report.acceptedAt)].filter(Boolean).join(" · ")}
        </p>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="text-label"
          onClick={() => setReading(true)}
        >
          Read result
          <Maximize2 aria-hidden />
        </Button>
      </footer>
      {children}
      {reading && <ResultReader run={run} report={report} onClose={() => setReading(false)} />}
    </article>
  );
}

/** A reader uses the same actions for a result, Working report, or Human context. */
function RunTextReader({
  title,
  metadata,
  text,
  link,
  onClose,
  children,
  technicalDetails,
}: {
  title: string;
  metadata: string;
  text: string;
  link: string | null;
  onClose: () => void;
  children: ReactNode;
  technicalDetails?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogSurface
        {...(!metadata && { "aria-describedby": undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          body.current?.focus();
        }}
        className="flex max-h-[85dvh] w-[min(calc(100vw-32px),45rem)] flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex min-w-0 shrink-0 items-center gap-2 border-b py-3.5 pr-3 pl-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.75">
            <DialogTitle className="truncate text-title font-semibold">{title}</DialogTitle>
            {metadata && (
              <DialogDescription className="truncate text-label text-subtle-foreground">
                {metadata}
              </DialogDescription>
            )}
          </div>
          <CopyButton text={text} label="Copy Markdown" />
          {link && <OpenInT3 href={link} className="text-sm" />}
          <DialogDismiss label={title.endsWith(" · result") ? "Close result" : "Close reader"} />
        </header>
        <div
          ref={body}
          data-result-body
          tabIndex={0}
          role="region"
          aria-label={title.endsWith(" · result") ? "Result text" : "Reader text"}
          className="min-h-0 flex-1 overflow-y-auto px-7 py-5.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {children}
        </div>
        {technicalDetails && (
          <footer className="shrink-0 border-t px-5 pt-1.5 pb-2.5">
            <InspectorDisclosure label="Technical details">{technicalDetails}</InspectorDisclosure>
          </footer>
        )}
      </DialogSurface>
    </Dialog>
  );
}

function ResultReader({
  run,
  report,
  onClose,
}: {
  run: RunDetail;
  report: RunReport;
  onClose: () => void;
}) {
  const facts = resultFacts(run, report);
  const link = run.blocks.find((block) => block.blockId === report.blockId)?.link ?? null;
  const provenance = [facts.visit, facts.exit && `→ ${facts.exit}`, clockTime(report.acceptedAt)];
  return (
    <RunTextReader
      title={`${facts.block} · result`}
      metadata={provenance.filter(Boolean).join(" · ")}
      text={report.resultMessage ?? ""}
      link={link}
      onClose={onClose}
      technicalDetails={
        <div className="flex flex-col gap-1 font-mono text-2xs leading-4 break-all text-muted-foreground">
          <p>Execution: {report.executionId ?? "unresolved"}</p>
          <p>Completion: {facts.completion}</p>
          <p>Version: {facts.version}</p>
          {deliveries(run, report).map((delivery) => (
            <p key={delivery}>{delivery}</p>
          ))}
        </div>
      }
    >
      {report.resultMessage ? (
        <ResultMarkdown text={report.resultMessage} density="reader" />
      ) : (
        <p className="text-base text-muted-foreground">This result has no message.</p>
      )}
    </RunTextReader>
  );
}

export function RunTextReaderLink({
  label,
  title,
  metadata,
  text,
  link,
}: {
  label: string;
  title: string;
  metadata: string;
  text: string;
  link: string | null;
}) {
  const [reading, setReading] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        className="h-auto w-fit p-0 text-label"
        onClick={() => setReading(true)}
      >
        {label}
      </Button>
      {reading && (
        <RunTextReader
          title={title}
          metadata={metadata}
          text={text}
          link={link}
          onClose={() => setReading(false)}
        >
          <p className="break-words whitespace-pre-wrap text-foreground">{text}</p>
        </RunTextReader>
      )}
    </>
  );
}
