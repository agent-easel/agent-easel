import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, GripVertical, PanelLeftOpen, Plus, Search } from "lucide-react";
import type { AgentDefinition, FactoryProject, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StudioLink } from "../components/app-link.tsx";
import { BLOCK_KINDS, blockReference } from "../block-kind.ts";
import { newBlock, type BlockPosition } from "../flow-graph.ts";
import type { GrabOffset } from "./canvas-surface.tsx";
import { DragButton } from "./drag-button.tsx";
import { BlockPreview, type DropAt } from "./flow-canvas.tsx";
import { SectionLabel } from "./page.tsx";
import { NeedsModel } from "./needs-model.tsx";
import { ownerGroups, type StudioOwner } from "../studio-definitions.ts";

function agentDetail({ execution }: AgentDefinition) {
  return execution ? `${execution.providerInstanceId} · ${execution.modelId}` : <NeedsModel />;
}

const STEPS = [
  { kind: "human", name: "Human step", detail: "Asks a person" },
  { kind: "wait", name: "Wait", detail: "Pauses, then continues" },
  { kind: "continuation", name: "Continuation", detail: "Same thread, new prompt" },
  { kind: "condition", name: "Condition", detail: "Routes by arrival number" },
] as const satisfies readonly { kind: FlowBlock["kind"]; name: string; detail: string }[];

export function BlockLibrary({
  open,
  onOpenChange,
  flowId,
  owner,
  agents,
  projects,
  agentError,
  onAdd,
  dropAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  /** The Flow's owner, which decides the Agents it may place. */
  owner: StudioOwner;
  /** Only the Agents this Flow may place. */
  agents: readonly AgentDefinition[];
  projects: readonly FactoryProject[];
  agentError: string;
  onAdd: (kind: FlowBlock["kind"], agent?: AgentDefinition, position?: BlockPosition) => void;
  dropAt: DropAt;
}) {
  const [query, setQuery] = useState("");
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const steps = STEPS.filter((step) => matches(step.name));
  const shown = agents.filter((agent) => matches(agent.name));
  const groups = ownerGroups(shown, projects, { kind: "all" });
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
      className="flex w-65 shrink-0 flex-col gap-2.5 overflow-y-auto border-r bg-sidebar px-3 pb-3.5"
    >
      {/* Bleeds over the panel's side padding so rows scrolled beneath it stay hidden; the
          negative bottom margin keeps the panel gap below the search. */}
      <div className="sticky top-0 z-10 -mx-3 -mb-2.5 grid gap-2.5 bg-sidebar px-3 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Library</SectionLabel>
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
                <ChevronLeft aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse library</TooltipContent>
          </Tooltip>
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search steps and Agents"
            placeholder="Search steps and Agents"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {steps.length > 0 && <SectionLabel>Steps</SectionLabel>}
      {steps.map((step) => (
        <LibraryItem
          key={step.kind}
          {...step}
          dropAt={dropAt}
          onAdd={(position) => onAdd(step.kind, undefined, position)}
        />
      ))}
      {agentError && (
        <p role="alert" className="text-xs text-destructive">
          {agentError}
        </p>
      )}
      {!agents.length && (
        <p className="text-xs text-muted-foreground">
          Create an{" "}
          <StudioLink selection={{ tab: "agents", agentId: "new", fromFlow: flowId }}>
            Agent definition
          </StudioLink>
          {owner.projectId === null ? "" : ` (Global or ${owner.title})`}, then return here.
        </p>
      )}
      {agents.length > 0 && !shown.length && (
        <p className="text-xs text-muted-foreground">No saved Agents match “{query.trim()}”.</p>
      )}
      {groups.map((group) => (
        <section
          key={group.owner.projectId ?? "global"}
          aria-label={`${group.owner.title} Agents`}
          className="flex min-w-0 flex-col gap-2.5"
        >
          <div className="flex items-center gap-2">
            <SectionLabel className="min-w-0 truncate">{group.owner.title} Agents</SectionLabel>
            <span className="ml-auto text-2xs tracking-label text-subtle-foreground">
              {group.items.length}
            </span>
          </div>
          {group.items.map((agent) => (
            <LibraryItem
              key={agent.id}
              name={agent.name}
              detail={agentDetail(agent)}
              kind="agent"
              agent={agent}
              dropAt={dropAt}
              onAdd={(position) => onAdd("agent", agent, position)}
            />
          ))}
        </section>
      ))}
      <span className="flex-1" />
      <StudioLink
        selection={{ tab: "agents", agentId: "new", fromFlow: flowId }}
        className="flex items-center gap-1.5 text-2xs font-medium no-underline hover:underline"
      >
        <Plus aria-hidden className="size-3" /> New Agent definition
      </StudioLink>
    </div>
  );
}

/** The ghost hangs from the pointer near its header's left edge, where a canvas block is grabbed. */
const GHOST_GRAB: GrabOffset = { x: 28, y: 15 };

type Ghost = { left: number; top: number; overCanvas: boolean };

/**
 * Figma Editor/LibraryItem: the whole 52 px row drags onto the canvas; activating it adds.
 * While dragged, a ghost of the new block follows the pointer, and a drop on the canvas
 * places the block exactly where its ghost was.
 */
function LibraryItem({
  name,
  detail,
  kind,
  agent,
  dropAt,
  onAdd,
}: {
  name: string;
  detail: ReactNode;
  kind: FlowBlock["kind"];
  agent?: AgentDefinition;
  dropAt: DropAt;
  onAdd: (position?: BlockPosition) => void;
}) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const { Icon } = BLOCK_KINDS[kind];
  return (
    <>
      {ghost && <BlockGhost ghost={ghost} kind={kind} name={name} agent={agent} />}
      <DragButton
        aria-label={`Add ${name}`}
        className="group flex h-13 w-full shrink-0 cursor-grab items-center gap-2 rounded-lg pr-2 pl-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
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
        <GripVertical
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", ROW_ACTION_VISIBILITY)}
        />
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            LIBRARY_ICON_TILES[kind],
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate text-xs tracking-label text-muted-foreground">{detail}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-md border bg-muted pr-2.5 pl-2 text-2xs font-medium text-muted-foreground group-hover:text-foreground",
            ROW_ACTION_VISIBILITY,
          )}
        >
          <Plus className="size-3" /> Add
        </span>
      </DragButton>
    </>
  );
}

/** Hidden at rest but never removed, so the row keeps its layout, name and keyboard action. */
const ROW_ACTION_VISIBILITY = "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100";

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
