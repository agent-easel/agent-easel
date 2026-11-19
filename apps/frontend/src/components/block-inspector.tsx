import { useId, useState, type ReactNode } from "react";
import { ChevronDown, CornerDownLeft } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FlowBlock,
  FlowGraph,
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
import { fieldIssue, type BlockIssue } from "./flow-readiness.tsx";
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
  const tag = (field: string) => fieldIssue(issues, field);
  return (
    <div ref={setScroller} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <Field id={nameId} label="Name" tag={tag("name")}>
        <Input
          id={nameId}
          aria-invalid={tag("name") ? true : undefined}
          value={block.name}
          onChange={(e) => onEdit({ ...block, name: e.target.value })}
        />
      </Field>
      {block.kind === "agent" && (
        <AgentBlockSettings
          block={block}
          agents={agents}
          tag={tag("agentId")}
          flowId={flowId}
          onEdit={onEdit}
        />
      )}
      {block.kind === "wait" && (
        <WaitBlockSettings block={block} tag={tag("duration")} onEdit={onEdit} />
      )}
      {block.kind === "continuation" && (
        <ContinuationBlockSettings
          block={block}
          graph={graph}
          tag={tag("prompt")}
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
  tag,
  children,
}: {
  id: string;
  label: string;
  tag: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-5 items-center gap-2">
        <Label htmlFor={id} className="text-label font-normal tracking-label text-muted-foreground">
          {label}
        </Label>
        {tag && (
          <StatusBadge kind="error" className="ml-auto">
            {tag}
          </StatusBadge>
        )}
      </div>
      {children}
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
  invalid,
  onEdit,
}: {
  id: string;
  block: AgentBlock;
  agents: BlockAgents;
  invalid: boolean;
  onEdit: (block: FlowBlock) => void;
}) {
  const chosen = agents.all.find((agent) => agent.id === block.agentId);
  const ready = agents.placeable.filter((agent) => agent.execution);
  const modelless = agents.placeable.filter((agent) => !agent.execution);
  const summary = (agent: AgentDefinition) =>
    agent.execution ? agentRuntimeMeta(agent.execution, agents.capabilities) : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          className={cn("w-full justify-between font-normal", invalid && "border-destructive")}
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
          {ready.map((agent) => (
            <DropdownMenuRadioItem
              key={agent.id}
              value={agent.id}
              indicatorPosition="right"
              className="flex-col gap-0.5"
            >
              <span className="text-sm">{agent.name}</span>
              <span className="text-xs text-muted-foreground">{summary(agent)}</span>
            </DropdownMenuRadioItem>
          ))}
          {modelless.map((agent) => (
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
  tag,
  flowId,
  onEdit,
}: {
  block: AgentBlock;
  agents: BlockAgents;
  tag: string | null;
  flowId: string;
  onEdit: (block: FlowBlock) => void;
}) {
  const agentId = useId();
  const revisitId = useId();
  const agent = agents.all.find((a) => a.id === block.agentId);
  return (
    <>
      <Field id={agentId} label="Agent" tag={tag}>
        <AgentPicker id={agentId} block={block} agents={agents} invalid={!!tag} onEdit={onEdit} />
        {block.agentId && (
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {agent?.execution
                ? agentRuntimeMeta(agent.execution, agents.capabilities)
                : agent && <NeedsModel />}
            </span>
            <StudioLink
              selection={{ tab: "agents", agentId: block.agentId, fromFlow: flowId }}
              className="shrink-0 font-medium"
            >
              Open Agent
            </StudioLink>
          </div>
        )}
      </Field>
      <Field id={revisitId} label="Revisit instruction (optional)" tag={null}>
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
  tag,
  onEdit,
}: {
  block: WaitBlock;
  tag: string | null;
  onEdit: (block: FlowBlock) => void;
}) {
  const amountId = useId();
  const unit = block.duration?.unit ?? "minutes";
  return (
    <Field id={amountId} label="Wait for" tag={tag}>
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <Input
          id={amountId}
          type="number"
          step="any"
          inputMode="decimal"
          aria-invalid={tag ? true : undefined}
          value={block.duration?.amount ?? ""}
          onChange={(e) => {
            // Any number saves; readiness reports an amount outside 1 minute to 7 days.
            const amount = e.target.valueAsNumber;
            onEdit({ ...block, duration: Number.isFinite(amount) ? { amount, unit } : null });
          }}
        />
        <NativeSelect
          aria-label="Unit"
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
  tag,
  onEdit,
}: {
  block: ContinuationBlock;
  graph: FlowGraph;
  tag: string | null;
  onEdit: (block: FlowBlock) => void;
}) {
  const promptId = useId();
  const reference = continuationReference(block, graph).inspector;
  return (
    <>
      <Field id={promptId} label="Prompt" tag={tag}>
        <Textarea
          id={promptId}
          rows={6}
          required
          aria-invalid={tag ? true : undefined}
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
