import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  CONDITION_ARRIVAL_MAX,
  type ConditionRule,
  type FlowBlock,
  type FlowGraph,
} from "@t3-factory/contracts";
import { CONDITION_OTHERWISE } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { randomId } from "@/lib/ids";
import { PanelHeading, TargetSelect } from "./block-exit-configuration.tsx";
import { fieldIssue, type BlockIssue } from "./flow-readiness.tsx";
import { StatusBadge } from "./status-badge.tsx";

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
const RULE_ROW = 128;
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
  issues,
  onEdit,
  onChange,
}: {
  block: ConditionBlock;
  graph: FlowGraph;
  /** The panel's scroll container, which scrolls the rule list with the rest of the panel. */
  scroller: HTMLElement | null;
  editing: ConditionEditing;
  /** The block's readiness issues; a rule row and Otherwise show theirs. */
  issues: readonly BlockIssue[];
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
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
  const target = (exitId: string, label: string) => (
    <TargetSelect
      graph={graph}
      source={{ kind: "exit", sourceBlockId: block.id, exitId }}
      label={label}
      onChange={onChange}
    />
  );
  // Block-level issues name Otherwise; rule issues name their rule.
  const otherwiseTag = issues.some(
    (item) => item.field === "" && item.issue.code === "condition_output_unconnected",
  )
    ? "Not connected"
    : null;
  return (
    <section aria-label="Outputs" className="grid gap-2">
      <PanelHeading>Outputs</PanelHeading>
      <div className="grid overflow-hidden rounded-lg border">
        {rules.length > 0 && (
          <ol
            ref={setList}
            aria-label="Rules"
            className="relative border-b"
            style={{ height: rules.length * RULE_ROW }}
          >
            {rules.slice(start, end).map((rule, offset) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={start + offset}
                count={rules.length}
                entry={editing.entries.get(rule.id)}
                tag={fieldIssue(issues, `rules.${start + offset}`)}
                target={target(rule.id, `output ${rule.name || "unnamed"}`)}
                actions={actions}
              />
            ))}
          </ol>
        )}
        <div
          role="group"
          aria-label={`Output ${CONDITION_OTHERWISE.name}`}
          className="grid gap-2 px-3 py-2.5"
        >
          <span className="flex items-center gap-2 text-sm">
            {CONDITION_OTHERWISE.name}
            {otherwiseTag && (
              <StatusBadge kind="error" className="ml-auto">
                {otherwiseTag}
              </StatusBadge>
            )}
          </span>
          {target(CONDITION_OTHERWISE.id, `output ${CONDITION_OTHERWISE.name}`)}
        </div>
      </div>
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
    </section>
  );
}

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
  tag,
  target,
  actions,
}: {
  rule: ConditionRule;
  index: number;
  count: number;
  /** Invalid arrival-number text shown instead of the rule's threshold. */
  entry: string | undefined;
  /** The rule's readiness issue, such as an output that is not connected. */
  tag: string | null;
  target: ReactNode;
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
      className="absolute inset-x-0 grid content-start gap-2 border-b px-3 py-2.5 last:border-b-0"
      style={{ top: index * RULE_ROW, height: RULE_ROW }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-6 shrink-0 font-mono text-2xs text-muted-foreground">
          {position.toLocaleString("en-US")}
        </span>
        <Input
          aria-label={`${label} output name`}
          data-rule-field="name"
          className="h-7 text-sm"
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
          aria-describedby={entry === undefined ? undefined : `${id}-detail`}
          data-rule-field="fromArrival"
          inputMode="numeric"
          className="h-7 w-16 text-sm"
          placeholder="none"
          value={entry ?? (rule.fromArrival === null ? "" : String(rule.fromArrival))}
          onChange={(event) => actions.threshold(index, event.target.value)}
        />
        <span>onward</span>
        {entry !== undefined ? (
          <StatusBadge id={`${id}-detail`} role="alert" kind="error" className="ml-auto">
            1 to {maximum}
          </StatusBadge>
        ) : (
          tag && (
            <StatusBadge kind="error" className="ml-auto">
              {tag}
            </StatusBadge>
          )
        )}
      </div>
      <div className="pl-7">{target}</div>
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
