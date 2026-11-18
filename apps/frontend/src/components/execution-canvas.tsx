import type { ReactNode } from "react";
import type { FlowBlock, FlowGraph, RunBlock, RunDetail } from "@t3-factory/contracts";
import type { EffectiveExit } from "@t3-factory/domain-validation";
import { CircleHelp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { selectExecutionTargets } from "../execution-focus.ts";
import { BLOCK_KINDS, blockReference, type ReferenceTone } from "../block-kind.ts";
import { capturedExits, exitRecipients, type CanvasBlock } from "../flow-graph.ts";
import { blockAttention, blockStateKind, chosenExitIds } from "../run-block-state.ts";
import { EXECUTION_DIMENSIONS } from "./canvas-dimensions.ts";
import {
  CanvasSurface,
  type CanvasBlockContent,
  type CanvasFlowInputContent,
  type CanvasPort,
} from "./canvas-surface.tsx";
import { conditionRoute, exitDisplayName } from "./flow-block.tsx";
import { pendingArrivals } from "../wait-display.ts";
import { conditionActivityText } from "../condition-arrivals.ts";
import { FlowInputPrompt, runPromptText } from "./run-prompt.tsx";
import { RUN_STATE_LABELS, StatusBadge, type RunStateKind } from "./status-badge.tsx";
import { ContinueNow } from "./wait-arrivals.tsx";
import { FlowInputTitleLine } from "./run-title-generation.tsx";
import { clockTime, dayAndTime, executionStateLabel } from "./execution-state.tsx";

/** Not-started blocks were never observed. Stale and unknown apply only after a block starts. */
function blockObservation(block: RunBlock, unavailable: boolean) {
  if (block.state === "not-started") return "unvisited" as const;
  if (unavailable || block.freshness === "stale") return "stale" as const;
  if (block.freshness === "unknown") return "unknown" as const;
  return "live" as const;
}

/** The Execution canvas colour of each reference tone. */
const REFERENCE_TONES: Record<ReferenceTone, string> = {
  plain: "text-subtle-foreground",
  continued: "text-brand-cyan",
  absent: "text-subtle-foreground",
};

/** The Continuation's prompt visit: the one message that sent its prompt in this Run. */
export function continuationPromptVisit(run: RunDetail, blockId: string) {
  return run.continuationVisits.find(
    (visit) => visit.blockId === blockId && visit.kind === "prompt",
  );
}

/** The block whose worker thread a visit's message belongs to, by its thread binding. */
export function threadOwnerName(run: RunDetail, bindingId: string | null) {
  const owner = run.threadBindings.find((binding) => binding.id === bindingId)?.blockId;
  if (!owner) return null;
  return run.definitions.flow.graph.blocks.find((block) => block.id === owner)?.name || owner;
}

/** Figma Run/ExecBlock frames: active states use a 75 % state line, settled ones a quieter one. */
const frameColor: Record<RunStateKind | "not-started", string> = {
  "not-started": "border-border bg-muted",
  working: "border-status-working/75 bg-card",
  waiting: "border-status-waiting/75 bg-card",
  "needs-input": "border-attention/75 bg-card",
  finished: "border-success/50 bg-card",
  problem: "border-destructive/75 bg-card",
  stopped: "border-status-stopped/50 bg-card",
};

type BlockVisit = {
  readonly id: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly status: string;
};

/** Recorded visits: Block worker activations, Human occurrences, Wait arrivals or messages reaching a
 * Continuation. */
export function blockVisits(run: RunDetail, block: FlowBlock): readonly BlockVisit[] {
  if (block.kind === "wait")
    return run.waitArrivals
      .filter((arrival) => arrival.blockId === block.id)
      .map((arrival) => ({
        id: arrival.id,
        start: arrival.startedAt,
        end: arrival.settledAt,
        status: arrival.state,
      }));
  if (block.kind === "continuation") {
    return run.continuationVisits
      .filter((visit) => visit.blockId === block.id)
      .map((visit) => ({
        id: visit.id,
        start: visit.arrivedAt,
        end: visit.forwardedAt,
        status: visit.state,
      }));
  }
  if (block.kind === "human") {
    return run.humanOccurrences
      .filter((occurrence) => occurrence.blockId === block.id)
      .map((occurrence) => ({
        id: occurrence.id,
        start: occurrence.appearedAt,
        end: occurrence.settledAt,
        status: occurrence.state,
      }));
  }
  return run.activations
    .filter((activation) => activation.blockId === block.id)
    .map((activation) => ({
      id: activation.id,
      start: activation.createdAt,
      end:
        run.reports.findLast((report) => report.activationId === activation.id)
          ?.completionEligibleAt ?? null,
      status: activation.phase,
    }));
}

/** A waiting Wait shows when it next continues: the nearest deadline, and how many arrivals wait. */
export function waitingText(run: RunDetail, blockId: string) {
  const pending = pendingArrivals(run, blockId);
  const next = pending[0];
  if (!next) return null;
  const until = `until ${dayAndTime(next.deadlineAt)}`;
  return pending.length > 1 ? `${pending.length} held · next ${until}` : until;
}

/** A Continuation's activity: whose thread works on its prompt, then where it passed the response. */
function continuationActivity(run: RunDetail, blockId: string, state: RunBlock["state"]) {
  const prompt = continuationPromptVisit(run, blockId);
  if (!prompt) return null;
  if (state === "sent") {
    const owner = threadOwnerName(run, prompt.bindingId);
    return `In ${owner ? `${owner}’s` : "its worker’s"} thread · since ${clockTime(prompt.arrivedAt)}`;
  }
  if (state !== "pass-through" || !prompt.forwardedAt) return null;
  const recipients = exitRecipients(run.definitions.flow.graph, blockId, "output").filter(Boolean);
  return `Passed on${recipients.length ? ` to ${recipients.join(", ")}` : ""} · ${clockTime(prompt.forwardedAt)}`;
}

/** A finished Block's taken exit as its outcome, with the time it was accepted. */
function outcomeText(run: RunDetail, block: FlowBlock) {
  const [exitId] = chosenExitIds(
    run,
    block,
    run.blocks.find((item) => item.blockId === block.id),
  );
  const exit = capturedExits(run.definitions, block.id).find((item) => item.id === exitId);
  const at =
    block.kind === "human"
      ? run.humanOccurrences.findLast((item) => item.blockId === block.id)?.settledAt
      : run.reports.findLast((item) => item.blockId === block.id && item.status === "finished")
          ?.acceptedAt;
  if (!exit || !exitDisplayName(exit) || !at) return null;
  return `→ ${exitDisplayName(exit)} · ${clockTime(at)}`;
}

/** Recorded visit times for the activity line; no progress is inferred. A Condition shows its
 * routing summary instead, a finished Block the exit it took. */
export function blockActivityText(
  run: RunDetail,
  block: FlowBlock,
  recorded: RunBlock | undefined,
) {
  if (block.kind === "condition") return conditionActivityText(run, block.id);
  const visits = blockVisits(run, block);
  const latest = visits[visits.length - 1];
  if (!recorded || recorded.state === "not-started" || !latest) return "Not visited";
  const continuation =
    block.kind === "continuation" && continuationActivity(run, block.id, recorded.state);
  if (continuation) return continuation;
  const start = latest.start ?? recorded.observedAt;
  const end = latest.end;
  const active = recorded.state === "working" || recorded.state === "waiting";
  const outcome = recorded.state === "finished" && outcomeText(run, block);
  if (outcome) return outcome;
  if (active || !end) return `Visit ${visits.length}${start ? ` · since ${clockTime(start)}` : ""}`;
  return `Visit ${visits.length}${start ? ` · ${clockTime(start)}–${clockTime(end)}` : ""}`;
}

/** One exit row: a Condition output's rule, the exit's name (primary text only once chosen)
 * and, for screen readers, its recipients. */
function ExecutionExit({
  graph,
  block,
  exit,
  chosen,
}: {
  graph: FlowGraph;
  block: CanvasBlock;
  exit: EffectiveExit;
  chosen: boolean;
}) {
  const recipients = exitRecipients(graph, block.id, exit.id).join(", ");
  return (
    <>
      {exit.source === "condition" && (
        <span className="truncate text-2xs tracking-label text-subtle-foreground">
          {conditionRoute(block, exit.id)}
        </span>
      )}
      <span className="flex-1" />
      <span
        className={cn(
          "truncate text-xs font-medium",
          chosen ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {exit.source === "continuation" ? "Response" : exitDisplayName(exit)}
      </span>
      <span className="sr-only">
        {chosen ? "chosen" : "not chosen"} · configured → {recipients || "finish here"}
      </span>
    </>
  );
}

function problemFooterText(kind: FlowBlock["kind"]) {
  return kind === "condition" ? "Settle or Archive the Run" : "Open in T3 to investigate";
}

type BlockObservation = ReturnType<typeof blockObservation>;

/** The kind label, and the Block's state badge at the top right, where it never truncates the
 * Block name. */
function ExecutionBlockHeader({
  kind,
  state,
}: {
  kind: FlowBlock["kind"];
  state: RunStateKind | null;
}) {
  const { Icon: KindIcon, executionLabel } = BLOCK_KINDS[kind];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 pt-1.5 pr-2 pl-3">
      <KindIcon
        aria-hidden
        className={cn("size-3", state === null ? "text-subtle-foreground" : "text-link")}
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate text-2xs leading-3 font-semibold tracking-section text-subtle-foreground">
        {executionLabel}
      </span>
      {state && <StatusBadge kind={state} />}
    </span>
  );
}

function activityLine(
  run: RunDetail,
  block: FlowBlock,
  recorded: RunBlock | undefined,
  observation: BlockObservation,
) {
  const state = recorded?.state ?? "not-started";
  if (observation === "stale" && recorded?.observedAt) {
    return {
      text: `last seen ${executionStateLabel(state)} · ${clockTime(recorded.observedAt)}`,
      color: "text-status-working",
    };
  }
  const kind = blockStateKind(run, recorded);
  const color =
    kind === "working"
      ? "text-status-working"
      : kind === "problem"
        ? "text-destructive"
        : kind === null
          ? "text-muted-foreground"
          : "text-foreground";
  if (state === "working" && recorded?.workingMessage)
    return { text: recorded.workingMessage, color };
  const waiting = state === "waiting" && block.kind === "wait" && waitingText(run, block.id);
  if (waiting) return { text: waiting, color };
  return { text: blockActivityText(run, block, recorded), color };
}

function ExecutionBlockTitle({
  run,
  block,
  recorded,
  observation,
}: {
  run: RunDetail;
  block: FlowBlock;
  recorded: RunBlock | undefined;
  observation: BlockObservation;
}) {
  const state = recorded?.state ?? "not-started";
  const activity = activityLine(run, block, recorded, observation);
  const reference = blockReference(block, {
    graph: run.definitions.flow.graph,
    agents: run.definitions.agents,
  }).line;
  return (
    <span className="flex flex-1 flex-col gap-0.75 pt-1 pr-2.5 pb-2 pl-3">
      <span className="flex h-5 min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "flex-1 truncate text-sm leading-4 font-semibold",
            state === "not-started" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {block.name || "Unnamed block"}
        </span>
      </span>
      <span
        className={cn(
          "truncate text-2xs leading-3 tracking-label",
          REFERENCE_TONES[reference.tone],
        )}
      >
        {reference.text}
      </span>
      <span
        className={cn("truncate text-2xs leading-3 font-medium", activity.color)}
        title={activity.text}
      >
        {activity.text}
      </span>
    </span>
  );
}

/** A block draws at most an attention footer (a Wait: its Continue now footer instead) and an
 * observation footer. */
const MAX_FOOTERS = 2;

const footerClass =
  "flex min-w-0 flex-1 items-center gap-1.5 rounded-b-lg border-t px-2.5 py-1.5 text-2xs tracking-label";

/** A Wait with exactly one pending arrival offers Continue now for it on the block while the
 * Run's gate is open. */
function continuableArrival(run: RunDetail, block: FlowBlock) {
  if (block.kind !== "wait" || !run.gateOpen) return undefined;
  const [only, ...others] = pendingArrivals(run, block.id);
  return others.length ? undefined : only;
}

/** Independent footers: attention chips and observation strips never encode the state. */
function executionFooters(
  run: RunDetail,
  block: FlowBlock,
  recorded: RunBlock | undefined,
  observation: BlockObservation,
) {
  const attention = blockAttention(run, recorded);
  const footers: ReactNode[] = [];
  const continuable = continuableArrival(run, block);
  if (continuable)
    footers.push(
      <span className={cn(footerClass, "bg-muted [&>p]:truncate")}>
        <ContinueNow arrival={continuable} label={`Continue ${block.name || "Wait"} now`} />
      </span>,
    );
  // Needs input shows in the Block's badge; a Problem keeps its own footer.
  if (attention.problem)
    footers.push(
      <span className={cn(footerClass, "bg-muted")}>
        <StatusBadge kind="problem" />
        <span className="truncate text-muted-foreground">{problemFooterText(block.kind)}</span>
      </span>,
    );
  if (observation === "stale")
    footers.push(
      <span className={cn(footerClass, "bg-attention/8 text-attention")}>
        <Clock aria-hidden className="size-2.75" />
        Last known
        {recorded?.observedAt ? ` · observed ${clockTime(recorded.observedAt)}` : ""}
      </span>,
    );
  if (observation === "unknown")
    footers.push(
      <span className={cn(footerClass, "bg-muted text-muted-foreground")}>
        <CircleHelp aria-hidden className="size-2.75" /> Unknown observation
      </span>,
    );
  return footers;
}

const pressClass =
  "flex w-full flex-col rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Ports only mark where wires meet the block. */
const port: CanvasPort = { className: "border-[1.5px] border-subtle-foreground bg-background" };

/** Without blocks, fit frames a canvas-sized area from the Flow input instead of the input alone. */
const EMPTY_GRAPH_SIZE = { width: 640, height: 420 };

/** How the Run title line on the Flow input is inspected. */
type TitleInspection = { readonly inspected: boolean; readonly onInspect: () => void };

/**
 * Read-only Flow input: the Run prompt with no execution state; pressing it clears the selection.
 * A Run whose title generation was launched or skipped carries its title line, which describes the
 * Run's title rather than Flow input work.
 */
function executionFlowInput(
  run: RunDetail,
  onClearSelection: () => void,
  title: TitleInspection,
): CanvasFlowInputContent {
  const images = run.images.length > 0;
  const prompt = images ? runPromptText(run) : run.input.trim();
  const generation = run.titleGeneration;
  return {
    className: cn(title.inspected && "ring-1 ring-brand-soft-border"),
    press: (rows) => (
      <button
        type="button"
        className={pressClass}
        aria-label={`Flow input, prompt: ${prompt}`}
        onClick={onClearSelection}
      >
        {rows}
      </button>
    ),
    // Reference chips and thumbnails are controls, so they sit outside the press target.
    prompt: images
      ? { kind: "images", content: <FlowInputPrompt run={run} /> }
      : !prompt
        ? { kind: "none" }
        : {
            kind: "line",
            content: (
              <p className="truncate px-3 text-xs text-foreground" title={run.input}>
                {prompt}
              </p>
            ),
          },
    ...(generation && {
      status: (
        <FlowInputTitleLine
          generation={generation}
          inspected={title.inspected}
          onInspect={title.onInspect}
        />
      ),
    }),
    port,
  };
}

function executionBlock(
  run: RunDetail,
  block: CanvasBlock,
  selected: boolean,
  unavailable: boolean,
  onSelect: () => void,
): CanvasBlockContent {
  const recorded = run.blocks.find((item) => item.blockId === block.id);
  const state = blockStateKind(run, recorded);
  const workingMessage = recorded?.state === "working" ? recorded.workingMessage : null;
  const observation = recorded ? blockObservation(recorded, unavailable) : "unvisited";
  const chosen = chosenExitIds(run, block, recorded);
  return {
    className: cn(
      frameColor[state ?? "not-started"],
      selected && "border-primary ring-1 ring-primary",
    ),
    press: {
      // Continue now is its own control, so it sits outside the press target.
      covers: continuableArrival(run, block) ? "identity" : "block",
      render: (rows) => (
        <button
          type="button"
          className={pressClass}
          aria-label={`${BLOCK_KINDS[block.kind].name} ${block.name || "Unnamed block"}, ${state ? RUN_STATE_LABELS[state] : "Not started"}${workingMessage ? ` · ${workingMessage}` : ""}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {rows}
        </button>
      ),
    },
    header: <ExecutionBlockHeader kind={block.kind} state={state} />,
    title: (
      <ExecutionBlockTitle run={run} block={block} recorded={recorded} observation={observation} />
    ),
    exit: (exit) => (
      <ExecutionExit
        graph={run.definitions.flow.graph}
        block={block}
        exit={exit}
        chosen={chosen.has(exit.id)}
      />
    ),
    exitPort: () => port,
    incomingPort: () => port,
    footers: executionFooters(run, block, recorded, observation),
  };
}

/** Space the top-left badges cover above the graph. */
const BADGES_HEIGHT = 64;

/**
 * Read-only canvas of a captured Flow revision. The viewport is local UI state: live updates
 * replace block facts in place and move the view only while it follows the active Blocks.
 */
export function ExecutionCanvas({
  run,
  selected,
  observationUnavailable,
  shown,
  onSelect,
  title,
  overlay,
}: {
  run: RunDetail;
  selected: string | null;
  observationUnavailable: boolean;
  shown: boolean;
  onSelect: (blockId: string | null) => void;
  /** The Run title line; inspecting it selects no Block and leaves following unchanged. */
  title: TitleInspection;
  /** Top-left badges and notices (Figma "Overlay · top-left"); they never block panning. */
  overlay?: ReactNode;
}) {
  return (
    <CanvasSurface
      label="Execution canvas"
      scope={run.id}
      graph={run.definitions.flow.graph}
      agents={run.definitions.agents}
      dimensions={EXECUTION_DIMENSIONS}
      reservedFooters={MAX_FOOTERS}
      flowInput={executionFlowInput(run, () => onSelect(null), title)}
      block={(block) =>
        executionBlock(run, block, selected === block.id, observationUnavailable, () =>
          onSelect(block.id),
        )
      }
      wires={{ kind: "orthogonal", label: "Configured connections" }}
      resize="preserve"
      covered={{ top: BADGES_HEIGHT, right: 0 }}
      emptyGraphSize={EMPTY_GRAPH_SIZE}
      focusTargets={selectExecutionTargets(run)}
      shown={shown}
      onTap={() => onSelect(null)}
      overlay={overlay}
      controls={{ kind: "icons" }}
    />
  );
}
