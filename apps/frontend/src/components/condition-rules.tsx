import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import {
  CONDITION_ARRIVAL_MAX,
  type ConditionRule,
  type FlowBlock,
  type FlowGraph,
} from "@t3-factory/contracts";
import { CONDITION_OTHERWISE } from "@t3-factory/domain-validation";
import { CONDITION_UNWIRED_PORTS } from "@t3-factory/flow-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { randomId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { exitRecipients } from "../flow-graph.ts";

type ConditionBlock = Extract<FlowBlock, { kind: "condition" }>;

/** A rule control a readiness issue or a rule action moves focus to. */
type RuleField = "name" | "fromArrival" | "up" | "down" | "remove";
export type RuleFocus = { readonly ruleId: string; readonly field: RuleField };

/** How the editor around a Condition's panel takes part in editing its rules. */
export interface ConditionEditing {
  /** Selecting a readiness issue asks to show and focus a rule's control; a new object asks again. */
  readonly focus: RuleFocus | null;
  /** Arrival-number text that is not a valid threshold, by rule id. It never enters the draft. */
  readonly entries: ReadonlyMap<string, string>;
  /** Text null clears the rule's invalid entry. */
  readonly onEntry: (ruleId: string, text: string | null) => void;
}

/** One rule row's fixed height, gap included: rows are positioned by index, not measured. */
const RULE_ROW = 116;
/** Rows rendered beyond each edge of the panel's visible part. */
const OVERSCAN = 4;

const maximum = CONDITION_ARRIVAL_MAX.toLocaleString("en-US");

/**
 * The threshold arrival-number text means: a whole number from 1 to the maximum, null when empty,
 * undefined when it is neither. Nothing is rounded or defaulted.
 */
function thresholdEntry(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return /^[1-9]\d*$/.test(trimmed) && Number.isSafeInteger(value) ? value : undefined;
}

/** Where the rule list starts in the scrolled content of the panel. */
const listOffset = (scroller: HTMLElement, list: HTMLElement) =>
  list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

/** The rows near the visible part of the panel, as `start:end`. */
function shownRows(scroller: HTMLElement | null, list: HTMLElement | null, count: number) {
  if (!scroller || !list) return `0:${Math.min(count, OVERSCAN * 3)}`;
  const from = scroller.scrollTop - listOffset(scroller, list);
  const start = Math.min(count, Math.max(0, Math.floor(from / RULE_ROW) - OVERSCAN));
  const end = Math.min(
    count,
    Math.max(0, Math.ceil((from + scroller.clientHeight) / RULE_ROW) + OVERSCAN),
  );
  return `${start}:${end}`;
}

/**
 * The rows of a list of `count` fixed-height rows inside the panel's scroll container that are
 * rendered: only those near its visible part, so a Condition with tens of thousands of rules stays
 * responsive. `reveal` scrolls a row into view.
 */
function useRuleWindow(scroller: HTMLElement | null, list: HTMLElement | null, count: number) {
  const shown = useSyncExternalStore(
    (changed) => {
      if (!scroller) return () => {};
      scroller.addEventListener("scroll", changed, { passive: true });
      const observer = new ResizeObserver(changed);
      observer.observe(scroller);
      return () => {
        scroller.removeEventListener("scroll", changed);
        observer.disconnect();
      };
    },
    () => shownRows(scroller, list, count),
  );
  const [start = 0, end = 0] = shown.split(":").map(Number);
  function reveal(index: number) {
    if (!scroller || !list) return;
    const top = listOffset(scroller, list) + index * RULE_ROW;
    if (top < scroller.scrollTop) scroller.scrollTo({ top });
    else if (top + RULE_ROW > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTo({ top: top + RULE_ROW - scroller.clientHeight });
  }
  return { start, end, reveal };
}

/**
 * Moves focus to a rule control once its row is rendered, scrolling it into view first: after a
 * readiness issue is selected, or after a rule action added, moved or removed a row.
 */
function useRuleFocus(
  list: HTMLElement | null,
  rules: readonly ConditionRule[],
  reveal: (index: number) => void,
  requested: RuleFocus | null,
) {
  const pending = useRef<RuleFocus | "add" | null>(null);
  useLayoutEffect(() => {
    if (requested) pending.current = requested;
  }, [requested]);
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target || !list) return;
    if (target === "add") {
      pending.current = null;
      list.parentElement
        ?.querySelector<HTMLElement>("[data-rule-field=add]")
        ?.focus({ preventScroll: true });
      return;
    }
    const index = rules.findIndex((rule) => rule.id === target.ruleId);
    const control = list.querySelector<HTMLElement>(
      `[data-rule-id="${CSS.escape(target.ruleId)}"] [data-rule-field="${target.field}"]`,
    );
    if (index >= 0) reveal(index);
    if (control || index < 0) pending.current = null;
    control?.focus({ preventScroll: true });
  });
  return (target: RuleFocus | "add") => {
    pending.current = target;
  };
}

/**
 * A Condition's outputs: its ordered rules, each with a stable output, then the fixed Otherwise.
 * Renaming, reordering or editing a rule keeps its output and wires; removing a rule removes its
 * wires in the same edit.
 */
export function ConditionOutputs({
  block,
  graph,
  scroller,
  editing,
  onEdit,
}: {
  block: ConditionBlock;
  graph: FlowGraph;
  /** The panel's scroll container, which scrolls the rule list with the rest of the panel. */
  scroller: HTMLElement | null;
  editing: ConditionEditing;
  onEdit: (block: FlowBlock) => void;
}) {
  const [list, setList] = useState<HTMLOListElement | null>(null);
  const { rules } = block;
  const { start, end, reveal } = useRuleWindow(scroller, list, rules.length);
  const focus = useRuleFocus(list, rules, reveal, editing.focus);
  const editRules = (next: readonly ConditionRule[]) => onEdit({ ...block, rules: next });
  const actions: RuleActions = {
    rename: (index, name) => editRules(rules.with(index, { ...rules[index]!, name })),
    threshold: (index, text) => {
      const rule = rules[index]!;
      const value = thresholdEntry(text);
      if (value === undefined) {
        editing.onEntry(rule.id, text);
        return;
      }
      editing.onEntry(rule.id, null);
      if (value !== rule.fromArrival) editRules(rules.with(index, { ...rule, fromArrival: value }));
    },
    move: (index, by, field) => {
      const rule = rules[index]!;
      const next = rules.toSpliced(index, 1).toSpliced(index + by, 0, rule);
      editRules(next);
      focus({ ruleId: rule.id, field });
    },
    remove: (index) => {
      const rule = rules[index]!;
      editing.onEntry(rule.id, null);
      editRules(rules.toSpliced(index, 1));
      const neighbour = rules[index + 1] ?? rules[index - 1];
      focus(neighbour ? { ruleId: neighbour.id, field: "remove" } : "add");
    },
  };
  return (
    <section aria-label="Outputs" className="grid gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Outputs · {rules.length.toLocaleString("en-US")} {rules.length === 1 ? "rule" : "rules"},
        then Otherwise
      </h3>
      <p className="text-xs text-muted-foreground">
        Order rules from the highest arrival number down; each needs a distinct output name and an
        arrival number of 2 or more. Every connected block receives the arrival; with no connection
        the branch ends.
      </p>
      {rules.length > 0 && (
        <ol
          ref={setList}
          aria-label="Rules"
          className="relative"
          style={{ height: rules.length * RULE_ROW }}
        >
          {rules.slice(start, end).map((rule, offset) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              index={start + offset}
              count={rules.length}
              entry={editing.entries.get(rule.id)}
              graph={graph}
              blockId={block.id}
              actions={actions}
            />
          ))}
        </ol>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        data-rule-field="add"
        onClick={() => {
          const rule = { id: randomId(), name: "", fromArrival: null };
          editRules([...rules, rule]);
          focus({ ruleId: rule.id, field: "name" });
        }}
      >
        <Plus aria-hidden /> Add rule
      </Button>
      <div
        role="group"
        aria-label={`Output ${CONDITION_OTHERWISE.name}`}
        className="grid gap-1 rounded-lg border bg-muted px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 font-mono text-xs">{CONDITION_OTHERWISE.name}</span>
          <Lock aria-label="Locked" className="size-3 shrink-0 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">
          When no rule matches. Always last; it cannot be renamed, moved or removed.
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {recipients(graph, block.id, CONDITION_OTHERWISE.id)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        The canvas draws a port for every connected output, Otherwise and the first{" "}
        {CONDITION_UNWIRED_PORTS} unconnected rules. To connect a later rule, move it up.
      </p>
    </section>
  );
}

/** Where an output's arrivals go. */
const recipients = (graph: FlowGraph, blockId: string, exitId: string) =>
  `→ ${exitRecipients(graph, blockId, exitId).join(", ") || "finish here"}`;

interface RuleActions {
  readonly rename: (index: number, name: string) => void;
  readonly threshold: (index: number, text: string) => void;
  readonly move: (index: number, by: -1 | 1, field: RuleField) => void;
  readonly remove: (index: number) => void;
}

function RuleRow({
  rule,
  index,
  count,
  entry,
  graph,
  blockId,
  actions,
}: {
  rule: ConditionRule;
  index: number;
  count: number;
  /** Invalid arrival-number text shown instead of the rule's threshold. */
  entry: string | undefined;
  graph: FlowGraph;
  blockId: string;
  actions: RuleActions;
}) {
  const id = useId();
  const position = index + 1;
  const label = `Rule ${position}`;
  return (
    <li
      aria-label={`${label} ${rule.name || "unnamed"}`}
      aria-posinset={position}
      aria-setsize={count}
      data-rule-id={rule.id}
      className="absolute inset-x-0 grid content-start gap-1.5 rounded-lg border bg-muted p-2.5"
      style={{ top: index * RULE_ROW, height: RULE_ROW - 8 }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-6 shrink-0 font-mono text-2xs text-muted-foreground">
          {position.toLocaleString("en-US")}
        </span>
        <Input
          aria-label={`${label} output name`}
          data-rule-field="name"
          className="h-7 font-mono text-xs"
          placeholder="Output name"
          value={rule.name}
          onChange={(event) => actions.rename(index, event.target.value)}
        />
        <RuleButton
          label="Move rule up"
          field="up"
          disabled={index === 0}
          onClick={() => actions.move(index, -1, index === 1 ? "name" : "up")}
        >
          <ArrowUp aria-hidden />
        </RuleButton>
        <RuleButton
          label="Move rule down"
          field="down"
          disabled={index === count - 1}
          onClick={() => actions.move(index, 1, index === count - 2 ? "name" : "down")}
        >
          <ArrowDown aria-hidden />
        </RuleButton>
        <RuleButton label="Remove rule" field="remove" onClick={() => actions.remove(index)}>
          <Trash2 aria-hidden />
        </RuleButton>
      </div>
      <div className="flex items-center gap-1.5 pl-7 text-xs text-muted-foreground">
        <span aria-hidden>From arrival</span>
        <Input
          aria-label={`${label} from arrival`}
          aria-invalid={entry !== undefined || undefined}
          aria-describedby={`${id}-detail`}
          data-rule-field="fromArrival"
          inputMode="numeric"
          className="h-7 w-28 font-mono text-xs"
          placeholder="none"
          value={entry ?? (rule.fromArrival === null ? "" : String(rule.fromArrival))}
          onChange={(event) => actions.threshold(index, event.target.value)}
        />
        <span>onward</span>
      </div>
      <p
        id={`${id}-detail`}
        className={cn(
          "truncate pl-7 text-xs",
          entry === undefined ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {entry === undefined
          ? recipients(graph, blockId, rule.id)
          : `Use a whole number from 1 to ${maximum}.`}
      </p>
    </li>
  );
}

function RuleButton({
  label,
  field,
  disabled,
  onClick,
  children,
}: {
  label: string;
  field: RuleField;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          data-rule-field={field}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
