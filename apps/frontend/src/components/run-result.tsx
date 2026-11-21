import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { OpenInT3 } from "./open-in-t3.tsx";
import type { RunDetail } from "@t3-factory/contracts";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { isSingleOutput } from "../block-kind.ts";
import { capturedExits } from "../flow-graph.ts";
import { blockName, deliveryRecipientName } from "../run-evidence.ts";
import { clockTime } from "../time-format.ts";
import type { TechnicalDetail } from "./technical-details.tsx";
import { AgentTextPreview, AgentTextReader, type ReaderHeading } from "./agent-text.tsx";

type RunReport = RunDetail["reports"][number];

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
  if (intents.length)
    return intents.map(
      (intent) =>
        `${intentState(run, intent)} → ${deliveryRecipientName(run, intent)}${intent.problem ? ` · ${intent.problem}` : ""}`,
    );
  // A same-exit replacement after hand-off creates no handoffs of its own.
  const names = report.recipients.map((id) => blockName(run, id));
  for (const edge of run.definitions.flow.graph.connections) {
    if (
      edge.sourceBlockId === report.blockId &&
      edge.exitId === report.exitId &&
      edge.targetEndingId
    )
      names.push(
        deliveryRecipientName(run, {
          blockId: edge.targetBlockId,
          targetEndingId: edge.targetEndingId,
        }),
      );
  }
  return names.length ? [`Result updated · not handed off again to ${names.join(", ")}`] : [];
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

/** How the reader introduces a result: its Block, visit, exit and time, with the facts behind it. */
function resultHeading(run: RunDetail, report: RunReport): ReaderHeading {
  const facts = resultFacts(run, report);
  const provenance = [facts.visit, facts.exit && `→ ${facts.exit}`, clockTime(report.acceptedAt)];
  return {
    kind: "result",
    title: `${facts.block} · result`,
    provenance: provenance.filter(Boolean).join(" · "),
    t3Link: run.blocks.find((block) => block.blockId === report.blockId)?.link ?? null,
    technicalDetails: [
      ["Execution", report.executionId ?? "unresolved"],
      ["Completion", facts.completion],
      ["Version", facts.version],
      ...deliveries(run, report).map((delivery): TechnicalDetail => ["Delivery", delivery]),
    ],
  };
}

const noResultMessage = "This result has no message.";

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
  const facts = resultFacts(run, report);
  const footer = received
    ? [`From ${facts.block}`, received.state !== "acknowledged" && intentState(run, received)]
    : [facts.replacedBy && `Replaced by version ${facts.replacedBy}`, ...deliveries(run, report)];
  if (titleOnly) {
    const firstLine = report.resultMessage?.trim().split("\n", 1)[0]?.trim();
    return (
      <Surface asChild tone="raised" className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
        <article aria-label={facts.name}>
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
          <TextLink
            trailingIcon={Maximize2}
            className="w-fit p-0 text-label"
            onClick={() => setReading(true)}
          >
            Read result
          </TextLink>
          {children}
          {reading && (
            <AgentTextReader
              text={report.resultMessage ?? ""}
              heading={resultHeading(run, report)}
              empty={noResultMessage}
              onClose={() => setReading(false)}
            />
          )}
        </article>
      </Surface>
    );
  }
  return (
    <Surface asChild tone="raised" className="flex min-w-0 flex-col gap-2 p-3">
      <article aria-label={facts.name}>
        <header className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-sm font-semibold text-foreground">{facts.block}</span>
          <span className="shrink-0 text-xs text-subtle-foreground">{facts.visit}</span>
          {facts.exit && (
            <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">
              → {facts.exit}
            </span>
          )}
        </header>
        <AgentTextPreview
          text={report.resultMessage ?? ""}
          readLabel="Read result"
          heading={resultHeading(run, report)}
          empty={noResultMessage}
          footer={
            <p className="min-w-0 flex-1 text-xs text-subtle-foreground">
              {[...footer, clockTime(report.acceptedAt)].filter(Boolean).join(" · ")}
            </p>
          }
        />
        {children}
      </article>
    </Surface>
  );
}
