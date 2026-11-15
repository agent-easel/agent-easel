import { Bot, CornerDownLeft, Hourglass, User } from "lucide-react";
import type { AgentDefinition, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { continuedThread } from "./flow-graph.ts";
import { waitDurationText } from "./wait-display.ts";

/** Each block kind's icon and the kind label its header shows. */
export const BLOCK_KINDS: Record<
  FlowBlock["kind"],
  { readonly Icon: typeof Bot; readonly label: string; readonly name: string }
> = {
  agent: { Icon: Bot, label: "AGENT", name: "Agent" },
  human: { Icon: User, label: "HUMAN STEP", name: "Human step" },
  wait: { Icon: Hourglass, label: "WAIT", name: "Wait" },
  continuation: { Icon: CornerDownLeft, label: "CONTINUATION", name: "Continuation" },
};

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

/**
 * What a block runs, in each screen's wording. Screens word it differently by design, so each
 * form is spelled out per kind here rather than derived from another.
 */
export interface BlockReference {
  /** The Flow authoring canvas and its drag preview: a muted label, then the value. */
  readonly card: { readonly label: string; readonly value: string; readonly tone: ReferenceTone };
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
    case "continuation": {
      const thread = continuedThread(graph, block.id);
      return thread
        ? {
            card: { label: "continues", value: thread, tone: "continued" },
            line: { text: `continues ${thread}`, tone: "continued" },
            header: `${kind} · continues ${thread}`,
          }
        : {
            card: { label: "", value: "no Agent before it", tone: "absent" },
            line: { text: "no Agent before it", tone: "absent" },
            header: `${kind} · no Agent before it`,
          };
    }
  }
}
