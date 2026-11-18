import { useId, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { AgentDefinition, BlockExit, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import type { WireSource } from "@t3-factory/flow-layout";
import {
  CONTINUATION_EXIT,
  effectiveExits,
  inheritedExits,
  WAIT_OUTPUT,
} from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/ids";
import { addWire, canConnect, hasWire, removeWire } from "../flow-graph.ts";
import { StatusBadge } from "./status-badge.tsx";

type AgentBlock = Extract<FlowBlock, { kind: "agent" }>;
/** A Condition's outputs are its rules, edited in `ConditionOutputs`. */
type ExitBlock = Exclude<FlowBlock, { kind: "condition" }>;

/** Sentence-case section heading of the settings panel. */
export function PanelHeading({ children }: { children: string }) {
  return <h3 className="text-label tracking-label text-muted-foreground">{children}</h3>;
}

const cardClass = "grid divide-y overflow-hidden rounded-lg border";

/**
 * The keyboard way to connect a source: a multi-select of the Blocks it may reach, with the
 * connected ones checked. Each choice adds or removes one connection; the closed select names
 * every target.
 */
export function TargetSelect({
  graph,
  source,
  label,
  onChange,
}: {
  graph: FlowGraph;
  source: WireSource;
  /** What the select connects, for its accessible name, such as "exit Approve". */
  label: string;
  onChange: (graph: FlowGraph) => void;
}) {
  const wired = (targetBlockId: string) => hasWire(graph, { source, targetBlockId });
  const choices = graph.blocks.filter(
    (block) => wired(block.id) || canConnect(graph, source, block.id),
  );
  const targets = choices.filter((block) => wired(block.id));
  const names = targets.map((block) => block.name || "Unnamed block").join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Targets of ${label}: ${names || "none"}`}
          className="w-full min-w-0 justify-start gap-1.5 font-normal"
        >
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn("min-w-0 flex-1 truncate text-left", !names && "text-muted-foreground")}
          >
            {names || "Not connected"}
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        {choices.length === 0 && (
          <p className="px-3 py-1.5 text-sm text-muted-foreground">No Blocks to connect</p>
        )}
        {choices.map((block) => (
          <DropdownMenuCheckboxItem
            key={block.id}
            checked={wired(block.id)}
            onCheckedChange={(checked) => {
              const wire = { source, targetBlockId: block.id };
              onChange(checked ? addWire(graph, wire) : removeWire(graph, wire));
            }}
          >
            <span className="truncate">{block.name || "Unnamed block"}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BlockExitConfiguration({
  block,
  graph,
  agents,
  onEdit,
  onChange,
}: {
  block: ExitBlock;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
}) {
  const target = (exitId: string, label: string) => (
    <TargetSelect
      graph={graph}
      source={{ kind: "exit", sourceBlockId: block.id, exitId }}
      label={label}
      onChange={onChange}
    />
  );
  if (block.kind === "wait" || block.kind === "continuation")
    return (
      <section aria-label="Output" className="grid gap-2">
        <PanelHeading>Output</PanelHeading>
        {target(block.kind === "wait" ? WAIT_OUTPUT.id : CONTINUATION_EXIT.id, "output")}
      </section>
    );
  if (block.kind === "human")
    return (
      <section aria-label="Exits" className="grid gap-2">
        <PanelHeading>Exits</PanelHeading>
        <ul className={cardClass}>
          {effectiveExits(block, agents).map((exit) => (
            <li key={exit.id} aria-label={`Exit ${exit.name}`} className="grid gap-2 px-3 py-2.5">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {exit.name}
                {exit.messageRequired && <StatusBadge kind="neutral">Message required</StatusBadge>}
              </span>
              {target(exit.id, `exit ${exit.name}`)}
            </li>
          ))}
        </ul>
      </section>
    );
  const inherited = inheritedExits(block, agents);
  return (
    <>
      {inherited.length > 0 && (
        <section aria-label="Exits" className="grid gap-2">
          <PanelHeading>Exits</PanelHeading>
          <ul className={cardClass}>
            {inherited.map((exit) => (
              <InheritedExit
                key={exit.id}
                exit={exit}
                block={block}
                onEdit={onEdit}
                target={target(exit.id, `exit ${exit.name}`)}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Local exits" className="grid gap-2">
        <PanelHeading>Local exits</PanelHeading>
        {block.localExits.map((exit) => (
          <LocalExitCard
            key={exit.id}
            exit={exit}
            target={target(exit.id, `local exit ${exit.name || "unnamed"}`)}
            onEdit={(next) =>
              onEdit({
                ...block,
                localExits: block.localExits.map((item) => (item.id === exit.id ? next : item)),
              })
            }
            onRemove={() =>
              onEdit({
                ...block,
                localExits: block.localExits.filter((item) => item.id !== exit.id),
              })
            }
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={block.localExits.length >= 100}
          onClick={() =>
            onEdit({
              ...block,
              localExits: [
                ...block.localExits,
                { id: randomId(), name: "", description: "", messageRequired: false },
              ],
            })
          }
        >
          <Plus aria-hidden /> Add local exit
        </Button>
      </section>
    </>
  );
}

function InheritedExit({
  exit,
  block,
  onEdit,
  target,
}: {
  exit: BlockExit;
  block: AgentBlock;
  onEdit: (block: FlowBlock) => void;
  target: ReactNode;
}) {
  const hidden = block.hiddenExitIds.includes(exit.id);
  return (
    <li aria-label={`Exit ${exit.name}`} className="flex items-start gap-2 px-3 py-2.5">
      <div className="grid min-w-0 flex-1 gap-2">
        <span className={cn("break-words text-sm", hidden && "text-muted-foreground line-through")}>
          {exit.name}
        </span>
        {!hidden && target}
      </div>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${hidden ? "Show" : "Hide"} exit ${exit.name}`}
        onClick={() =>
          onEdit({
            ...block,
            hiddenExitIds: hidden
              ? block.hiddenExitIds.filter((id) => id !== exit.id)
              : [...block.hiddenExitIds, exit.id],
          })
        }
      >
        {hidden ? "Show" : "Hide"}
      </Button>
    </li>
  );
}

function LocalExitCard({
  exit,
  target,
  onEdit,
  onRemove,
}: {
  exit: BlockExit;
  target: ReactNode;
  onEdit: (exit: BlockExit) => void;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <section
      aria-label={`Local exit ${exit.name || "unnamed"}`}
      className="grid min-w-0 gap-2 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <Label htmlFor={`${id}-name`} className="sr-only">
          Exit name
        </Label>
        <Input
          id={`${id}-name`}
          placeholder="Exit name"
          value={exit.name}
          maxLength={200}
          onChange={(event) => onEdit({ ...exit, name: event.target.value })}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove local exit"
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove local exit</TooltipContent>
        </Tooltip>
      </div>
      <Label htmlFor={`${id}-description`} className="sr-only">
        Description
      </Label>
      <Textarea
        id={`${id}-description`}
        placeholder="Description"
        value={exit.description}
        maxLength={4000}
        onChange={(event) => onEdit({ ...exit, description: event.target.value })}
      />
      <Label htmlFor={`${id}-message`} className="text-xs font-normal">
        <Checkbox
          id={`${id}-message`}
          checked={exit.messageRequired}
          onCheckedChange={(checked) => onEdit({ ...exit, messageRequired: checked === true })}
        />
        Message required
      </Label>
      {target}
    </section>
  );
}
