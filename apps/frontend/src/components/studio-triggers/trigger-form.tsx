import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { FactoryProject, FlowDraft, TriggerReadiness } from "@t3-factory/contracts";
import { mayStartFlow } from "@t3-factory/domain-validation";
import { StatusBadge } from "../status-badge.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FlowGroup, ProjectOption } from "../launch-picker-options.tsx";
import { fieldLabelClass, selectFieldClass } from "../page.tsx";
import { SettingsRow } from "../settings-page.tsx";
import { cn } from "@/lib/utils";
import {
  triggerFlows,
  type IntervalUnit,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../../trigger-draft.ts";

const inputClass = "h-7.5 border-border bg-muted";
const rowClass = "[&>div]:min-h-13.5 [&>div]:py-3";

export const triggerProblemIds = {
  name: "trigger-name-problem",
  query: "trigger-query-problem",
  repository: "trigger-repository-problem",
  flow: "trigger-flow-problem",
  interval: "trigger-interval-problem",
  limit: "trigger-limit-problem",
} as const;

/** The Flow remains named in its field when live Studio changes make it unusable. */
export function chosenFlowProblem(
  content: TriggerDraftSnapshot["content"],
  flows: readonly FlowDraft[] | null,
) {
  if (!content.flowId || !flows) return undefined;
  const flow = flows.find((entry) => entry.id === content.flowId);
  if (!flow) return "Choose a saved Flow.";
  if (!mayStartFlow(flow.projectId, content.projectId))
    return "Choose a global Flow or a Flow of the Trigger’s Project.";
  return flow.readiness.ready
    ? undefined
    : flow.readiness.issues.map((issue) => issue.message).join(" ");
}

function fieldProblem(id: string, error: boolean) {
  return { "aria-invalid": error, "aria-describedby": id };
}

/** Figma T03/T05/T08: the GitHub Issues fields shared by create and edit. */
export function TriggerFields({
  draft,
  state,
  projects,
  flows,
  readiness,
  flowProblem,
  repositoryProblem,
  movedRepository,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  projects: readonly FactoryProject[];
  flows: readonly FlowDraft[] | null;
  readiness: TriggerReadiness | undefined;
  flowProblem: string | undefined;
  repositoryProblem: string | undefined;
  movedRepository: TriggerDraftSnapshot["content"]["repository"];
}) {
  const { content } = state;
  const project = projects.find((entry) => entry.id === content.projectId);

  return (
    <>
      <TriggerGroup label="Source" id="trigger-source">
        <SettingsRow
          title="Name"
          control={(text) => (
            <>
              {state.nameTaken && <StatusBadge kind="error">Already used</StatusBadge>}
              <Input
                aria-labelledby={text.title}
                {...(state.nameTaken && fieldProblem(triggerProblemIds.name, true))}
                className={cn(inputClass, "w-60")}
                maxLength={200}
                value={content.name}
                onChange={(event) => draft.edit({ name: event.target.value })}
              />
            </>
          )}
        />
        <ProjectRow
          project={project}
          projects={projects}
          projectId={content.projectId}
          onChange={(projectId) => draft.chooseProject(projectId, flows ?? [])}
        />
        <SettingsRow
          title="Repository"
          control={
            <RepositoryValue
              state={state}
              detecting={!readiness}
              problem={repositoryProblem}
              moved={movedRepository}
              onConfirm={draft.confirmRepository}
            />
          }
        />
        <QueryRow draft={draft} state={state} readiness={readiness} />
      </TriggerGroup>
      <TriggerGroup label="Run" id="trigger-run">
        <FlowRow
          content={content}
          project={project}
          flows={flows}
          problem={flowProblem}
          onChange={(flowId) => draft.edit({ flowId })}
        />
        <SettingsRow
          title="Run on a schedule"
          control={(text) => (
            <>
              {state.intervalError && <StatusBadge kind="error">Out of range</StatusBadge>}
              <Switch
                aria-labelledby={text.title}
                checked={content.scheduleEnabled}
                onCheckedChange={(scheduleEnabled) => draft.edit({ scheduleEnabled })}
              />
              <span className="text-sm text-muted-foreground">every</span>
              <Input
                aria-label="Check interval"
                {...(state.intervalError && fieldProblem(triggerProblemIds.interval, true))}
                inputMode="numeric"
                className={cn(inputClass, "w-13 font-mono text-label")}
                value={content.interval}
                disabled={!content.scheduleEnabled && !state.intervalError}
                onChange={(event) => draft.edit({ interval: event.target.value })}
              />
              <NativeSelect
                aria-label="Interval unit"
                className={cn(inputClass, "focus:border-primary")}
                wrapperClassName="w-28"
                value={content.unit}
                disabled={!content.scheduleEnabled && !state.intervalError}
                onChange={(event) => draft.edit({ unit: event.target.value as IntervalUnit })}
              >
                <NativeSelectOption value="minutes">minutes</NativeSelectOption>
                <NativeSelectOption value="hours">hours</NativeSelectOption>
              </NativeSelect>
            </>
          )}
        />
        <SettingsRow
          title="Max active Runs"
          control={(text) => (
            <>
              {state.limitError && <StatusBadge kind="error">Out of range</StatusBadge>}
              <Input
                aria-labelledby={text.title}
                {...(state.limitError && fieldProblem(triggerProblemIds.limit, true))}
                inputMode="numeric"
                className={cn(inputClass, "w-16 font-mono text-label")}
                value={content.maxActiveRuns}
                onChange={(event) => draft.edit({ maxActiveRuns: event.target.value })}
              />
            </>
          )}
        />
      </TriggerGroup>
    </>
  );
}

function ProjectRow({
  project,
  projects,
  projectId,
  onChange,
}: {
  project: FactoryProject | undefined;
  projects: readonly FactoryProject[];
  projectId: string;
  onChange: (id: string) => void;
}) {
  const available = projects.filter((entry) => entry.availability === "available");
  const projectNames = available.map((entry) => entry.title);
  return (
    <SettingsRow
      title="Project"
      control={(text) => (
        <ChoiceMenu
          labelledBy={text.title}
          value={projectId}
          label={project?.title ?? (projectId ? "Project unavailable" : undefined)}
          placeholder="Choose a Project"
          width="w-80"
          onChange={onChange}
        >
          {available.map((entry) => (
            <ProjectOption key={entry.id} project={entry} busy={false} peers={projectNames} />
          ))}
          {!available.length && <EmptyChoices>No available Projects</EmptyChoices>}
        </ChoiceMenu>
      )}
    />
  );
}

function RepositoryValue({
  state,
  detecting,
  problem,
  moved,
  onConfirm,
}: {
  state: TriggerDraftSnapshot;
  detecting: boolean;
  problem: string | undefined;
  moved: TriggerDraftSnapshot["content"]["repository"];
  onConfirm: (repository: NonNullable<typeof moved>) => void;
}) {
  const repository = moved ?? state.content.repository;
  if (problem)
    return (
      <div
        role="group"
        aria-label="Repository"
        {...fieldProblem(triggerProblemIds.repository, true)}
      >
        <StatusBadge kind="error">Can’t read</StatusBadge>
      </div>
    );
  if (!repository)
    return (
      <span className="text-sm text-muted-foreground">
        {state.content.projectId && detecting ? "Detecting…" : "—"}
      </span>
    );
  return (
    <>
      <StatusBadge kind={moved ? "attention" : "info"}>
        {moved ? "Detected now" : "Detected"}
      </StatusBadge>
      <span className="text-sm">{repository.nameWithOwner}</span>
      {moved && (
        <Button
          variant="outline"
          size="sm"
          {...fieldProblem("trigger-status-detail", false)}
          onClick={() => onConfirm(moved)}
        >
          Confirm
        </Button>
      )}
    </>
  );
}

function FlowRow({
  content,
  project,
  flows,
  problem,
  onChange,
}: {
  content: TriggerDraftSnapshot["content"];
  project: FactoryProject | undefined;
  flows: readonly FlowDraft[] | null;
  problem: string | undefined;
  onChange: (id: string) => void;
}) {
  const flow = flows?.find((entry) => entry.id === content.flowId);
  const offered = flows ? triggerFlows(flows, content.projectId) : [];
  const flowNames = offered.map((entry) => entry.name);
  const ordered = (group: readonly FlowDraft[]) =>
    group.toSorted((a, b) => Number(b.readiness.ready) - Number(a.readiness.ready));
  return (
    <SettingsRow
      title="Flow"
      control={(text) => (
        <>
          {problem && <StatusBadge kind="error">Not ready</StatusBadge>}
          <ChoiceMenu
            labelledBy={text.title}
            value={content.flowId}
            label={flow?.name ?? (content.flowId ? "Flow unavailable" : undefined)}
            placeholder="Choose a Flow"
            width="w-75"
            problemId={problem ? triggerProblemIds.flow : undefined}
            onChange={onChange}
          >
            <FlowGroup
              title="Global"
              flows={ordered(offered.filter((entry) => !entry.projectId))}
              busy={false}
              peers={flowNames}
            />
            {project && (
              <FlowGroup
                title={project.title}
                flows={ordered(offered.filter((entry) => entry.projectId === project.id))}
                busy={false}
                peers={flowNames}
              />
            )}
            {!offered.length && (
              <EmptyChoices>{flows ? "No Flows available" : "Loading Flows…"}</EmptyChoices>
            )}
          </ChoiceMenu>
        </>
      )}
    />
  );
}

function TriggerGroup({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3 id={id} className={cn(fieldLabelClass, "pl-0.5")}>
        {label}
      </h3>
      <div className={cn("divide-y rounded-lg border", rowClass)}>{children}</div>
    </section>
  );
}

function EmptyChoices({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function ChoiceMenu({
  labelledBy,
  value,
  label,
  placeholder,
  width,
  problemId,
  onChange,
  children,
}: {
  labelledBy: string;
  value: string;
  label: string | undefined;
  placeholder: string;
  width: string;
  problemId?: string | undefined;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-labelledby={labelledBy}
          {...(problemId && fieldProblem(problemId, true))}
          className={cn(selectFieldClass, "h-7.5 w-50 justify-between border-border")}
        >
          <span className={cn("truncate", !label && "text-subtle-foreground")}>
            {label ?? placeholder}
          </span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(
          width,
          "max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[calc(100vw-2rem)] overflow-y-auto",
        )}
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {children}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function queryWarning(state: TriggerDraftSnapshot, readiness: TriggerReadiness | undefined) {
  const repository = readiness?.repository;
  return (
    !("error" in state.query) &&
    !state.query.authorFilter &&
    repository?.ready === true &&
    repository.repository.visibility === "public" &&
    repository.repository.nodeId === state.content.repository?.nodeId
  );
}

function QueryRow({
  draft,
  state,
  readiness,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  readiness: TriggerReadiness | undefined;
}) {
  const { query, content } = state;
  const error = "error" in query;
  const missingLabel = error && query.code === "trigger_query_label_missing";
  const warning = queryWarning(state, readiness);
  const login = readiness?.gitHub.ready ? readiness.gitHub.login : undefined;
  const hint = "trigger-query-label";
  const description = error
    ? triggerProblemIds.query
    : warning
      ? `${triggerProblemIds.query} ${hint}`
      : hint;
  return (
    <div className="grid gap-1.5 px-4 text-sm leading-tight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="trigger-query" className="font-medium">
          GitHub issue query
        </label>
        {error && (
          <StatusBadge kind="error">
            {missingLabel ? "No ready label" : "Invalid query"}
          </StatusBadge>
        )}
        {warning && <StatusBadge kind="attention">No author filter</StatusBadge>}
      </div>
      <Input
        id="trigger-query"
        {...fieldProblem(description, error)}
        className={cn(inputClass, "font-mono text-label", warning && "border-attention")}
        value={content.query}
        onChange={(event) => draft.edit({ query: event.target.value })}
      />
      {!error && (
        <p id={hint} className="text-xs text-muted-foreground">
          Ready label <code>{query.readyLabel}</code>
          {login && (
            <>
              {" "}
              · <code>@me</code> is <code>{login}</code>
            </>
          )}
        </p>
      )}
    </div>
  );
}
