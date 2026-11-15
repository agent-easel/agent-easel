import { Bot, CornerDownLeft, Hourglass, User } from "lucide-react";
import type { AgentDefinition, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import type { EffectiveExit, ExitSource } from "@t3-factory/domain-validation";
import { continuedThread } from "./flow-graph.ts";
import { waitDurationText } from "./wait-display.ts";

/**
 * What screens show and observe of one block kind. Each answer is spelled out per kind, not
 * derived from another, so a screen's current reading of a kind stays exactly as it is.
 */
interface BlockKind {
  readonly Icon: typeof Bot;
  /** The kind label on the Flow authoring canvas header. */
  readonly label: string;
  /** The kind label on the Execution canvas header. */
  readonly executionLabel: string;
  /** The kind badge on the Flow editor's block panel. */
  readonly panelLabel: string;
  readonly name: string;
  /** It runs in a worker thread of its own. Only an Agent block does; Human steps, Waits and
   * Continuations work with the worker of the message that reaches them. */
  readonly workerThread: boolean;
  /** Its frame is dashed on the Flow authoring canvas and the block library's drag preview. */
  readonly dashedFrame: boolean;
  /** Its only output has no name: exit rows, connect ports and results show none. */
  readonly singleOutput: boolean;
  /** How Run detail observes it. */
  readonly observed: {
    /** Technical details list its T3 thread and exact execution. */
    readonly references: boolean;
    /** Technical details list its observation freshness. */
    readonly freshness: boolean;
    /** The footer while there is no thread to open. */
    readonly noThread: string;
  };
}

export const BLOCK_KINDS: Record<FlowBlock["kind"], BlockKind> = {
  agent: {
    Icon: Bot,
    label: "AGENT",
    executionLabel: "AGENT",
    panelLabel: "AGENT BLOCK",
    name: "Agent",
    workerThread: true,
    dashedFrame: false,
    singleOutput: false,
    observed: { references: true, freshness: true, noThread: "No T3 thread yet" },
  },
  human: {
    Icon: User,
    label: "HUMAN STEP",
    executionLabel: "HUMAN",
    panelLabel: "HUMAN STEP",
    name: "Human step",
    workerThread: false,
    dashedFrame: true,
    singleOutput: false,
    observed: { references: true, freshness: true, noThread: "No T3 thread yet" },
  },
  wait: {
    Icon: Hourglass,
    label: "WAIT",
    executionLabel: "WAIT",
    panelLabel: "WAIT",
    name: "Wait",
    workerThread: false,
    dashedFrame: false,
    singleOutput: true,
    observed: { references: false, freshness: true, noThread: "A Wait has no T3 thread" },
  },
  continuation: {
    Icon: CornerDownLeft,
    label: "CONTINUATION",
    executionLabel: "CONTINUATION",
    panelLabel: "CONTINUATION BLOCK",
    name: "Continuation",
    workerThread: false,
    dashedFrame: false,
    singleOutput: true,
    observed: { references: true, freshness: false, noThread: "No T3 thread yet" },
  },
};

/** The kind of block each exit source belongs to: Agent and Flow-local exits leave Agent blocks. */
const EXIT_SOURCE_KINDS: Record<ExitSource, FlowBlock["kind"]> = {
  agent: "agent",
  local: "agent",
  human: "human",
  wait: "wait",
  continuation: "continuation",
};

/** Whether `exit` is its block's single unnamed output. */
export function isSingleOutput(exit: Pick<EffectiveExit, "source">) {
  return BLOCK_KINDS[EXIT_SOURCE_KINDS[exit.source]].singleOutput;
}

type NamedAgent = Pick<AgentDefinition, "id" | "name">;

/** The Agent an Agent block runs, by name: "not chosen" without one, "Unavailable Agent" when
 * the chosen Agent is no longer among `agents`. */
function agentName(agentId: string | null, agents: readonly NamedAgent[]) {
  if (!agentId) return "not chosen";
  return agents.find((agent) => agent.id === agentId)?.name ?? "Unavailable Agent";
}

/** How a reference reads: plainly, as a continued thread, or as something missing. Each screen
 * maps a tone to its own colour. */
export type ReferenceTone = "plain" | "continued" | "absent";

/** A muted label, then the value. */
interface ReferenceCard {
  readonly label: string;
  readonly value: string;
  readonly tone: ReferenceTone;
}

/**
 * What a block runs, in each screen's wording. Screens word it differently by design, so each
 * form is spelled out per kind here rather than derived from another.
 */
export interface BlockReference {
  /** The Flow authoring canvas and its drag preview. */
  readonly card: ReferenceCard;
  /** The Execution canvas line under the block's name. */
  readonly line: { readonly text: string; readonly tone: ReferenceTone };
  /** Run detail's header line under the block's name. */
  readonly header: string;
}

export function blockReference(
  block: FlowBlock,
  { graph, agents }: { graph: FlowGraph; agents: readonly NamedAgent[] },
): BlockReference {
  const kind = BLOCK_KINDS[block.kind].name;
  switch (block.kind) {
    case "agent": {
      const agent = agentName(block.agentId, agents);
      return {
        card: { label: "Agent", value: agent, tone: "plain" },
        line: { text: `${kind} · ${agent}`, tone: "plain" },
        // Run detail names the Agent only where the block's name does not already say it.
        header: agent === block.name ? kind : `${kind} · ${agent}`,
      };
    }
    case "human":
      return {
        card: { label: "Asks", value: "a person", tone: "plain" },
        line: { text: `${kind} · asks you`, tone: "plain" },
        header: kind,
      };
    case "wait": {
      const duration = waitDurationText(block.duration);
      return {
        card: { label: "Waits", value: duration, tone: "plain" },
        line: { text: `${kind} · waits ${duration}`, tone: "plain" },
        header: `${kind} · ${duration}`,
      };
    }
    case "continuation":
      return continuationReference(block, graph);
  }
}

/** A Continuation's reference, with the sentence-case form its block inspector shows as well. */
export function continuationReference(
  block: Extract<FlowBlock, { kind: "continuation" }>,
  graph: FlowGraph,
): BlockReference & { readonly inspector: ReferenceCard } {
  const kind = BLOCK_KINDS.continuation.name;
  const thread = continuedThread(graph, block.id);
  return thread
    ? {
        card: { label: "continues", value: thread, tone: "continued" },
        line: { text: `continues ${thread}`, tone: "continued" },
        header: `${kind} · continues ${thread}`,
        inspector: { label: "Continues", value: thread, tone: "continued" },
      }
    : {
        card: { label: "", value: "no Agent before it", tone: "absent" },
        line: { text: "no Agent before it", tone: "absent" },
        header: `${kind} · no Agent before it`,
        inspector: { label: "", value: "No Agent before it", tone: "absent" },
      };
}
