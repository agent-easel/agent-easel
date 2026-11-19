import { useId, useState, type ReactNode } from "react";
import { ChevronDown, CornerDownLeft } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FlowBlock,
  FlowGraph,
  ValidationIssue,
  WaitUnit,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { StudioLink } from "../components/app-link.tsx";
import { continuationReference } from "../block-kind.ts";
import { BlockExitConfiguration } from "./block-exit-configuration.tsx";
import { ConditionOutputs, type ConditionEditing } from "./condition-rules.tsx";
import { fieldAria } from "./field-state.ts";
import { ProblemCard } from "./problem-card.tsx";
import { fieldProblem, issueTag, type BlockIssue } from "./flow-readiness.tsx";
import { NeedsModel } from "./needs-model.tsx";
import { StatusBadge } from "./status-badge.tsx";

type AgentBlock = Extract<FlowBlock, { kind: "agent" }>;
type WaitBlock = Extract<FlowBlock, { kind: "wait" }>;
type ContinuationBlock = Extract<FlowBlock, { kind: "continuation" }>;

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
  issues,
  flowId,
  condition,
  onEdit,
  onChange,
}: {
  block: FlowBlock;
  graph: FlowGraph;
  agents: BlockAgents;
  /** The block's readiness issues; the field each names shows its tag. */
  issues: readonly BlockIssue[];
  /** The Flow an opened Agent returns to. */
  flowId: string;
  /** The editor's part in a Condition's rule editing; used only for a Condition. */
  condition: ConditionEditing;
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
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
      {block.kind === "condition" ? (
        <ConditionOutputs
          block={block}
          graph={graph}
          scroller={scroller}
          editing={condition}
          issues={issues}
          onEdit={onEdit}
          onChange={onChange}
        />
      ) : (
        <BlockExitConfiguration
          block={block}
          graph={graph}
          agents={agents.all}
          onEdit={onEdit}
          onChange={onChange}
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
        <ProblemCard id={`${id}-problem`} tone="error" density="compact" title={problem.message} />
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
  const choices = agents.placeable.map((agent) => ({
    agent,
    summary: agentRuntimeMeta(agent.execution, agents.capabilities),
  }));
  const ready = choices.filter(({ summary }) => summary);
  const modelless = choices.filter(({ summary }) => !summary);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          {...fieldAria(describedBy)}
          className={cn("w-full justify-between font-normal", describedBy && "border-destructive")}
        >
          <span className={cn("truncate", !chosen && "text-muted-foreground")}>
            {chosen?.name ?? (block.agentId ? "Unavailable Agent" : "Choose an Agent")}
          </span>
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuRadioGroup
          value={block.agentId ?? ""}
          onValueChange={(agentId) => onEdit({ ...block, agentId })}
        >
          {ready.map(({ agent, summary }) => (
            <DropdownMenuRadioItem
              key={agent.id}
              value={agent.id}
              indicatorPosition="right"
              className="flex-col gap-0.5"
            >
              <span className="text-sm">{agent.name}</span>
              <span className="text-xs text-muted-foreground">{summary}</span>
            </DropdownMenuRadioItem>
          ))}
          {modelless.map(({ agent }) => (
            <DropdownMenuRadioItem
              key={agent.id}
              value={agent.id}
              disabled
              indicatorPosition="right"
              className="flex-col items-start gap-1"
            >
              <span className="text-sm">{agent.name}</span>
              <NeedsModel />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {agents.placeable.length === 0 && (
          <p className="px-3 py-1.5 text-sm text-muted-foreground">No Agents to place</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
            <StudioLink
              selection={{ tab: "agents", agentId: block.agentId, fromFlow: flowId }}
              className="shrink-0 font-medium"
            >
              Open Agent
            </StudioLink>
          </div>
        )}
      </Field>
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

const WAIT_UNITS: readonly WaitUnit[] = ["minutes", "hours", "days"];

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
        <NativeSelect
          aria-label="Unit"
          {...fieldAria(problem && `${amountId}-problem`)}
          value={unit}
          onChange={(e) =>
            onEdit({
              ...block,
              duration: block.duration && {
                amount: block.duration.amount,
                unit: e.target.value as WaitUnit,
              },
            })
          }
        >
          {WAIT_UNITS.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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
