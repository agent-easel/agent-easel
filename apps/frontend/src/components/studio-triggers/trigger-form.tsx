import type { ReactNode } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { FactoryProject, FlowDraft, TriggerReadiness } from "@t3-factory/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsRow } from "../settings-page.tsx";
import {
  triggerFlows,
  type IntervalUnit,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../../trigger-draft.ts";
import type { useTriggerReadiness } from "./use-trigger-readiness.ts";

export type ReadinessRead = ReturnType<typeof useTriggerReadiness>;

const captionClass = "text-2xs leading-tight tracking-label text-subtle-foreground";

/**
 * Figma T03/T05/T08: the GitHub Issues fields shared by create and edit. The repository is
 * detected from the Project and confirmed by saving; the ready label and `@me` are derived.
 */
export function TriggerFields({
  draft,
  state,
  projects,
  flows,
  readiness,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  projects: readonly FactoryProject[] | undefined;
  flows: readonly FlowDraft[] | null;
  readiness: ReadinessRead;
}) {
  const { content } = state;
  return (
    <>
      <SettingsGroup label="Source">
        <SettingsRow
          title="Name"
          control={(text) => (
            <Input
              aria-labelledby={text.title}
              className="w-60 font-mono text-label"
              value={content.name}
              onChange={(event) => draft.edit({ name: event.target.value })}
            />
          )}
        />
        <SettingsRow
          title="Project"
          description="Triggers work with local Projects on the Factory host."
          control={(text) => (
            <Choice
              labelledBy={text.title}
              value={content.projectId}
              placeholder="Choose a Project"
              options={projects?.map((project) => ({ value: project.id, label: project.title }))}
              onChange={(projectId) => draft.chooseProject(projectId, flows ?? [])}
            />
          )}
        />
        <SettingsRow
          title="Repository"
          description="Detected from the Project. Confirm it is the repository whose issues should start Runs."
          control={<RepositoryValue draft={draft} state={state} readiness={readiness} />}
        />
        <QueryRow draft={draft} state={state} readiness={readiness} />
      </SettingsGroup>
      <SettingsGroup label="Run">
        <SettingsRow
          title="Flow"
          description="Each Start uses the Flow's current saved revision, like New Run."
          control={(text) => (
            <Choice
              labelledBy={text.title}
              value={content.flowId}
              placeholder="Choose a Flow"
              options={
                flows
                  ? triggerFlows(flows, content.projectId, content.flowId).map((flow) => ({
                      value: flow.id,
                      label: flow.name,
                    }))
                  : undefined
              }
              onChange={(flowId) => draft.edit({ flowId })}
            />
          )}
        />
        <SettingsRow
          title="Run on a schedule"
          description="When off, the Trigger runs only when you choose Run in the ⋯ menu. Missed checks are not replayed."
          control={(text) => (
            <>
              <Switch
                aria-labelledby={text.title}
                checked={content.scheduleEnabled}
                onCheckedChange={(scheduleEnabled) => draft.edit({ scheduleEnabled })}
              />
              <span className="text-sm text-muted-foreground">every</span>
              <Input
                aria-label="Check interval"
                inputMode="numeric"
                className="w-13 font-mono text-label"
                value={content.interval}
                disabled={!content.scheduleEnabled}
                onChange={(event) => draft.edit({ interval: event.target.value })}
              />
              <NativeSelect
                aria-label="Interval unit"
                wrapperClassName="w-28"
                value={content.unit}
                disabled={!content.scheduleEnabled}
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
          description="How many Runs from this Trigger may be in progress at once. Other matching issues wait for the next check."
          control={(text) => (
            <Input
              aria-labelledby={text.title}
              inputMode="numeric"
              className="w-16 font-mono text-label"
              value={content.maxActiveRuns}
              onChange={(event) => draft.edit({ maxActiveRuns: event.target.value })}
            />
          )}
        />
      </SettingsGroup>
    </>
  );
}

function Choice({
  labelledBy,
  value,
  placeholder,
  options,
  onChange,
}: {
  labelledBy: string;
  value: string;
  placeholder: string;
  options: readonly { value: string; label: string }[] | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      aria-labelledby={labelledBy}
      wrapperClassName="w-50"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {!value && (
        <NativeSelectOption value="">{options ? placeholder : "Loading…"}</NativeSelectOption>
      )}
      {options?.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Factory's answer about the chosen Project's repository, once it is for the current choice. */
function repositoryProblem(state: TriggerDraftSnapshot, readiness: ReadinessRead) {
  if (state.content.repository || !state.content.projectId) return null;
  if (readiness.status === "failed") return readiness.message;
  const repository = readiness.status === "answered" ? readiness.readiness.repository : null;
  return repository && !repository.ready ? repository.problem : null;
}

/** The repository the Project's folder names now, when it is not the one the form holds. */
function movedRepository(state: TriggerDraftSnapshot, readiness: ReadinessRead) {
  if (readiness.status !== "answered" || !state.content.repository) return null;
  const answer = readiness.readiness.repository;
  return answer?.ready && answer.repository.nodeId !== state.content.repository.nodeId
    ? answer.repository
    : null;
}

function RepositoryValue({
  draft,
  state,
  readiness,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  readiness: ReadinessRead;
}) {
  const { repository, projectId } = state.content;
  const problem = repositoryProblem(state, readiness);
  const moved = movedRepository(state, readiness);
  if (!repository)
    return (
      <p
        className={problem ? "max-w-60 text-sm text-destructive" : "text-sm text-muted-foreground"}
      >
        {problem ?? (projectId ? "Detecting…" : "Choose a Project first")}
      </p>
    );
  if (moved)
    return (
      <div className="grid max-w-80 justify-items-end gap-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="attention" className="gap-1.25 py-0.5 pr-2 pl-1.75">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            Detected now
          </Badge>
          <span className="text-sm font-medium text-foreground">{moved.nameWithOwner}</span>
        </div>
        <p className="text-right text-2xs leading-tight tracking-label text-attention">
          This Trigger confirmed {repository.nameWithOwner}, so its checks stop. Confirm{" "}
          {moved.nameWithOwner} only if its issues should start Runs.
        </p>
        <Button variant="outline" size="sm" onClick={() => draft.confirmRepository(moved)}>
          Confirm this repository
        </Button>
      </div>
    );
  return (
    <div className="grid justify-items-end gap-0.75">
      <div className="flex items-center gap-2">
        <Badge className="gap-1.25 border-transparent py-0.5 pr-2 pl-1.75">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          Detected
        </Badge>
        <span className="text-sm font-medium text-foreground">{repository.nameWithOwner}</span>
      </div>
      <p className={captionClass}>GitHub Issues · read with gh on the Factory host · no AI</p>
    </div>
  );
}

/** The repository visibility Factory reported for the repository the form holds, if any. */
function publicRepository(state: TriggerDraftSnapshot, readiness: ReadinessRead) {
  if (readiness.status !== "answered") return false;
  const answer = readiness.readiness.repository;
  return (
    !!answer?.ready &&
    answer.repository.nodeId === state.content.repository?.nodeId &&
    answer.repository.visibility === "public"
  );
}

function QueryRow({
  draft,
  state,
  readiness,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  readiness: ReadinessRead;
}) {
  const { query } = state;
  const gitHub = readiness.status === "answered" ? readiness.readiness.gitHub : null;
  const login = gitHub?.ready ? ` · @me is ${gitHub.login} right now` : "";
  const repository = state.content.repository?.nameWithOwner ?? "<repository>";
  return (
    <div className="grid gap-1.5 px-4 py-3 text-sm leading-tight">
      <label htmlFor="trigger-query" className="font-medium text-foreground">
        GitHub issue query
      </label>
      <p id="trigger-query-description" className="text-muted-foreground">
        Issues that match start a Run. It must contain one label: — that is the ready label. Keep it
        narrow on public repositories: issue templates can add labels for anyone.
      </p>
      <Input
        id="trigger-query"
        aria-describedby="trigger-query-description trigger-query-label"
        aria-invalid={"error" in query}
        className="font-mono text-label"
        value={state.content.query}
        onChange={(event) => draft.edit({ query: event.target.value })}
      />
      <p
        id="trigger-query-label"
        className={
          "error" in query ? "text-2xs leading-tight tracking-label text-destructive" : captionClass
        }
      >
        {"error" in query
          ? query.error
          : `Ready label: ${query.readyLabel} — the worker removes it when it claims the issue${login}`}
      </p>
      {"authorFilter" in query && !query.authorFilter && publicRepository(state, readiness) && (
        <p className="text-2xs leading-tight tracking-label text-attention">
          No author filter on a public repository: anyone&apos;s issue that gets the ready label can
          start a Run.
        </p>
      )}
      <p className={captionClass}>
        Always added: repo:{repository} is:issue is:open · Examples: author:alice · -label:wontfix ·
        reactions:&gt;=3
      </p>
    </div>
  );
}

function ReadinessItem({
  ready,
  label,
  detail,
}: {
  ready: boolean | null;
  label: string;
  detail: ReactNode;
}) {
  return (
    <li className="flex gap-2 py-1 text-sm leading-tight">
      <ReadinessIcon ready={ready} />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        <span className={ready === false ? "text-destructive" : "text-muted-foreground"}>
          {detail}
        </span>
      </span>
    </li>
  );
}

function ReadinessIcon({ ready }: { ready: boolean | null }) {
  if (ready === null)
    return (
      <CircleDashed
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
        strokeWidth={1.5}
      />
    );
  return ready ? (
    <CircleCheck aria-label="Ready" className="size-4 shrink-0 text-success" strokeWidth={1.5} />
  ) : (
    <CircleX
      aria-label="Not ready"
      className="size-4 shrink-0 text-destructive"
      strokeWidth={1.5}
    />
  );
}

function readinessItems(
  readiness: TriggerReadiness,
  state: TriggerDraftSnapshot,
  flows: readonly FlowDraft[] | null,
) {
  const { gitHub, repository, flow } = readiness;
  const flowName = flows?.find((entry) => entry.id === state.content.flowId)?.name ?? "";
  return [
    gitHub.ready
      ? {
          ready: true,
          label: `gh found · signed in as ${gitHub.login}`,
          detail: "GitHub CLI on the Factory host, as the host user",
        }
      : { ready: false, label: "gh is not ready", detail: gitHub.problem },
    repository === null
      ? { ready: null, label: "Repository", detail: "Choose a Project to check its repository." }
      : repository.ready
        ? {
            ready: true,
            label: `${repository.repository.nameWithOwner} readable`,
            detail: "Repository matches the Project remote",
          }
        : { ready: false, label: "Repository not readable", detail: repository.problem },
    flow === null
      ? { ready: null, label: "Flow", detail: "Choose a Flow to check it can start." }
      : flow.ready
        ? {
            ready: true,
            label: `Flow ${flowName} is ready`,
            detail: "A Start would pass the same preflight as New Run",
          }
        : {
            ready: false,
            label: `Flow ${flowName} is not ready`,
            detail: flow.issues.map((issue) => issue.message).join(" "),
          },
  ];
}

/** Figma T03: what the host needs before the Trigger can check, on create only. */
export function TriggerReadinessList({
  readiness,
  state,
  flows,
}: {
  readiness: ReadinessRead;
  state: TriggerDraftSnapshot;
  flows: readonly FlowDraft[] | null;
}) {
  return (
    <SettingsGroup label="Readiness">
      {readiness.status === "answered" ? (
        <ul className="grid gap-1.5 px-4 py-3">
          {readinessItems(readiness.readiness, state, flows).map((item) => (
            <ReadinessItem key={item.label} {...item} />
          ))}
        </ul>
      ) : (
        <p
          role={readiness.status === "failed" ? "alert" : "status"}
          className={`px-4 py-3 text-sm ${readiness.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {readiness.status === "failed" ? readiness.message : "Checking the Factory host…"}
        </p>
      )}
    </SettingsGroup>
  );
}
