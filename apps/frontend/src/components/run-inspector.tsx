import { stoppedVisitAt } from "../run-status.ts";
import { useState } from "react";
import { OpenInT3 } from "./open-in-t3.tsx";
import type {
  FactoryProject,
  FlowBlock,
  RunBlock,
  RunDetail,
  RunTitleGeneration,
} from "@t3-factory/contracts";
import {
  CircleCheck,
  CirclePause,
  CircleStop,
  GitBranch,
  LoaderCircle,
  MessageCircleQuestionMark,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { conditionActivityText } from "../condition-arrivals.ts";
import {
  attentionActivityText,
  blockActivityText,
  blockVisits,
  continuationPromptVisit,
  threadOwnerName,
} from "./execution-canvas.tsx";
import { ExecutionStateBadge } from "./execution-state.tsx";
import { clockTime, fullDateTime } from "../time-format.ts";
import { RUN_STATE_LABELS, type RunStateKind } from "./status-badge.tsx";
import { blockStateKind, reviewInT3Since } from "../run-block-state.ts";
import { PanelResizeHandle, type PanelBounds } from "./panel-resize.tsx";
import { ResolvedAttention, RunAttentionDetails } from "./run-attention.tsx";
import { RootWork } from "./run-coordination-controls.tsx";
import { BindingLink, bindingRole, CoordinatorActivations } from "./run-coordination.tsx";
import { RunInitialPrompt } from "./run-prompt.tsx";
import { BranchName, repositorySummary, RunRepositories } from "./run-repositories.tsx";
import { Disclosure } from "./disclosure.tsx";
import { InspectorSection } from "./inspector-section.tsx";
import { activeStates, currentVisitText, RunBlockView } from "./run-block-view.tsx";
import { RunTitleView } from "./run-title-view.tsx";
import { RunOriginSection } from "./run-origin.tsx";

/** Keeps the width users chose for the earlier Run side panels. */
const inspectorBounds: PanelBounds = {
  variable: "--factory-run-panel-width",
  storageKey: "factory.runSidePanelWidth",
  min: 280,
  max: 640,
};

const secondaryTextClass = "text-xs text-muted-foreground";

const stateIcon: Record<RunStateKind, { Icon: LucideIcon; className: string }> = {
  working: { Icon: LoaderCircle, className: "text-status-working motion-safe:animate-spin" },
  waiting: { Icon: CirclePause, className: "text-status-waiting" },
  "needs-input": { Icon: MessageCircleQuestionMark, className: "text-attention" },
  finished: { Icon: CircleCheck, className: "text-success" },
  problem: { Icon: TriangleAlert, className: "text-destructive" },
  stopped: { Icon: CircleStop, className: "text-status-stopped" },
};

/** Progress counts in this order, as "2 finished · 1 needs input". */
const countOrder: readonly RunStateKind[] = [
  "finished",
  "working",
  "waiting",
  "needs-input",
  "problem",
  "stopped",
];

const since = (at: string | null | undefined) => (at ? ` · since ${clockTime(at)}` : "");

/** The Continuation whose prompt `block`'s thread works on, while one is sent. */
function sentContinuation(run: RunDetail, blockId: string) {
  const ownBindings = new Set(
    run.threadBindings.filter((binding) => binding.blockId === blockId).map((b) => b.id),
  );
  const prompt = run.continuationVisits.find(
    (visit) =>
      visit.kind === "prompt" &&
      visit.bindingId !== null &&
      ownBindings.has(visit.bindingId) &&
      run.blocks.find((item) => item.blockId === visit.blockId)?.state === "sent",
  );
  return prompt && run.definitions.flow.graph.blocks.find((item) => item.id === prompt.blockId);
}

function stoppedProgress(run: RunDetail, end: string | null | undefined) {
  const at = stoppedVisitAt(run, end);
  return at ? `Stopped · ${clockTime(at)}` : "Stopped";
}

/** A Continuation's prompt in its worker's thread, or the Agent whose thread works on one. */
function continuationProgress(run: RunDetail, block: FlowBlock, recorded: RunBlock) {
  if (block.kind === "continuation" && recorded.state === "sent") {
    const prompt = continuationPromptVisit(run, block.id);
    const owner = threadOwnerName(run, prompt?.bindingId ?? null);
    return `Sent to ${owner ? `${owner}’s` : "its worker’s"} thread${prompt ? ` · ${clockTime(prompt.arrivedAt)}` : ""}`;
  }
  const continuation = recorded.state === "working" && sentContinuation(run, block.id);
  return continuation
    ? `Working on ${continuation.name}${since(continuationPromptVisit(run, continuation.id)?.arrivedAt)}`
    : null;
}

/** A started Block's status line: what it is doing now, or the exit it took and when. */
function progressLine(run: RunDetail, block: FlowBlock, recorded: RunBlock, kind: RunStateKind) {
  const visits = blockVisits(run, block);
  const latest = visits.at(-1);
  const attention = attentionActivityText(run, block, recorded);
  if (attention) return attention;
  if (recorded.state === "stopped") return stoppedProgress(run, latest?.end);
  if (block.kind === "condition") return conditionActivityText(run, block.id);
  if (kind === "needs-input")
    return block.kind === "human"
      ? `Waiting for your decision${since(latest?.start)}`
      : `Review in T3${since(reviewInT3Since(run, recorded))}`;
  const continuation = continuationProgress(run, block, recorded);
  if (continuation) return continuation;
  if (activeStates.includes(recorded.state)) return currentVisitText(run, block, visits);
  return blockActivityText(run, block, recorded);
}

/** Figma RD13 Progress: started blocks in Flow order, each with its status on a second line that
 * wraps rather than truncates; the canvas still shows the whole graph. */
function RunProgress({ run, waitingForWorkers }: { run: RunDetail; waitingForWorkers: boolean }) {
  const started = run.definitions.flow.graph.blocks.flatMap((block) => {
    const recorded = run.blocks.find((item) => item.blockId === block.id);
    const kind = blockStateKind(run, recorded);
    return recorded && kind ? [{ block, recorded, kind }] : [];
  });
  if (!started.length) return null;
  const count = countOrder
    .map((kind) => [kind, started.filter((item) => item.kind === kind).length] as const)
    .filter(([, total]) => total > 0)
    .map(([kind, total]) => `${total} ${RUN_STATE_LABELS[kind].toLowerCase()}`)
    .join(" · ");
  return (
    <InspectorSection
      title="Progress"
      count={waitingForWorkers ? `${count} · waiting for T3 to confirm workers finished` : count}
      label="Progress"
    >
      <ul className="-mt-1 flex flex-col gap-1">
        {started.map(({ block, recorded, kind }) => {
          const icon = stateIcon[kind];
          const status = progressLine(run, block, recorded, kind);
          const outcome =
            status.startsWith("→ ") ||
            (recorded.state === "stopped" && status.startsWith("Stopped"));
          return (
            <li
              key={block.id}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5",
                kind !== "finished" && kind !== "stopped" && "bg-muted",
              )}
            >
              <icon.Icon
                aria-hidden
                strokeWidth={1.75}
                className={cn("mt-0.5 size-3.5 shrink-0", icon.className)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium break-words text-foreground">
                  <span className="sr-only">{RUN_STATE_LABELS[kind]}: </span>
                  {block.name}
                </span>
                <span
                  className={cn(
                    "text-xs break-words",
                    outcome ? "text-foreground" : "text-subtle-foreground",
                  )}
                >
                  {status}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}

/** Figma RD39 and RD41: the branch of a worktree Run, or that T3 is still preparing it. */
function RunBranch({ run }: { run: RunDetail }) {
  const { workspace } = run;
  if (workspace.mode !== "worktree" || workspace.state === "failed") return null;
  const bound = workspace.state === "bound" ? workspace.branch : null;
  return (
    <InspectorSection title="Branch" label="Run branch">
      <div className="flex min-w-0 items-start gap-2">
        <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          {bound ? (
            <BranchName branch={bound} />
          ) : (
            <p className="text-sm text-foreground">Preparing worktree</p>
          )}
          <p className="text-xs text-subtle-foreground">
            {bound ? `Own worktree from ${workspace.baseRef}` : `From ${workspace.baseRef}`}
          </p>
        </div>
      </div>
    </InspectorSection>
  );
}

/** Worker repositories besides the Run's own worktree branch, which its Branch section shows. */
function otherRepositories(run: RunDetail) {
  const own = run.workspace.mode === "worktree" ? run.workspace.branch : null;
  return run.repositories.map((worker) =>
    own && worker.branch === own ? { ...worker, branch: null } : worker,
  );
}

function repositoriesTitle(run: RunDetail) {
  const { branches, pullRequests } = repositorySummary(otherRepositories(run));
  const title = [
    branches.length && (branches.length > 1 ? "branches" : "branch"),
    pullRequests.length && (pullRequests.length > 1 ? "pull requests" : "pull request"),
  ]
    .filter(Boolean)
    .join(" and ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const longPrompt = (input: string) => input.length > 180 || input.split("\n").length > 3;

/** A long text prompt starts as a preview; prompts with images keep their references in view. */
function InitialPrompt({ run }: { run: RunDetail }) {
  const collapsible = !run.images.length && longPrompt(run.input);
  const [full, setFull] = useState(false);
  return (
    <InspectorSection title="Initial prompt" label="Run input">
      <RunInitialPrompt run={run} preview={collapsible && !full} />
      {collapsible && (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="w-fit text-label"
          aria-expanded={full}
          onClick={() => setFull(!full)}
        >
          {full ? "Show less" : "Show full prompt"}
        </Button>
      )}
    </InspectorSection>
  );
}

const worktreeNote = {
  preparing: ". Other workers join it once T3 reports its path and branch.",
  bound: ", shared by every worker of this Run.",
  failed: ". No worker falls back to the project checkout.",
};

/** The workspace every worker of the Run shares, as T3 reported it. A worktree T3 could not create
 * is the Run's Attention card, not a fact here. */
function RunWorkspace({ run }: { run: RunDetail }) {
  const { workspace } = run;
  if (workspace.mode === "checkout")
    return (
      <InspectorSection title="Workspace" label="Run workspace">
        <p className="text-sm text-emphasis-foreground">Project checkout</p>
      </InspectorSection>
    );
  return (
    <InspectorSection title="Workspace" label="Run workspace">
      {workspace.state === "bound" && (
        <p className="flex min-w-0 items-start gap-1.5 text-sm text-emphasis-foreground">
          <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 break-all">
            Worktree · <span className="font-mono text-xs">{workspace.branch}</span> ·{" "}
            <span className="font-mono text-xs">{workspace.path}</span>
          </span>
        </p>
      )}
      {workspace.state === "preparing" && (
        <p className="text-sm text-emphasis-foreground">Preparing worktree</p>
      )}
      {workspace.state === "failed" && (
        <p className="text-sm text-emphasis-foreground">Worktree not created</p>
      )}
      <p className={secondaryTextClass}>
        New worktree from {workspace.baseRef}
        {worktreeNote[workspace.state]}
      </p>
    </InspectorSection>
  );
}

function PendingIntents({ run }: { run: RunDetail }) {
  const intents = run.intents.filter(
    (intent) => intent.state !== "acknowledged" && intent.state !== "cancelled",
  );
  if (!intents.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {intents.map((intent) => (
        <p
          role="status"
          key={intent.id}
          className="rounded-md border border-attention/40 bg-attention/8 p-3 text-xs text-emphasis-foreground"
        >
          {intent.state === "pending" ? `${intent.kind} pending` : `Uncertain ${intent.kind}`}:{" "}
          {intent.kind === "handoff" && intent.state === "pending"
            ? (intent.problem ?? "Handoff held; delivery has not started.")
            : (intent.problem ?? "Awaiting the exact T3 reference.")}
        </p>
      ))}
    </div>
  );
}

function elapsedSeconds(from: string, to: string) {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000).toFixed(1);
}

function observedTime(at: string | null | undefined) {
  return at ? fullDateTime(at) : "not yet observed";
}

function WorkPeriods({ run }: { run: RunDetail }) {
  if (!run.executions.length) return null;
  return (
    <InspectorSection title="Work periods" label="Work periods">
      {run.executions.map((execution) => {
        const block = run.blocks.find((item) => item.blockId === execution.blockId);
        const binding = run.threadBindings.find((item) => item.id === execution.bindingId);
        return (
          <article
            className="flex flex-col gap-1 rounded-md border bg-muted p-3 text-xs text-muted-foreground"
            key={`${execution.bindingId}/${execution.executionId}`}
            aria-label={`${binding ? bindingRole[binding.role] : "Agent"} · ${execution.executionId}`}
          >
            <h4 className="text-sm font-medium break-all text-foreground">
              {block?.name ?? execution.blockId} ·{" "}
              {binding ? `${bindingRole[binding.role]} · ` : ""}
              {execution.executionId}
            </h4>
            <p className="flex flex-wrap items-center gap-1">
              T3 execution: <ExecutionStateBadge state={execution.engineStatus ?? "unknown"} /> ·
              Report:{" "}
              {execution.reportStatus
                ? `accepted ${execution.reportStatus}`
                : binding?.role === "descendant"
                  ? "the worker reports the result"
                  : "not reported"}
            </p>
            {execution.problem && <p>Recorded Problem: {execution.problem}</p>}
            {run.recoveries
              .filter(
                (r) => r.blockId === execution.blockId && r.executionId === execution.executionId,
              )
              .map((r) => (
                <p key={r.attentionId}>
                  Manual report recovery for {r.sourceExecutionId} ·{" "}
                  {r.settledAt ? "reporting obligation settled" : "unresolved"}
                </p>
              ))}
            <p>
              Observed start: {observedTime(execution.observedStartedAt)} · Observed end:{" "}
              {observedTime(execution.observedEndedAt)}
            </p>
            {execution.observedStartedAt && execution.observedEndedAt && (
              <p>
                Approximate elapsed:{" "}
                {elapsedSeconds(execution.observedStartedAt, execution.observedEndedAt)} s
              </p>
            )}
            {binding ? (
              <>
                <p className="break-all">Thread: {binding.threadId}</p>
                <BindingLink binding={binding} />
              </>
            ) : (
              block?.link && <OpenInT3 href={block.link} className="text-xs" />
            )}
          </article>
        );
      })}
    </InspectorSection>
  );
}

/** Figma RD13: Run-level facts with one home; raw ids, workspace and periods stay folded. */
function RunOverview({
  run,
  project,
  projectUnavailable,
  waitingForWorkers,
}: {
  run: RunDetail;
  project: FactoryProject | undefined;
  projectUnavailable: boolean;
  waitingForWorkers: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5.5 overflow-auto px-4 pt-4 pb-3">
      <h2 className="text-base leading-4 font-semibold">Overview</h2>
      <RunAttentionDetails run={run} />
      <PendingIntents run={run} />
      <RunProgress run={run} waitingForWorkers={waitingForWorkers} />
      <RunBranch run={run} />
      {otherRepositories(run).some((worker) => worker.branch || worker.pullRequests.length > 0) && (
        <InspectorSection title={repositoriesTitle(run)} label="Run repositories">
          <RunRepositories
            workers={otherRepositories(run)}
            links
            historical={run.lifecycle === "settled"}
          />
        </InspectorSection>
      )}
      {run.origin && <RunOriginSection origin={run.origin} />}
      <InitialPrompt run={run} />
      <CoordinatorActivations run={run} conciseResults={run.lifecycle === "settled"} />
      <RootWork run={run} />
      <div aria-hidden className="flex-1" />
      <ResolvedAttention run={run} />
      <Disclosure label="Workspace & observation">
        <InspectorSection title="Project">
          <p className="text-sm text-emphasis-foreground">
            {project?.title ?? "Project"}
            {projectUnavailable ? " · Not in T3" : ""}
          </p>
        </InspectorSection>
        <InspectorSection title="Flow revision">
          <p className="text-sm text-emphasis-foreground">
            {run.definitions.flow.name} · revision {run.definitions.flow.revision}
          </p>
        </InspectorSection>
        <RunWorkspace run={run} />
        <WorkPeriods run={run} />
      </Disclosure>
    </div>
  );
}

/**
 * The one docked inspector beside the Execution canvas: the Run overview, the selected block or
 * the Run title. What is inspected is the caller's; whether the inspector is shown is the
 * viewer's preference.
 */
export function RunInspector({
  run,
  selected,
  titleGeneration,
  project,
  projectUnavailable,
  waitingForWorkers,
  observationUnavailable,
  onSelect,
}: {
  run: RunDetail;
  selected: string | null;
  /** The Run title's generation while the Run title is inspected. */
  titleGeneration: RunTitleGeneration | null;
  project: FactoryProject | undefined;
  projectUnavailable: boolean;
  waitingForWorkers: boolean;
  observationUnavailable: boolean;
  onSelect: (blockId: string | null) => void;
}) {
  const block = run.definitions.flow.graph.blocks.find((item) => item.id === selected);
  const recorded = run.blocks.find((item) => item.blockId === selected);
  return (
    <aside
      aria-label="Run inspector"
      className="relative flex w-[var(--factory-run-panel-width,21.25rem)] max-w-[50%] shrink-0 flex-col border-l bg-background"
    >
      <PanelResizeHandle label="Resize Run inspector" side="left" bounds={inspectorBounds} />
      {titleGeneration ? (
        <RunTitleView generation={titleGeneration} onBack={() => onSelect(null)} />
      ) : block && recorded ? (
        <RunBlockView
          run={run}
          block={block}
          recorded={recorded}
          observationUnavailable={observationUnavailable}
          onBack={() => onSelect(null)}
        />
      ) : (
        <RunOverview
          run={run}
          project={project}
          projectUnavailable={projectUnavailable}
          waitingForWorkers={waitingForWorkers}
        />
      )}
    </aside>
  );
}
