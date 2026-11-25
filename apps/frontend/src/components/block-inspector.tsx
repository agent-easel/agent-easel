import { useId, useState, type ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentRevisitContext,
  FlowBlock,
  FlowDraft,
  FlowGraph,
  ValidationIssue,
  WaitUnit,
} from "@agent-easel/contracts";
import { effectiveExits, joinSlots } from "@agent-easel/domain-validation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/text-link";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { FlowAgentLink } from "../components/app-link.tsx";
import { continuationReference } from "../block-kind.ts";
import { exitDisplayName } from "../connection-label.ts";
import { ChoiceMenu, type MenuChoice } from "./choice-menu.tsx";
import { BlockExitConfiguration, PanelHeading } from "./block-exit-configuration.tsx";
import { ConditionOutputs, type ConditionEditing } from "./condition-rules.tsx";
import { SubflowBlockSettings, type BlockFlows } from "./subflow-inspector.tsx";
import { fieldAria } from "./field-state.ts";
import { ProblemCard } from "./problem-card.tsx";
import { fieldProblem, issueTag, type BlockIssue } from "./flow-readiness.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { StatusBadge } from "./status-badge.tsx";

import type { FlowWire } from "../flow-graph.ts";
type AgentBlock = Extract<FlowBlock, { kind: "agent" }>;
type WaitBlock = Extract<FlowBlock, { kind: "wait" }>;
type ContinuationBlock = Extract<FlowBlock, { kind: "continuation" }>;
type JoinBlock = Extract<FlowBlock, { kind: "join" }>;

/** The Agents a block may name: every saved Agent, and those this Flow may place. */
export type BlockAgents = {
  readonly all: readonly AgentDefinition[];
  readonly placeable: readonly AgentDefinition[];
  readonly capabilities: AgentCapabilities | null;
};

/** Configuration of the selected block, shown in the editor's docked settings panel. */
export function BlockConfiguration({
  block,
  graph,
  agents,
  flows,
  issues,
  flowId,
  condition,
  onEdit,
  onWireChange,
}: {
  block: FlowBlock;
  graph: FlowGraph;
  agents: BlockAgents;
  flows: BlockFlows;
  /** The block's readiness issues; the field each names shows its tag. */
  issues: readonly BlockIssue[];
  /** The Flow an opened Agent returns to. */
  flowId: string;
  /** The editor's part in a Condition's rule editing; used only for a Condition. */
  condition: ConditionEditing;
  onEdit: (block: FlowBlock) => void;
  onWireChange: (wire: FlowWire, connected: boolean) => void;
}) {
  const nameId = useId();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const problem = (field: string) => fieldProblem(issues, field);
  const nameProblem = problem("name");
  return (
    <div ref={setScroller} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <Field id={nameId} label="Name" problem={nameProblem}>
        <Input
          id={nameId}
          {...fieldAria(nameProblem && `${nameId}-problem`)}
          value={block.name}
          onChange={(e) => onEdit({ ...block, name: e.target.value })}
        />
      </Field>
      {block.kind === "agent" && (
        <AgentBlockSettings
          block={block}
          agents={agents}
          problem={problem("agentId")}
          flowId={flowId}
          onEdit={onEdit}
        />
      )}
      {block.kind === "wait" && (
        <WaitBlockSettings block={block} problem={problem("duration")} onEdit={onEdit} />
      )}
      {block.kind === "continuation" && (
        <ContinuationBlockSettings
          block={block}
          graph={graph}
          problem={problem("prompt")}
          onEdit={onEdit}
        />
      )}
      {block.kind === "join" && (
        <JoinSourcesField block={block} graph={graph} agents={agents.all} flows={flows.all} />
      )}
      {block.kind === "condition" ? (
        <ConditionOutputs
          block={block}
          graph={graph}
          scroller={scroller}
          editing={condition}
          issues={issues}
          onEdit={onEdit}
          onWireChange={onWireChange}
        />
      ) : block.kind === "subflow" ? (
        <SubflowBlockSettings
          block={block}
          graph={graph}
          flows={flows}
          issues={issues}
          onEdit={onEdit}
          onWireChange={onWireChange}
        />
      ) : (
        <BlockExitConfiguration
          block={block}
          graph={graph}
          agents={agents.all}
          onEdit={onEdit}
          onWireChange={onWireChange}
        />
      )}
    </div>
  );
}

/** A labelled field; a readiness issue shows its tag beside the label. */
function Field({
  id,
  label,
  problem,
  children,
}: {
  id: string;
  label: string;
  problem?: ValidationIssue | undefined;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-5 items-center gap-2">
        <Label htmlFor={id} className="text-label font-normal tracking-label text-muted-foreground">
          {label}
        </Label>
        {problem && (
          <StatusBadge kind="error" className="ml-auto">
            {issueTag(problem)}
          </StatusBadge>
        )}
      </div>
      {children}
      {problem && (
        <ProblemCard
          id={`${id}-problem`}
          tone="error"
          density="compact"
          title={
            problem.code === "block_name_required"
              ? "Enter a name for this Block."
              : problem.message
          }
        />
      )}
    </div>
  );
}

/**
 * The Agent picker: the Agents this Flow may place, each with its model summary; Agents without a
 * model are listed last and can't be picked. A placed Agent the Flow can no longer place stays
 * shown as chosen.
 */
function AgentPicker({
  id,
  block,
  agents,
  describedBy,
  onEdit,
}: {
  id: string;
  block: AgentBlock;
  agents: BlockAgents;
  describedBy: string | undefined;
  onEdit: (block: FlowBlock) => void;
}) {
  const chosen = agents.all.find((agent) => agent.id === block.agentId);
  const choices = agents.placeable.map((agent): MenuChoice => {
    const summary = agentRuntimeMeta(agent.execution, agents.capabilities);
    return summary
      ? { id: agent.id, label: agent.name, description: summary }
      : { id: agent.id, label: agent.name, badge: "Needs a model", disabled: true };
  });
  return (
    <ChoiceMenu
      id={id}
      label="Agent"
      value={block.agentId ?? ""}
      choices={[
        ...choices.filter((choice) => !choice.disabled),
        ...choices.filter((choice) => choice.disabled),
      ]}
      unlistedLabel={chosen?.name ?? "Unavailable Agent"}
      disabled={false}
      placeholder="Choose an Agent"
      empty="No Agents to place"
      describedBy={describedBy}
      problemTone="error"
      className="h-8 border-input bg-background"
      onChange={(agentId) => onEdit({ ...block, agentId })}
    />
  );
}

const REVISIT_CONTEXT_OPTIONS: readonly (readonly [AgentRevisitContext, string])[] = [
  ["keep", "Keep context"],
  ["fresh", "Fresh context"],
];

function AgentBlockSettings({
  block,
  agents,
  problem,
  flowId,
  onEdit,
}: {
  block: AgentBlock;
  agents: BlockAgents;
  problem: ValidationIssue | undefined;
  flowId: string;
  onEdit: (block: FlowBlock) => void;
}) {
  const agentId = useId();
  const revisitContextId = useId();
  const revisitId = useId();
  const agent = agents.all.find((a) => a.id === block.agentId);
  const summary = agent && agentRuntimeMeta(agent.execution, agents.capabilities);
  const workerProblem =
    problem ??
    (agent && !summary
      ? {
          code: "agent_model_required",
          path: "agentId",
          message: `Choose a model for ${agent.name} in the Agent editor or select another Agent.`,
        }
      : undefined);
  return (
    <>
      <Field id={agentId} label="Agent" problem={workerProblem}>
        <AgentPicker
          id={agentId}
          block={block}
          agents={agents}
          describedBy={workerProblem && `${agentId}-problem`}
          onEdit={onEdit}
        />
        {block.agentId && (
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
            <TextLink asChild className="shrink-0">
              <FlowAgentLink agentId={block.agentId} flowId={flowId}>
                Open Agent
              </FlowAgentLink>
            </TextLink>
          </div>
        )}
      </Field>
      <div className="grid gap-1.5">
        <span
          id={revisitContextId}
          className="text-label font-normal tracking-label text-muted-foreground"
        >
          On revisit
        </span>
        <SegmentedChoice
          labelledBy={revisitContextId}
          value={block.revisitContext}
          options={REVISIT_CONTEXT_OPTIONS}
          size="sm"
          onChange={(revisitContext) => onEdit({ ...block, revisitContext })}
        />
      </div>
      <Field id={revisitId} label="Revisit instruction (optional)">
        <Textarea
          id={revisitId}
          rows={3}
          value={block.revisitInstruction}
          onChange={(e) => onEdit({ ...block, revisitInstruction: e.target.value })}
          className="min-h-18 text-sm"
        />
      </Field>
    </>
  );
}

const WAIT_UNITS = (["minutes", "hours", "days"] satisfies WaitUnit[]).map((unit) => ({
  id: unit,
  label: unit,
}));

/** A fixed relative duration; an empty amount saves the draft without one. */
function WaitBlockSettings({
  block,
  problem,
  onEdit,
}: {
  block: WaitBlock;
  problem: ValidationIssue | undefined;
  onEdit: (block: FlowBlock) => void;
}) {
  const amountId = useId();
  const unitId = useId();
  const unit = block.duration?.unit ?? "minutes";
  return (
    <Field id={amountId} label="Wait for" problem={problem}>
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <Input
          id={amountId}
          type="number"
          step="any"
          inputMode="decimal"
          {...fieldAria(problem && `${amountId}-problem`)}
          value={block.duration?.amount ?? ""}
          onChange={(e) => {
            // Any number saves; readiness reports an amount outside 1 minute to 7 days.
            const amount = e.target.valueAsNumber;
            onEdit({ ...block, duration: Number.isFinite(amount) ? { amount, unit } : null });
          }}
        />
        <ChoiceMenu
          id={unitId}
          label="Unit"
          describedBy={problem ? `${amountId}-problem` : undefined}
          problemTone="error"
          value={unit}
          choices={WAIT_UNITS}
          disabled={false}
          placeholder="Choose a unit"
          className="h-8 border-input bg-background"
          onChange={(next) =>
            onEdit({
              ...block,
              duration: block.duration && {
                amount: block.duration.amount,
                unit: next as WaitUnit,
              },
            })
          }
        />
      </div>
    </Field>
  );
}

function ContinuationBlockSettings({
  block,
  graph,
  problem,
  onEdit,
}: {
  block: ContinuationBlock;
  graph: FlowGraph;
  problem: ValidationIssue | undefined;
  onEdit: (block: FlowBlock) => void;
}) {
  const promptId = useId();
  const reference = continuationReference(block, graph).inspector;
  return (
    <>
      <Field id={promptId} label="Prompt" problem={problem}>
        <Textarea
          id={promptId}
          rows={6}
          required
          {...fieldAria(problem && `${promptId}-problem`)}
          value={block.prompt}
          maxLength={120_000}
          onChange={(e) => onEdit({ ...block, prompt: e.target.value })}
          className="min-h-32 text-sm"
        />
      </Field>
      <section aria-label="Continues" className="grid gap-1.5">
        <h3 className="text-label tracking-label text-muted-foreground">Continues</h3>
        <p className="flex items-center gap-1.5 text-sm">
          <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-brand-cyan" />
          <span
            className={reference.tone === "continued" ? "text-foreground" : "text-muted-foreground"}
          >
            {reference.value}
          </span>
        </p>
      </section>
    </>
  );
}

function JoinSourcesField({
  block,
  graph,
  agents,
  flows,
}: {
  block: JoinBlock;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  flows: readonly FlowDraft[];
}) {
  const flowMap = new Map(flows.map((flow) => [flow.id, flow]));
  const blocks = new Map(graph.blocks.map((item) => [item.id, item]));
  const slots = joinSlots(graph, block.id);
  const sources = slots.flatMap((slot) => {
    const source = blocks.get(slot.sourceBlockId);
    if (!source) return [];
    const exits = new Map(
      effectiveExits(source, agents, flowMap).map((exit) => [
        exit.id,
        exitDisplayName(exit, "Output"),
      ]),
    );
    return [
      {
        id: source.id,
        name: source.name || "Unnamed block",
        exits: slot.exitIds.map((exitId) => exits.get(exitId) || exitId).join(" · "),
      },
    ];
  });
  return (
    <section aria-label="Sources" className="grid gap-2">
      <PanelHeading>{`Sources · ${slots.length === 1 ? "1 block" : `${slots.length} blocks`}`}</PanelHeading>
      {sources.length > 0 ? (
        <Surface tone="group" asChild>
          <ul>
            {sources.map((source) => (
              <li key={source.id} className="grid gap-0.5 px-3 py-2">
                <span className="truncate text-sm font-medium text-foreground">{source.name}</span>
                <span className="truncate text-xs text-muted-foreground">{source.exits}</span>
              </li>
            ))}
          </ul>
        </Surface>
      ) : (
        <p className="text-xs text-muted-foreground">
          No sources yet. Connect two or more blocks to this Join on the canvas.
        </p>
      )}
    </section>
  );
}
