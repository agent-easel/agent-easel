import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FactoryProject,
  FlowBlock,
  FlowGraph,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextLink } from "@/components/ui/text-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { FlowAgentLink } from "../components/app-link.tsx";
import { BLOCK_KINDS, blockReference } from "../block-kind.ts";
import { newBlock, type BlockPosition } from "../flow-graph.ts";
import type { GrabOffset } from "./canvas-surface.tsx";
import { DragButton } from "./drag-button.tsx";
import { BlockPreview, type DropAt } from "./flow-canvas.tsx";
import { NeedsModel } from "./needs-model.tsx";
import { ownerGroups } from "../studio-definitions.ts";

const STEPS = [
  { kind: "human", name: "Human step", detail: "Asks a person" },
  { kind: "wait", name: "Wait", detail: "Pauses, then continues" },
  { kind: "continuation", name: "Continuation", detail: "Same thread, new prompt" },
  { kind: "condition", name: "Condition", detail: "Routes by arrival number" },
] as const satisfies readonly { kind: FlowBlock["kind"]; name: string; detail: string }[];

const headingClass = "text-label tracking-label text-muted-foreground";

/** Opens the new Agent draft over this Flow; Create returns here. */
export function NewAgentLink({ flowId, className }: { flowId: string; className?: string }) {
  return (
    <TextLink asChild trailingIcon={ChevronRight} className={cn("w-fit text-sm", className)}>
      <FlowAgentLink agentId="new" flowId={flowId}>
        New Agent
      </FlowAgentLink>
    </TextLink>
  );
}

export function BlockLibrary({
  open,
  onOpenChange,
  flowId,
  agents,
  projects,
  capabilities,
  agentError,
  onAdd,
  dropAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  /** Only the Agents this Flow may place. */
  agents: readonly AgentDefinition[];
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  agentError: string;
  onAdd: (kind: FlowBlock["kind"], agent?: AgentDefinition, position?: BlockPosition) => void;
  dropAt: DropAt;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const steps = STEPS.filter((step) => matches(step.name));
  const shown = agents.filter((agent) => matches(agent.name));
  const groups = ownerGroups(shown, projects, { kind: "all" });
  const summaries = new Map(
    agents.map((agent) => [agent.id, agentRuntimeMeta(agent.execution, capabilities)]),
  );
  const placeable = [...summaries.values()].some(Boolean);
  if (!open)
    return (
      <div className="flex w-11 shrink-0 flex-col items-center border-r bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Expand library"
              aria-expanded={false}
              aria-controls="block-library"
              onClick={() => onOpenChange(true)}
            >
              <PanelLeftOpen aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand library</TooltipContent>
        </Tooltip>
      </div>
    );
  return (
    <div
      id="block-library"
      role="region"
      aria-label="Block library"
      className="flex w-66 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-sidebar px-3 pb-3.5"
    >
      {/* Bleeds over the panel's side padding so rows scrolled beneath it stay hidden. */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-sidebar px-3 pt-3 pb-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search steps and Agents"
            placeholder="Search steps and Agents"
            className="pl-8 placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse library"
              aria-expanded
              aria-controls="block-library"
              onClick={() => onOpenChange(false)}
            >
              <PanelLeftClose aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Collapse library</TooltipContent>
        </Tooltip>
      </div>
      {searching && !steps.length && !shown.length && (
        <p className="px-1.5 text-sm text-muted-foreground">No matching steps or Agents</p>
      )}
      {steps.length > 0 && (
        <section aria-label="Steps" className="flex flex-col gap-1">
          <h3 className={cn(headingClass, "px-1.5 py-1")}>Steps</h3>
          {steps.map((step) => (
            <LibraryItem
              key={step.kind}
              {...step}
              dropAt={dropAt}
              onAdd={(position) => onAdd(step.kind, undefined, position)}
            />
          ))}
        </section>
      )}
      {agentError && (
        <p role="alert" className="text-xs text-destructive">
          {agentError}
        </p>
      )}
      {!agents.length && !searching && (
        <section aria-label="Agents" className="mt-3 flex flex-col gap-1.5 px-1.5">
          <h3 className={headingClass}>Agents</h3>
          <p className="text-sm text-muted-foreground">No Agents yet</p>
          <NewAgentLink flowId={flowId} />
        </section>
      )}
      {groups.map((group) => (
        <section
          key={group.owner.projectId ?? "global"}
          aria-label={`${group.owner.title} Agents`}
          className="mt-3 flex min-w-0 flex-col gap-1"
        >
          <div className="flex items-center gap-2 px-1.5 py-1">
            <h3 className={cn(headingClass, "min-w-0 break-words")}>{group.owner.title}</h3>
            <span className="ml-auto text-2xs tracking-label text-subtle-foreground">
              {group.items.length}
            </span>
          </div>
          {[...group.items]
            .sort(
              (left, right) => Number(!!summaries.get(right.id)) - Number(!!summaries.get(left.id)),
            )
            .map((agent) => {
              const summary = summaries.get(agent.id);
              return (
                <LibraryItem
                  key={agent.id}
                  name={agent.name}
                  detail={summary || <NeedsModel />}
                  kind="agent"
                  agent={agent}
                  disabled={!summary}
                  dropAt={dropAt}
                  onAdd={(position) => onAdd("agent", agent, position)}
                />
              );
            })}
        </section>
      ))}
      {agents.length > 0 && !placeable && !searching && (
        <NewAgentLink flowId={flowId} className="mt-1 px-1.5" />
      )}
    </div>
  );
}

/** The ghost hangs from the pointer near its header's left edge, where a canvas block is grabbed. */
const GHOST_GRAB: GrabOffset = { x: 28, y: 15 };

type Ghost = { left: number; top: number; overCanvas: boolean };

/**
 * Figma Editor/LibraryItem: the whole row drags onto the canvas; activating it adds.
 * While dragged, a ghost of the new block follows the pointer, and a drop on the canvas
 * places the block exactly where its ghost was.
 */
function LibraryItem({
  name,
  detail,
  kind,
  agent,
  disabled = false,
  dropAt,
  onAdd,
}: {
  name: string;
  detail: ReactNode;
  kind: FlowBlock["kind"];
  agent?: AgentDefinition;
  /** An Agent without a model is listed but can't be placed. */
  disabled?: boolean;
  dropAt: DropAt;
  onAdd: (position?: BlockPosition) => void;
}) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const { Icon } = BLOCK_KINDS[kind];
  const icon = (
    <span
      aria-hidden
      className={cn("grid size-7 shrink-0 place-items-center rounded-md", LIBRARY_ICON_TILES[kind])}
    >
      <Icon className="size-3.5" />
    </span>
  );
  const text = (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      <span className="text-sm font-medium break-words text-foreground">{name}</span>
      <span className="text-xs tracking-label break-words text-muted-foreground">{detail}</span>
    </span>
  );
  if (disabled)
    return (
      <div
        aria-disabled
        aria-label={name}
        className="flex min-h-13 w-full shrink-0 items-center gap-2 rounded-lg py-1.5 pr-2 pl-1.5 opacity-60"
      >
        {icon}
        {text}
      </div>
    );
  return (
    <>
      {ghost && <BlockGhost ghost={ghost} kind={kind} name={name} agent={agent} />}
      <DragButton
        aria-label={`Add ${name}`}
        className="group flex min-h-13 w-full shrink-0 cursor-grab items-center gap-2 rounded-lg py-1.5 pr-2 pl-1.5 text-left outline-none hover:bg-accent focus-ring active:cursor-grabbing"
        onDragMove={(x, y) => {
          // Over the canvas the ghost sits where the block will land, clamping included.
          const placement = dropAt(x, y, GHOST_GRAB);
          setGhost(
            placement
              ? { left: placement.left, top: placement.top, overCanvas: true }
              : { left: x - GHOST_GRAB.x, top: y - GHOST_GRAB.y, overCanvas: false },
          );
        }}
        onDrop={(x, y) => {
          setGhost(null);
          const placement = dropAt(x, y, GHOST_GRAB);
          if (placement) onAdd(placement.position);
        }}
        onDragCancel={() => setGhost(null)}
        onClick={() => onAdd()}
      >
        {icon}
        {text}
      </DragButton>
    </>
  );
}

const LIBRARY_ICON_TILES: Record<FlowBlock["kind"], string> = {
  agent: "bg-brand-soft text-link",
  human: "border border-dashed bg-muted text-muted-foreground",
  wait: "border border-dashed bg-muted text-muted-foreground",
  continuation: "border bg-muted text-brand-cyan",
  condition: "border bg-muted text-muted-foreground",
};

/** The ghost previews the block a drop would add as it reads before it is connected. */
const UNCONNECTED: FlowGraph = {
  blocks: [],
  connections: [],
  flowInput: { position: { x: 0, y: 0 }, targetBlockIds: [] },
};

/** A compact, non-interactive preview of the block a library drag would add. */
function BlockGhost({
  ghost,
  kind,
  name,
  agent,
}: {
  ghost: Ghost;
  kind: FlowBlock["kind"];
  name: string;
  agent: AgentDefinition | undefined;
}) {
  const { label, value } = blockReference(newBlock(UNCONNECTED, kind, agent), {
    graph: UNCONNECTED,
    agents: agent ? [agent] : [],
  }).card;
  return createPortal(
    <BlockPreview
      kind={kind}
      name={name}
      label={label}
      value={value}
      className={cn(
        "pointer-events-none fixed z-50 pb-1.5 shadow-lift",
        ghost.overCanvas ? "opacity-90" : "opacity-50",
      )}
      style={{ left: ghost.left, top: ghost.top }}
    />,
    document.body,
  );
}
