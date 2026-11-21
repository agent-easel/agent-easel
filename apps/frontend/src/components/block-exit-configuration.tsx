import { useId, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type BlockExit,
  type FlowBlock,
  type FlowEnding,
  type FlowGraph,
} from "@t3-factory/contracts";
import type { WireSource } from "@t3-factory/flow-layout";
import {
  CONTINUATION_EXIT,
  exitsWithEndings,
  inheritedExits,
  WAIT_OUTPUT,
  type ExitWithEndings,
} from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/ids";
import { canConnect, hasWire, type FlowWire, type WireTarget } from "../flow-graph.ts";
import { StatusBadge } from "./status-badge.tsx";

type AgentBlock = Extract<FlowBlock, { kind: "agent" }>;
/** A Condition's outputs are its rules, edited in `ConditionOutputs`. */
type ExitBlock = Exclude<FlowBlock, { kind: "condition" }>;

/** Sentence-case section heading of the settings panel. */
export function PanelHeading({ children }: { children: string }) {
  return <h3 className="text-label tracking-label text-muted-foreground">{children}</h3>;
}

const cardClass = "grid divide-y overflow-hidden rounded-lg border";

type TargetChoice = {
  readonly key: string;
  readonly target: WireTarget;
  readonly label: string;
  readonly name: string;
};

function targetChoices(graph: FlowGraph, source: WireSource) {
  const blocks = graph.blocks.map((block): TargetChoice => ({
    key: `block:${block.id}`,
    target: { targetBlockId: block.id },
    label: block.name || "Unnamed block",
    name: block.name || "Unnamed block",
  }));
  const endings = graph.finish.endings.map((ending): TargetChoice => {
    const name = ending.name || "Unnamed ending";
    return {
      key: `ending:${ending.id}`,
      target: { targetBlockId: FINISH_BLOCK_ID, targetEndingId: ending.id },
      label: `Finish → ${name}`,
      name: `Finish · ${name}`,
    };
  });
  const offered = (choice: TargetChoice) =>
    hasWire(graph, { source, ...choice.target }) || canConnect(graph, source, choice.target);
  return { blocks: blocks.filter(offered), endings: endings.filter(offered) };
}

export function TargetSelect({
  graph,
  source,
  label,
  onWireChange,
}: {
  graph: FlowGraph;
  source: WireSource;
  /** What the select connects, for its accessible name, such as "exit Approve". */
  label: string;
  onWireChange: (wire: FlowWire, connected: boolean) => void;
}) {
  const wired = (choice: TargetChoice) => hasWire(graph, { source, ...choice.target });
  const { blocks, endings } = targetChoices(graph, source);
  const names = [...blocks, ...endings]
    .filter(wired)
    .map((choice) => choice.name)
    .join(", ");
  const item = (choice: TargetChoice) => (
    <DropdownMenuCheckboxItem
      key={choice.key}
      checked={wired(choice)}
      onCheckedChange={(checked) => {
        onWireChange({ source, ...choice.target }, checked);
      }}
    >
      <span className="truncate">{choice.label}</span>
    </DropdownMenuCheckboxItem>
  );
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
        {blocks.length === 0 && endings.length === 0 && (
          <p className="px-3 py-1.5 text-sm text-muted-foreground">No Blocks to connect</p>
        )}
        {blocks.map(item)}
        {blocks.length > 0 && endings.length > 0 && <DropdownMenuSeparator />}
        {endings.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function endingExpectation(ending: FlowEnding) {
  const description = ending.outputDescription.trim();
  if (ending.output === "required")
    return description ? `Ending expects: ${description}` : "Ending expects a message.";
  if (ending.output === "optional")
    return description
      ? `Ending takes an optional message: ${description}`
      : "Ending takes an optional message.";
  return null;
}

function EndingExpectations({ exit }: { exit: ExitWithEndings | undefined }) {
  const lines = (exit?.endings ?? []).flatMap((ending) => {
    const text = endingExpectation(ending);
    return text ? [{ id: ending.id, text }] : [];
  });
  return lines.map((line) => (
    <p key={line.id} className="text-label text-muted-foreground">
      {line.text}
    </p>
  ));
}

export function BlockExitConfiguration({
  block,
  graph,
  agents,
  onEdit,
  onWireChange,
}: {
  block: ExitBlock;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  onEdit: (block: FlowBlock) => void;
  onWireChange: (wire: FlowWire, connected: boolean) => void;
}) {
  const exits = new Map(exitsWithEndings(block, graph, agents).map((exit) => [exit.id, exit]));
  const target = (exitId: string, label: string) => (
    <>
      <TargetSelect
        graph={graph}
        source={{ kind: "exit", sourceBlockId: block.id, exitId }}
        label={label}
        onWireChange={onWireChange}
      />
      <EndingExpectations exit={exits.get(exitId)} />
    </>
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
          {[...exits.values()].map((exit) => (
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
                exit={{
                  ...exit,
                  messageRequired: exits.get(exit.id)?.messageRequired ?? exit.messageRequired,
                }}
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
            messageRequired={exits.get(exit.id)?.messageRequired ?? exit.messageRequired}
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
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("break-words", hidden && "text-muted-foreground line-through")}>
            {exit.name}
          </span>
          {exit.messageRequired && <StatusBadge kind="neutral">Message required</StatusBadge>}
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
  messageRequired,
  target,
  onEdit,
  onRemove,
}: {
  exit: BlockExit;
  messageRequired: boolean;
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
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${id}-message`} className="text-xs font-normal">
          <Checkbox
            id={`${id}-message`}
            checked={exit.messageRequired}
            onCheckedChange={(checked) => onEdit({ ...exit, messageRequired: checked === true })}
          />
          Message required
        </Label>
        {messageRequired && !exit.messageRequired && (
          <StatusBadge kind="neutral">Message required</StatusBadge>
        )}
      </div>
      {target}
    </section>
  );
}
