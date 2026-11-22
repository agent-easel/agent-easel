import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import {
  type FlowDraft,
  type FlowGraph,
  type FlowReadiness,
  type ReadinessIssue,
  type UpdateFlowInput,
  type ValidationIssue,
} from "@t3-factory/contracts";
import { JOIN_OUTPUT } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import { StudioLink } from "./app-link.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { FINISH_SELECTION, type CanvasBlockSelection } from "../flow-graph.ts";
import type { RuleFocus } from "./condition-rules.tsx";

export type IssueSelect = (
  blockId: CanvasBlockSelection | null,
  rule?: RuleFocus,
  ending?: string,
) => void;

function issueEnding(path: string, graph: FlowGraph): string | undefined {
  const index = /^graph\.finish\.endings\.(\d+)/.exec(path)?.[1];
  return index === undefined ? undefined : graph.finish?.endings[Number(index)]?.id;
}

/** The Condition rule control an issue path such as `graph.blocks.2.rules.5.fromArrival` names. */
function issueRule(path: string, graph: FlowGraph): RuleFocus | undefined {
  const match = /^graph\.blocks\.(\d+)\.rules\.(\d+)(?:\.(name|fromArrival))?/.exec(path);
  if (!match) return undefined;
  const block = graph.blocks[Number(match[1])];
  const rule = block?.kind === "condition" ? block.rules[Number(match[2])] : undefined;
  return rule && { ruleId: rule.id, field: match[3] === "fromArrival" ? "fromArrival" : "name" };
}

/** The block an issue path refers to: null clears the selection, undefined leaves it. */
function issueSelection(path: string, graph: FlowGraph): CanvasBlockSelection | null | undefined {
  const block = /^graph\.blocks\.(\d+)/.exec(path)?.[1];
  if (block) return graph.blocks[Number(block)]?.id ?? null;
  if (path.startsWith("graph.finish")) return FINISH_SELECTION;
  const connection = /^graph\.connections\.(\d+)/.exec(path)?.[1];
  if (connection) return graph.connections[Number(connection)]?.sourceBlockId ?? null;
  if (!path.startsWith("graph.flowInput")) return undefined;
  const target = /^graph\.flowInput\.targetBlockIds\.(\d+)/.exec(path)?.[1];
  const id = target === undefined ? undefined : graph.flowInput.targetBlockIds[Number(target)];
  return graph.blocks.find((b) => b.id === id)?.id ?? null;
}

function selectIssue(issue: ValidationIssue, graph: FlowGraph, onSelect: IssueSelect) {
  const selection = issueSelection(issue.path, graph);
  if (selection !== undefined)
    onSelect(selection, issueRule(issue.path, graph), issueEnding(issue.path, graph));
}

/** The short tag a Block, or the field an issue names, shows for each readiness issue. */
const ISSUE_TAGS: Readonly<Record<string, string>> = {
  block_name_required: "No name",
  wait_duration_required: "No duration",
  wait_duration_range: "Out of range",
  continuation_prompt_required: "No prompt",
  agent_required: "No Agent",
  agent_scope_mismatch: "Not placeable",
  agent_model_required: "Needs a model",
  exit_required: "No exits",
  exit_id_conflict: "Exit conflict",
  exit_name_required: "No exit name",
  exit_name_conflict: "Exit conflict",
  exit_hidden: "Hidden exit",
  exit_missing: "Missing exit",
  condition_output_unconnected: "Not connected",
  condition_rule_name_duplicate: "Duplicate name",
  condition_threshold_required: "No arrival",
  condition_rule_shadowed: "Never matches",
  condition_threshold_first_arrival: "Arrival too low",
  condition_cycle: "Loop",
  join_sources_required: "Needs 2 sources",
  join_output_unconnected: "Not connected",
  join_cycle: "Loop",
  continuation_worker_required: "No worker thread",
  unreachable_block: "Not connected",
  flow_input_required: "Not connected",
  flow_input_wait: "Not an Agent",
  flow_input_join: "Not an Agent",
  ending_name_required: "No name",
  ending_name_duplicate: "Duplicate name",
  ending_unconnected: "Not connected",
  subflow_flow_required: "No Flow",
  subflow_flow_missing: "Missing Flow",
  flow_scope_mismatch: "Not placeable",
  subflow_ending_required: "No ending",
  subflow_exit_missing: "Missing exit",
  subflow_cycle: "Loop",
  subflow_capture_bytes_exceeded: "Over capture limit",
  subflow_expanded_blocks_exceeded: "Over block limit",
  subflow_expanded_connections_exceeded: "Over wire limit",
};

export const issueTag = (issue: ValidationIssue) => ISSUE_TAGS[issue.code] ?? "Not ready";

/** One readiness issue of a Block, with the part of the Block its path names (`duration`, `rules.0`). */
export type BlockIssue = { readonly issue: ReadinessIssue; readonly field: string };

export type ReadinessMarks = {
  readonly blocks: ReadonlyMap<string, readonly BlockIssue[]>;
  readonly flowInput: ValidationIssue | null;
  readonly unconnectedOutputs: ReadonlySet<string>;
  readonly finish: readonly BlockIssue[];
  readonly unconnectedEndings: ReadonlySet<string>;
};

const noMarks: ReadinessMarks = {
  blocks: new Map(),
  flowInput: null,
  unconnectedOutputs: new Set(),
  finish: [],
  unconnectedEndings: new Set(),
};

const UNCONNECTED_OUTPUT_CODES = new Set([
  "condition_output_unconnected",
  "join_output_unconnected",
]);

export const outputKey = (blockId: string, outputId: string) => `${blockId}\u0000${outputId}`;

function unconnectedOutput(block: FlowGraph["blocks"][number], field: string) {
  if (block.kind === "join") return JOIN_OUTPUT.id;
  if (block.kind !== "condition") return undefined;
  const rule = /^rules\.(\d+)/.exec(field)?.[1];
  return rule === undefined ? block.otherwise.id : block.rules[Number(rule)]?.id;
}

/** The Block an issue path names, and the part of it within that Block. */
function issueBlock(issue: ValidationIssue, graph: FlowGraph) {
  const own = /^graph\.blocks\.(\d+)\.?(.*)$/.exec(issue.path);
  const block = own ? graph.blocks[Number(own[1])] : undefined;
  if (block) return { block, field: own?.[2] ?? "" };
  const selection = issueSelection(issue.path, graph);
  const selected = selection ? graph.blocks.find((b) => b.id === selection) : undefined;
  return selected ? { block: selected, field: "" } : null;
}

function finishMarks(issues: readonly ValidationIssue[], graph: FlowGraph) {
  const finish: BlockIssue[] = [];
  const unconnectedEndings = new Set<string>();
  for (const issue of issues) {
    const own = /^graph\.finish\.?(.*)$/.exec(issue.path);
    if (!own) continue;
    finish.push({ issue, field: own[1] ?? "" });
    const ending = issueEnding(issue.path, graph);
    if (issue.code === "ending_unconnected" && ending) unconnectedEndings.add(ending);
  }
  return { finish, unconnectedEndings };
}

export function readinessMarks(readiness: FlowReadiness | null, graph: FlowGraph): ReadinessMarks {
  if (!readiness?.issues.length) return noMarks;
  const blocks = new Map<string, BlockIssue[]>();
  const unconnectedOutputs = new Set<string>();
  const flowInput = readiness.issues.find((issue) => issue.code === "flow_input_required") ?? null;
  for (const issue of readiness.issues) {
    const found = issue === flowInput ? null : issueBlock(issue, graph);
    if (!found) continue;
    const { block, field } = found;
    blocks.set(block.id, [...(blocks.get(block.id) ?? []), { issue, field }]);
    const output = UNCONNECTED_OUTPUT_CODES.has(issue.code)
      ? unconnectedOutput(block, field)
      : undefined;
    if (output) unconnectedOutputs.add(outputKey(block.id, output));
  }
  return { blocks, flowInput, unconnectedOutputs, ...finishMarks(readiness.issues, graph) };
}

/** The first issue whose path is within this settings field. */
export function fieldProblem(issues: readonly BlockIssue[], field: string) {
  return issues.find((item) => item.field === field || item.field.startsWith(`${field}.`))?.issue;
}

/** The readiness tag a settings field shows. */
export function fieldIssue(issues: readonly BlockIssue[], field: string) {
  const problem = fieldProblem(issues, field);
  return problem ? issueTag(problem) : null;
}

/** A save refusal's issue as a link that selects the block its path names. */
export function IssueLink({
  issue,
  graph,
  onSelect,
  children,
}: {
  issue: ValidationIssue;
  graph: FlowGraph;
  onSelect: IssueSelect;
  children: ReactNode;
}) {
  return (
    <TextLink
      tone="neutral"
      className="block text-left text-xs font-normal"
      onClick={() => selectIssue(issue, graph, onSelect)}
    >
      {children}
    </TextLink>
  );
}

/** Readiness as last known; a check in progress keeps the previous answer shown. */
export function useShownReadiness(readiness: FlowReadiness | null) {
  const [shown, setShown] = useState(readiness);
  if (readiness && readiness !== shown) setShown(readiness);
  return readiness ?? shown;
}

type PagedFindings = {
  readonly forCursor: string;
  readonly issues: readonly ReadinessIssue[];
  readonly nextCursor: string | undefined;
  readonly error: string;
};

async function fetchFindingsPage(
  flowId: string,
  rootCursor: string,
  nextCursor: string,
  previous: readonly ReadinessIssue[],
  draftInput: UpdateFlowInput | undefined,
): Promise<PagedFindings> {
  try {
    const page = await api.listFlowFindings(flowId, {
      cursor: nextCursor,
      ...(draftInput ? { draft: draftInput } : {}),
    });
    return {
      forCursor: rootCursor,
      issues: [...previous, ...page.issues],
      nextCursor: page.cursor,
      error: "",
    };
  } catch (cause) {
    return {
      forCursor: rootCursor,
      issues: previous,
      nextCursor,
      error: cause instanceof Error ? cause.message : "Could not load more findings.",
    };
  }
}

function usePagedFindings({
  flowId,
  readiness,
  folderMissing,
  draftInput,
}: {
  flowId: string;
  readiness: FlowReadiness | null;
  folderMissing: string | null;
  draftInput: UpdateFlowInput | undefined;
}) {
  const [paged, setPaged] = useState<PagedFindings | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const baseIssues: readonly ReadinessIssue[] = folderMissing
    ? [{ code: "project_folder_missing", path: "", message: folderMissing }]
    : (readiness?.issues ?? []);
  const rootCursor = folderMissing ? undefined : readiness?.cursor;
  const active = rootCursor && paged?.forCursor === rootCursor ? paged : null;
  const issues = active ? [...baseIssues, ...active.issues] : baseIssues;
  const nextCursor = active ? active.nextCursor : rootCursor;
  const baseOmitted = folderMissing
    ? 0
    : (readiness?.omitted?.reduce((sum, entry) => sum + entry.count, 0) ?? 0);
  const omittedTotal = Math.max(0, baseOmitted - (active?.issues.length ?? 0));

  async function loadMore() {
    if (!nextCursor || !rootCursor || loadingMore) return;
    setLoadingMore(true);
    const next = await fetchFindingsPage(
      flowId,
      rootCursor,
      nextCursor,
      active?.issues ?? [],
      draftInput,
    );
    setPaged(next);
    setLoadingMore(false);
  }

  return { issues, omittedTotal, nextCursor, loadingMore, error: active?.error ?? "", loadMore };
}

function ReadinessIssueList({
  issues,
  folderMissing,
  graph,
  flows,
  onSelect,
  newAgent,
  omittedTotal,
  nextCursor,
  loadingMore,
  error,
  onLoadMore,
}: {
  issues: readonly ReadinessIssue[];
  folderMissing: string | null;
  graph: FlowGraph;
  flows: readonly FlowDraft[];
  onSelect: IssueSelect;
  newAgent: ReactNode;
  omittedTotal: number;
  nextCursor: string | undefined;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}) {
  const flowIds = new Set(flows.map((flow) => flow.id));
  return (
    <Surface tone="floating" asChild className="grid max-h-[60vh] overflow-y-auto">
      <ul id="flow-readiness" aria-label="Readiness issues">
        {issues.map((issue, index) => (
          <li key={index} className="flex items-center border-b last:border-b-0">
            <IssueRow
              issue={issue}
              selectable={!folderMissing}
              onSelect={() => selectIssue(issue, graph, onSelect)}
            />
            {issue.nested && flowIds.has(issue.nested.flowId) && (
              <TextLink asChild className="shrink-0 pr-3 text-xs">
                <StudioLink selection={{ tab: "flows", flowId: issue.nested.flowId }}>
                  Open Flow
                </StudioLink>
              </TextLink>
            )}
            {issue.code === "flow_input_required" && newAgent}
          </li>
        ))}
        {omittedTotal > 0 && nextCursor && (
          <li className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {omittedTotal} more {omittedTotal === 1 ? "finding" : "findings"} not shown
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </li>
        )}
        {error && (
          <li role="alert" className="px-4 py-2 text-xs text-destructive">
            {error}
          </li>
        )}
      </ul>
    </Surface>
  );
}

/**
 * The live readiness summary at the canvas's top left: Ready, or Not ready with its issue count
 * opening one row per issue. Each row selects its Block; a missing Project folder is the one
 * reason and names no Block. `newAgent`, when given, is offered on the Flow input issue.
 */
export function ReadinessPanel({
  readiness,
  folderMissing,
  graph,
  flowId,
  flows,
  draftInput,
  onSelect,
  newAgent,
}: {
  /** The last known readiness; null before the first answer. */
  readiness: FlowReadiness | null;
  /** Why the owning Project's folder can't be used on this machine; null when it can. */
  folderMissing: string | null;
  graph: FlowGraph;
  flowId: string;
  flows: readonly FlowDraft[];
  draftInput?: UpdateFlowInput | undefined;
  onSelect: IssueSelect;
  newAgent: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const findings = usePagedFindings({ flowId, readiness, folderMissing, draftInput });
  if (!readiness && !folderMissing) return null;
  const position = "absolute top-4 left-4 z-[5]";
  if (!findings.issues.length)
    return (
      <div className={position}>
        <StatusBadge kind="success">Ready</StatusBadge>
      </div>
    );
  const totalCount = findings.issues.length + findings.omittedTotal;
  return (
    <div className={cn(position, "grid w-110 max-w-[calc(100%-2rem)] gap-2")}>
      <Surface
        tone="floating"
        asChild
        className="flex h-7 w-fit items-center gap-2 pr-2 pl-1 text-xs text-foreground outline-none hover:bg-accent focus-ring aria-expanded:border-primary"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="flow-readiness"
          onClick={() => setOpen(!open)}
        >
          <StatusBadge kind="error">Not ready</StatusBadge>
          {totalCount} {totalCount === 1 ? "issue" : "issues"}
          <ChevronDown aria-hidden className={cn("size-3.5", open && "rotate-180")} />
        </button>
      </Surface>
      {open && (
        <ReadinessIssueList
          issues={findings.issues}
          folderMissing={folderMissing}
          graph={graph}
          flows={flows}
          onSelect={onSelect}
          newAgent={newAgent}
          omittedTotal={findings.omittedTotal}
          nextCursor={findings.nextCursor}
          loadingMore={findings.loadingMore}
          error={findings.error}
          onLoadMore={() => void findings.loadMore()}
        />
      )}
    </div>
  );
}

function IssueRow({
  issue,
  selectable,
  onSelect,
}: {
  issue: ValidationIssue;
  selectable: boolean;
  onSelect: () => void;
}) {
  const content = (
    <>
      <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">{issue.message}</span>
    </>
  );
  const row = "flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left text-sm text-foreground";
  if (!selectable) return <p className={row}>{content}</p>;
  return (
    <button
      type="button"
      className={cn(row, "outline-none hover:bg-accent focus-ring focus-visible:ring-inset")}
      onClick={onSelect}
    >
      {content}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
