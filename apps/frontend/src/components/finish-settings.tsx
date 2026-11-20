import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type EndingOutput,
  type FlowEnding,
  type FlowGraph,
} from "@t3-factory/contracts";
import { exitsWithEndings } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fieldAria } from "./field-state.ts";
import { exitDisplayName } from "./flow-block.tsx";
import { fieldProblem, type BlockIssue } from "./flow-readiness.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { ScrollPane } from "./screen-layout.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { StatusBadge } from "./status-badge.tsx";

/** The most endings a Finish block holds, as for Agent exits. */
const ENDING_LIMIT = 100;

const OUTPUTS = [
  ["none", "None"],
  ["optional", "Optional"],
  ["required", "Required"],
] as const satisfies readonly (readonly [EndingOutput, string])[];

/** One wire into an ending, as its Incoming row names it. */
type IncomingWire = {
  readonly key: string;
  readonly label: string;
  readonly messageRequired: boolean;
};

/**
 * Every ending's incoming wires, in connection order: "<block> → <exit>", and whether that exit
 * must carry a message in this Flow (its own setting or a Required ending it leads to).
 */
function incomingWires(graph: FlowGraph, agents: readonly AgentDefinition[]) {
  const byEnding = new Map<string, IncomingWire[]>();
  const exits = new Map(
    graph.blocks.map((block) => [
      block.id,
      { block, exits: exitsWithEndings(block, graph, agents) },
    ]),
  );
  graph.connections.forEach((connection, index) => {
    if (connection.targetBlockId !== FINISH_BLOCK_ID || !connection.targetEndingId) return;
    const source = exits.get(connection.sourceBlockId);
    const exit = source?.exits.find((item) => item.id === connection.exitId);
    const exitName = exit
      ? exitDisplayName(exit, source?.block.kind === "wait" ? "after the wait" : "response")
      : connection.exitId;
    const list = byEnding.get(connection.targetEndingId) ?? [];
    list.push({
      key: String(index),
      label: `${source?.block.name || "Unnamed block"} → ${exitName}`,
      messageRequired: exit?.messageRequired ?? false,
    });
    byEnding.set(connection.targetEndingId, list);
  });
  return (endingId: string): readonly IncomingWire[] => byEnding.get(endingId) ?? [];
}

/**
 * Moves focus to an ending's name once its card is rendered, scrolling it into view: after a
 * readiness issue about it is selected, or after **Add ending** added it. A new request object
 * asks again.
 */
function useEndingFocus(list: HTMLElement | null, requested: { endingId: string } | null) {
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (requested) pending.current = requested.endingId;
  }, [requested]);
  useLayoutEffect(() => {
    const endingId = pending.current;
    if (!endingId || !list) return;
    const card = list.querySelector<HTMLElement>(`[data-ending-id="${CSS.escape(endingId)}"]`);
    if (!card) return;
    pending.current = null;
    card.scrollIntoView({ block: "nearest" });
    card.querySelector<HTMLElement>("[data-ending-field=name]")?.focus({ preventScroll: true });
  });
  return (endingId: string) => {
    pending.current = endingId;
  };
}

/**
 * The Finish block's settings: its endings as stacked cards, in order, with **Add ending**, and
 * the note that reaching an ending ends the Run.
 */
export function FinishSettings({
  graph,
  agents,
  issues,
  focus,
  onAdd,
  onEdit,
  onRemove,
}: {
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  /** The Finish block's readiness issues by the field within it, such as `endings.1.name`. */
  issues: readonly BlockIssue[];
  /** Selecting a readiness issue asks to show and focus its ending; a new object asks again. */
  focus: { endingId: string } | null;
  /** Adds an ending and answers its id. */
  onAdd: () => string;
  onEdit: (ending: FlowEnding) => void;
  onRemove: (endingId: string) => void;
}) {
  const headingId = useId();
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const focusEnding = useEndingFocus(list, focus);
  const { endings } = graph.finish;
  const incoming = incomingWires(graph, agents);
  const full = endings.length >= ENDING_LIMIT;
  return (
    <ScrollPane className="p-4" fade="from-card">
      <div ref={setList} className="flex flex-col gap-3.5">
        <section aria-labelledby={headingId} className="grid gap-1.5">
          <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
            Endings
          </h3>
          <p className="text-label text-muted-foreground">
            Every Flow has one Finish block. Each ending is an input on its left edge: wire the
            exits that mean this ending into it.
          </p>
        </section>
        {endings.length === 0 && (
          <EmptyState
            size="compact"
            title="No endings yet"
            body="Without endings, the Run ends as it does today, when its branches stop. Add an ending to give the Run a result."
          />
        )}
        {endings.map((ending, index) => (
          <EndingCard
            key={ending.id}
            ending={ending}
            incoming={incoming(ending.id)}
            issues={issues}
            index={index}
            onEdit={onEdit}
            onRemove={() => onRemove(ending.id)}
          />
        ))}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={full}
            aria-describedby={full ? `${headingId}-full` : undefined}
            onClick={() => focusEnding(onAdd())}
          >
            <Plus aria-hidden /> Add ending
          </Button>
          {full && (
            <span id={`${headingId}-full`} className="text-xs text-muted-foreground">
              Up to {ENDING_LIMIT} endings
            </span>
          )}
        </div>
        <ProblemCard
          tone="info"
          density="compact"
          className="shrink-0"
          title="Reaching an ending ends the Run"
        >
          The first ending reached sets the Run’s Result. Other running branches stop at once,
          without asking; their edits in the workspace stay.
        </ProblemCard>
      </div>
    </ScrollPane>
  );
}

/** One labelled row of an ending card: a 72 px label beside its control. */
function EndingRow({
  label,
  htmlFor,
  labelId,
  top = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  /** The label aligns with the first line of a multi-line value. */
  top?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 gap-2", top ? "items-start" : "items-center")}>
      <label
        id={labelId}
        htmlFor={htmlFor}
        className="w-18 shrink-0 text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const endingInputClass = "h-7.5 bg-card text-label";

function EndingCard({
  ending,
  incoming,
  issues,
  index,
  onEdit,
  onRemove,
}: {
  ending: FlowEnding;
  incoming: readonly IncomingWire[];
  issues: readonly BlockIssue[];
  index: number;
  onEdit: (ending: FlowEnding) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const name = ending.name || "Unnamed ending";
  const nameProblem = fieldProblem(issues, `endings.${index}.name`);
  const unconnected = incoming.length === 0;
  return (
    <section
      aria-label={`Ending ${name}`}
      data-ending-id={ending.id}
      className="grid min-w-0 shrink-0 gap-1.5 rounded-lg border p-2.5"
    >
      <EndingRow label="Name" htmlFor={`${id}-name`}>
        <Input
          id={`${id}-name`}
          data-ending-field="name"
          className={endingInputClass}
          value={ending.name}
          maxLength={200}
          {...fieldAria(nameProblem && `${id}-name-problem`)}
          onChange={(event) => onEdit({ ...ending, name: event.target.value })}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ending ${name}`}
              onClick={onRemove}
            >
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove ending</TooltipContent>
        </Tooltip>
      </EndingRow>
      {nameProblem && (
        <p id={`${id}-name-problem`} role="alert" className="pl-20 text-xs text-destructive">
          {nameProblem.message}
        </p>
      )}
      <EndingRow label="Description" htmlFor={`${id}-description`}>
        <Input
          id={`${id}-description`}
          className={endingInputClass}
          value={ending.description}
          maxLength={4000}
          onChange={(event) => onEdit({ ...ending, description: event.target.value })}
        />
      </EndingRow>
      <EndingRow label="Output" labelId={`${id}-output`}>
        <SegmentedChoice
          labelledBy={`${id}-output`}
          fill
          value={ending.output}
          options={OUTPUTS}
          onChange={(output) => onEdit({ ...ending, output })}
        />
      </EndingRow>
      {ending.output !== "none" && (
        <EndingRow label="Output desc." htmlFor={`${id}-output-description`}>
          <Input
            id={`${id}-output-description`}
            aria-label="Output description"
            className={endingInputClass}
            value={ending.outputDescription}
            maxLength={4000}
            onChange={(event) => onEdit({ ...ending, outputDescription: event.target.value })}
          />
        </EndingRow>
      )}
      <EndingRow label="Incoming" labelId={`${id}-incoming`} top>
        <div aria-labelledby={`${id}-incoming`} role="group" className="grid min-w-0 flex-1 gap-1">
          {unconnected ? (
            <>
              <StatusBadge kind="error" aria-describedby={`${id}-incoming-problem`}>
                Not connected
              </StatusBadge>
              <p
                id={`${id}-incoming-problem`}
                role="alert"
                className="text-sm text-muted-foreground"
              >
                No exit leads to this ending yet.
              </p>
            </>
          ) : (
            incoming.map((wire) => (
              <p key={wire.key} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                <span className="break-words">{wire.label}</span>
                {wire.messageRequired && <StatusBadge kind="neutral">Message required</StatusBadge>}
              </p>
            ))
          )}
        </div>
      </EndingRow>
    </section>
  );
}
