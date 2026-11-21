import type { AgentDefinition, FlowBlock } from "@t3-factory/contracts";
import { effectiveExits } from "@t3-factory/domain-validation";
import { BLOCK_KINDS } from "./block-kind.ts";
import type { FlowContent } from "./flow-draft.ts";
import { revisionExitLines, revisionLine, type RevisionLine } from "./revision-diff.ts";
const positionLabel = ({ x, y }: FlowBlock["position"]) => `${x}, ${y}`;
const blockName = (block: FlowBlock | undefined) => block?.name || "Unnamed Block";

function textLines(label: string, text: string): string[] {
  return [`    ${label}`, ...text.split("\n").map((line) => `      ${line}`)];
}

function blockSettings(block: FlowBlock, agent: AgentDefinition | undefined): RevisionLine[] {
  switch (block.kind) {
    case "human":
      return [];
    case "wait":
      return [
        `    Wait for  ${block.duration ? `${block.duration.amount} ${block.duration.unit}` : "No duration"}`,
      ];
    case "continuation":
      return textLines("Prompt", block.prompt);
    case "condition":
      return [
        ...block.rules.map((rule) =>
          revisionLine(
            `    ${rule.name || "(unnamed)"} · From arrival ${rule.fromArrival ?? "—"} onward`,
            rule.id,
          ),
        ),
        "    Otherwise",
      ];
    case "agent": {
      const exitNames = new Map(agent?.exits.map((exit) => [exit.id, exit.name]));
      return [
        revisionLine(
          `    Agent  ${agent?.name ?? (block.agentId ? "Unavailable Agent" : "No Agent")}`,
          block.agentId,
        ),
        `    On revisit  ${block.revisitContext === "fresh" ? "Fresh context" : "Keep context"}`,
        ...textLines("Revisit instruction", block.revisitInstruction),
        ...block.hiddenExitIds.map((id) =>
          revisionLine(`    Hidden exit  ${exitNames.get(id) ?? "Unavailable exit"}`, id),
        ),
        ...block.localExits.flatMap((exit) => revisionExitLines(exit, "    Local exit  ")),
      ];
    }
  }
}

/** The Flow revision's workspace, positioned Blocks with their settings, and every wire. */
export function comparedFlowLines(
  { name, workspace, graph }: FlowContent,
  agents: readonly AgentDefinition[],
): RevisionLine[] {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  const endings = new Map(graph.finish.endings.map((ending) => [ending.id, ending.name]));
  const byAgentId = new Map(agents.map((agent) => [agent.id, agent]));
  const agentFor = (block: FlowBlock) =>
    block.kind === "agent" && block.agentId ? byAgentId.get(block.agentId) : undefined;
  const exits = new Map(
    graph.blocks.map((block) => [
      block.id,
      new Map(effectiveExits(block, agents).map((exit) => [exit.id, exit.name])),
    ]),
  );
  return [
    `Name  ${name}`,
    revisionLine(
      `Workspace  ${workspace.mode === "checkout" ? "Project checkout" : `New worktree · ${workspace.base.kind === "default" ? "default branch" : workspace.base.ref}`}`,
      workspace,
    ),
    "",
    "Blocks",
    `  Flow input · Position ${positionLabel(graph.flowInput.position)}`,
    ...graph.blocks.flatMap((block) => [
      revisionLine(`  ${blockName(block)} · ${BLOCK_KINDS[block.kind].name}`, block.id),
      `    Position  ${positionLabel(block.position)}`,
      ...blockSettings(block, agentFor(block)),
    ]),
    "  Finish",
    `    Position  ${positionLabel(graph.finish.position)}`,
    ...graph.finish.endings.flatMap((ending) => [
      revisionLine(`    Ending  ${ending.name || "Unnamed ending"}`, ending.id),
      ...textLines("Description", ending.description),
      `    Output  ${ending.output}`,
      ...textLines("Output description", ending.outputDescription),
    ]),
    "",
    "Connections",
    ...graph.flowInput.targetBlockIds.map((id) =>
      revisionLine(`  Flow input → ${blockName(blocks.get(id))}`, id),
    ),
    ...graph.connections.map((wire) => {
      const source = blocks.get(wire.sourceBlockId);
      const exit = exits.get(wire.sourceBlockId)?.get(wire.exitId);
      const output =
        exit ||
        (source?.kind === "wait" || source?.kind === "continuation"
          ? "Output"
          : "Unavailable exit");
      const target =
        wire.targetEndingId !== undefined
          ? `Finish · ${endings.get(wire.targetEndingId) || "Unnamed ending"}`
          : blockName(blocks.get(wire.targetBlockId));
      return revisionLine(`  ${blockName(source)} · ${output} → ${target}`, wire);
    }),
  ];
}
