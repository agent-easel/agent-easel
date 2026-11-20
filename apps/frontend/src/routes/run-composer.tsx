import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { ScreenLayout } from "../components/screen-layout.tsx";
import { useEffect, useRef, useState } from "react";
import {
  T3_APP_URL,
  type AgentDefinition,
  type FlowDraft,
  type LaunchChoices,
} from "@t3-factory/contracts";
import { api } from "../api.ts";
import {
  connectionIsConfigured,
  useConnectionState,
  type ConnectionPresentation,
} from "../connection-state.tsx";
import { useLiveLaunchChoices } from "../live/launch-choices.ts";
import { useLiveStudio } from "../live/studio.ts";
import type { LiveDelivery, LiveScopeView } from "../live/owner.ts";
import { composerFlows, runDraft, useRunDraft } from "../run-draft.ts";
import {
  composerLaunchCard,
  composerLaunchCardId,
  type LaunchCard,
  type StartCause,
} from "../composer-launch.ts";
import { useLiveDelivery, useTransport, type TransportState } from "../transport.ts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleHelp,
  CloudOff,
  ExternalLink,
  Info,
  Play,
  Unplug,
  Workflow,
} from "lucide-react";
import { ProjectPicker, useProjectCatalog } from "../components/project-picker.tsx";
import { TextLink } from "@/components/ui/text-link";
import { SettingsLink, StudioLink } from "../components/app-link.tsx";
import { ProblemCard } from "../components/problem-card.tsx";
import { toolbarPillClass } from "../components/page.tsx";
import { fixedShortcuts, formatShortcut } from "../keyboard-shortcuts.ts";
import { Button } from "../components/ui/button.tsx";
import { KeyChip } from "@/components/ui/key-chip";
import { ChoiceMenu, type MenuChoice, type MenuGroup } from "../components/choice-menu.tsx";
import { Label } from "../components/ui/label.tsx";
import {
  AttachImagesButton,
  ImageDropOverlay,
  ImagePreview,
  ImageRejections,
  PromptImageStrip,
  useImageDrop,
} from "../components/prompt-images.tsx";
import { PromptEditor, type PromptEditorHandle } from "../components/prompt-editor.tsx";
import { cn } from "../lib/utils.ts";

/** A Flow launches when its captured Agents and graph are ready. */
function flowCanLaunch(flow: FlowDraft) {
  return flow.readiness.ready;
}

/**
 * Hands each launch-choice delivery to the draft, which clears what a current one no longer lists
 * or allows. It runs only when a delivery arrives, not when the selection changes: a just-created
 * choice can be selected before the delivery that lists it. Leaving the composer makes the
 * choices non-current until it shows them again.
 */
function useReceiveChoices({ value, synchronized }: LiveScopeView<LaunchChoices>) {
  useEffect(() => {
    runDraft.receiveChoices({ value, synchronized });
    return () => runDraft.receiveChoices({ value: null, synchronized: false });
  }, [value, synchronized]);
}

function useComposer() {
  const navigate = useNavigate();
  const draft = useRunDraft();
  const choices = useLiveLaunchChoices();
  const projects = useProjectCatalog();
  const studio = useLiveStudio();
  const flows = choices.value?.flows ?? null;
  const error = choices.error ? "Could not load launch choices. Your draft is kept." : "";
  // Start and live observation depend on readiness: keep it current while shown.
  const { presentation, connection } = useConnectionState();
  const transportState = useTransport();
  const liveDelivery = useLiveDelivery();
  const initialized = useRef(false);
  useEffect(() => {
    if (!projects.catalog || initialized.current) return;
    initialized.current = true;
    if (!draft.projectId && projects.catalog.selectedProjectId)
      runDraft.edit({ projectId: projects.catalog.selectedProjectId });
  }, [projects.catalog, draft.projectId]);
  useReceiveChoices(choices);
  const prompt = useRef<PromptEditorHandle>(null);
  const project = projects.catalog?.projects.find((p) => p.id === draft.projectId);
  const flow = flows?.find((f) => f.id === draft.flowId);
  const configured = connectionIsConfigured(connection, presentation);
  const projectReady = project?.availability === "available";
  const ready = composerReady({
    synchronized: choices.synchronized,
    presentation,
    projectReady,
    flow,
    projectId: draft.projectId,
    projectsBusy: projects.busy,
  });
  const card = describeComposerLaunch({
    transportKind: transportState.kind,
    liveDelivery,
    presentation,
    endpoint: connection?.endpoint,
    draft,
    choicesError: error,
    catalog: projects.catalog,
    flows,
    agents: studio.value?.agents,
  });
  return {
    draft,
    projects,
    flows,
    presentation,
    configured,
    prompt,
    project,
    flow,
    locked: draft.pending,
    projectReady,
    ready,
    card,
    edit: runDraft.edit,
    start: beginRun(draft, ready, navigate),
  };
}

function composerReady(input: {
  synchronized: boolean;
  presentation: ConnectionPresentation;
  projectReady: boolean;
  flow: FlowDraft | undefined;
  projectId: string;
  projectsBusy: boolean;
}) {
  const flowFits = input.flow?.projectId === null || input.flow?.projectId === input.projectId;
  return (
    input.synchronized &&
    input.presentation === "ready" &&
    input.projectReady &&
    !!input.flow &&
    flowFits &&
    flowCanLaunch(input.flow) &&
    !input.projectsBusy
  );
}

function launchFlow(flow: FlowDraft) {
  return {
    id: flow.id,
    projectId: flow.projectId,
    name: flow.name,
    ready: flowCanLaunch(flow),
    issues: flow.readiness.issues.map((issue) => issue.message),
  };
}

function describeComposerLaunch(input: {
  transportKind: TransportState["kind"];
  liveDelivery: LiveDelivery;
  presentation: ConnectionPresentation;
  endpoint: string | null | undefined;
  draft: ReturnType<typeof useRunDraft>;
  choicesError: string;
  catalog: ReturnType<typeof useProjectCatalog>["catalog"];
  flows: readonly FlowDraft[] | null;
  agents: readonly AgentDefinition[] | null | undefined;
}): LaunchCard {
  const { draft, catalog } = input;
  return composerLaunchCard({
    factoryOffline: input.transportKind === "offline" || input.liveDelivery === "offline",
    presentation: input.presentation,
    endpoint: input.endpoint ?? null,
    pending: draft.pending,
    startError: draft.error,
    startIssues: draft.issues,
    choicesError: input.choicesError,
    saveFailed: draft.saveFailed,
    catalog: catalog && { problem: catalog.problem, projects: catalog.projects },
    projectId: draft.projectId,
    flows: input.flows?.map(launchFlow) ?? null,
    flowId: draft.flowId,
    agents:
      input.agents?.map((agent) => ({
        projectId: agent.projectId,
        execution: agent.execution,
      })) ?? null,
  });
}

function beginRun(
  draft: { busy: boolean; pending: boolean; text: string },
  ready: boolean,
  navigate: ReturnType<typeof useNavigate>,
) {
  return async (confirmCompletedIssues = false) => {
    if (draft.busy) return;
    if (!draft.pending && (!draft.text.trim() || !ready)) return;
    const runId = await runDraft.start(confirmCompletedIssues);
    if (runId) void navigate({ to: "/runs/$runId", params: { runId } });
  };
}

type Composer = ReturnType<typeof useComposer>;

function StartButton({ model }: { model: Composer }) {
  const { draft } = model;
  const mutationsAllowed = useMutationsAllowed();
  const enabled =
    mutationsAllowed && !draft.busy && (draft.pending || (model.ready && !!draft.text.trim()));
  return (
    <MutationGate>
      <Button
        type="submit"
        disabled={!enabled}
        className={cn(
          "group/start ml-auto h-9 shrink-0 gap-2 pr-3 pl-3.5 font-semibold has-[>svg]:pr-3 has-[>svg]:pl-3.5",
          !enabled && "bg-border text-subtle-foreground hover:bg-border disabled:opacity-100",
        )}
      >
        <Play aria-hidden className="size-3" strokeWidth={2} />
        {draft.busy ? "Starting…" : draft.pending ? "Check same request" : "Start"}
        {enabled && (
          <KeyChip aria-hidden className="border-0 bg-primary-foreground/14 px-1 text-inherit">
            {formatShortcut(fixedShortcuts.startRun)}
          </KeyChip>
        )}
      </Button>
    </MutationGate>
  );
}

export function RunComposer() {
  const model = useComposer();
  const { project, start } = model;
  return (
    <ScreenLayout title="New Run">
      <main className="flex flex-1 items-center justify-center p-8 max-sm:px-4">
        <form
          className="flex w-[clamp(40rem,75%,60rem)] max-w-full flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void start();
            }
          }}
        >
          <h1 className="text-heading tracking-heading">
            {/* A last-known Project keeps its heading while T3 is disconnected (R08a). */}
            {project ? `What should we work on in ${project.title}?` : "Start a new Run"}
          </h1>
          <ComposerBox model={model} />
          <LaunchNotice model={model} />
        </form>
      </main>
    </ScreenLayout>
  );
}

/** The Flow choices: Global, then the Project's; a not-ready Flow is listed but cannot be chosen. */
function flowChoices({ flows, project }: Composer, listed: ReturnType<typeof composerFlows>) {
  const choice =
    (group: MenuGroup) =>
    (flow: FlowDraft): MenuChoice => ({
      id: flow.id,
      label: flow.name,
      icon: <Workflow aria-hidden className="text-muted-foreground" strokeWidth={1.5} />,
      group,
      ...(!flowCanLaunch(flow) && { badge: "Not ready", badgeKind: "error", disabled: true }),
    });
  const choices = [
    ...listed.global.map(choice({ id: "global", label: "Global" })),
    ...listed.project.map(choice({ id: "project", label: project?.title ?? "" })),
  ];
  const empty = !flows ? "Loading Flows…" : "No Flows yet";
  return { choices, empty };
}

const flowNotReadyId = "launch-flow-not-ready";

/**
 * The Flow field's problem: the not-ready card, or, while another card has priority, a hidden
 * explanation, so the field tagged Not ready stays invalid.
 */
function flowProblem(card: LaunchCard, flow: FlowDraft | undefined, tagged: boolean) {
  if (card.kind === "flow-not-ready") return { describedBy: composerLaunchCardId };
  if (!flow || !tagged) return { describedBy: undefined };
  return { describedBy: flowNotReadyId, explanation: `“${flow.name}” isn’t ready to run.` };
}

function FlowField({ model }: { model: Composer }) {
  const { draft, flows, flow, edit, locked, configured, card } = model;
  const listed = composerFlows(flows ?? [], draft.projectId);
  const { choices, empty } = flowChoices(model, listed);
  const tagged = !!choices.find((choice) => choice.id === draft.flowId)?.disabled;
  const problem = flowProblem(card, flow, tagged);
  return (
    <>
      <Label htmlFor="launch-flow" className="sr-only">
        Flow
      </Label>
      {problem.explanation && (
        // The field's explanation while another card has priority, announced like an error card.
        <span id={flowNotReadyId} role="alert" className="sr-only">
          {problem.explanation}
        </span>
      )}
      <ChoiceMenu
        id="launch-flow"
        label="Flow"
        value={draft.flowId}
        // A Start awaiting its outcome keeps its submitted Flow, which may no longer be listed.
        unlistedLabel={flow?.name}
        choices={choices}
        onChange={(flowId) => flowId !== draft.flowId && edit({ flowId })}
        // No Flow is chosen without a Project.
        disabled={listed.disabled || !configured}
        placeholder={flows?.length === 0 ? "No Flows yet" : "Choose a Flow"}
        empty={empty}
        describedBy={problem.describedBy}
        problemTone="error"
        composer={{
          search: { label: "Search Flows", noMatch: "No matching Flows" },
          busy: locked,
          // A chosen Flow that is not ready is never checked in the list.
          checked: flow && flowCanLaunch(flow) ? draft.flowId : null,
        }}
        className={cn(toolbarPillClass, "w-55 **:data-[slot=choice-value]:font-medium")}
        popupClassName="w-80"
        trigger={{
          label: "Select Flow",
          glyph: (
            <Workflow
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
          ),
        }}
      />
    </>
  );
}

/**
 * The composer box: the required prompt with inline image references (pasted, dropped or picked)
 * above a toolbar holding the Project, the Flow, image attachment and Start.
 */
function ComposerBox({ model }: { model: Composer }) {
  const { draft, projects, locked, edit, prompt, configured, presentation } = model;
  const [previewing, setPreviewing] = useState<string>();
  const previewed = draft.images.find((image) => image.imageId === previewing);
  const drop = useImageDrop(!locked, (files) => void prompt.current?.insertImages(files));
  return (
    <div className="grid gap-2">
      <Label id="launch-prompt-label" className="sr-only">
        Initial prompt Required
      </Label>
      <div
        {...drop.handlers}
        className="relative flex min-h-[max(12rem,32vh)] flex-col gap-2 rounded-xl border bg-card p-3 transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/15"
      >
        <div
          className={cn(
            "flex flex-col gap-2 px-1.5 pt-1",
            // Without images the prompt keeps a floor of several lines and scrolls inside: its
            // zero basis keeps the text out of the box height. Images let the box grow.
            draft.images.length ? "min-h-0 flex-1" : "min-h-20 grow basis-0",
          )}
        >
          <PromptEditor
            ref={prompt}
            opening={draft.opening}
            segments={draft.segments}
            images={draft.images}
            locked={locked}
            invalid={false}
            labelledBy="launch-prompt-label"
            placeholder="Describe what this Run should do…"
            onChange={(segments) => edit({ segments })}
            attachImages={runDraft.attachImages}
            onPreview={setPreviewing}
          />
          <PromptImageStrip
            images={draft.images}
            load={runDraft.loadImage}
            locked={locked}
            onPreview={setPreviewing}
            onRemove={runDraft.removeImage}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset disabled={locked} className="contents">
            <ProjectPicker
              state={projects}
              selectedId={draft.projectId}
              onSelect={(projectId) => edit({ projectId })}
              disabled={locked || !configured}
              placeholder={
                configured &&
                presentation === "ready" &&
                projects.catalog?.projects.every((item) => item.availability !== "available") &&
                !draft.projectId
                  ? "No projects in T3"
                  : "No project selected"
              }
            />
            <FlowField model={model} />
          </fieldset>
          <AttachImagesButton
            disabled={locked}
            onFiles={(files) => void runDraft.attachImages(files)}
          />
          <StartButton model={model} />
        </div>
        {drop.dragging && <ImageDropOverlay />}
      </div>
      <ImageRejections rejections={draft.imageRejections} />
      {previewed && (
        <ImagePreview
          image={previewed}
          load={runDraft.loadImage}
          onClose={() => setPreviewing(undefined)}
        />
      )}
    </div>
  );
}

function RefreshProjects({ model }: { model: Composer }) {
  const { projects } = model;
  return (
    <MutationGate>
      <TextLink disabled={projects.busy} onClick={() => void projects.act(api.recheckProjects)}>
        Refresh projects
      </TextLink>
    </MutationGate>
  );
}

function CauseLink({ cause }: { cause: StartCause }) {
  if (cause.destination === "reporting")
    return (
      <TextLink asChild trailingIcon={ChevronRight}>
        <SettingsLink selection={{ tab: "agent-reporting" }}>
          Open Settings → Agent reporting
        </SettingsLink>
      </TextLink>
    );
  if (cause.destination === "connection")
    return (
      <TextLink asChild trailingIcon={ChevronRight}>
        <SettingsLink selection={{ tab: "connection" }}>Open T3 connection settings</SettingsLink>
      </TextLink>
    );
  if (cause.destination === "flows")
    return (
      <TextLink asChild trailingIcon={ChevronRight}>
        <StudioLink selection={{ tab: "flows", flowId: cause.flowId }}>
          Open Studio → Flows
        </StudioLink>
      </TextLink>
    );
  return (
    <TextLink asChild trailingIcon={ChevronRight}>
      <StudioLink selection={{ tab: "agents" }}>Open Studio → Agents</StudioLink>
    </TextLink>
  );
}

function StartCauseList({ causes }: { causes: readonly StartCause[] }) {
  return (
    <ul aria-label="Start blockers" className="grid gap-1">
      {causes.map((cause, index) => (
        <li
          key={`${cause.destination}:${cause.message}:${index}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 break-words"
        >
          <span>{cause.message}</span>
          <CauseLink cause={cause} />
        </li>
      ))}
    </ul>
  );
}

const flowStay = "Fix it in the Flow editor or pick another Flow; your project and prompt stay.";

function LaunchNotice({ model }: { model: Composer }) {
  if (model.card.kind === "none") return null;
  return connectionLaunchNotice(model) ?? outcomeLaunchNotice(model) ?? setupLaunchNotice(model);
}

function connectionLaunchNotice(model: Composer) {
  const { card } = model;
  if (card.kind === "factory-offline")
    return (
      <ProblemCard density="compact" tone="error" icon={CloudOff} title="Factory offline">
        Your draft is kept.
      </ProblemCard>
    );
  if (card.kind === "checking")
    return (
      <ProblemCard
        density="compact"
        tone="neutral"
        icon={CircleHelp}
        title="Checking T3 connection…"
      >
        Start is available once Factory confirms T3 is connected.
      </ProblemCard>
    );
  if (card.kind === "status-unknown")
    return (
      <ProblemCard density="compact" tone="error" title="Could not load T3 connection status">
        Your draft is kept. Check that Factory is running, then check the connection again.
      </ProblemCard>
    );
  if (card.kind === "unconfigured")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Connect Factory to T3"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <SettingsLink selection={{ tab: "connection" }}>Open T3 connection</SettingsLink>
          </TextLink>
        }
      />
    );
  if (card.kind === "disconnected")
    return (
      <ProblemCard
        density="compact"
        tone="error"
        icon={Unplug}
        title="T3 is disconnected"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <SettingsLink selection={{ tab: "connection" }}>
              Open T3 connection settings
            </SettingsLink>
          </TextLink>
        }
      >
        Your draft is kept and Project and Flow show their last known values. Start is available
        again as soon as Factory reconnects to T3.
      </ProblemCard>
    );
  if (card.kind === "authorization")
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Authorize Factory in T3"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <SettingsLink selection={{ tab: "connection" }}>
              Open T3 connection settings
            </SettingsLink>
          </TextLink>
        }
      >
        T3 is running but hasn’t granted this Factory access. Approve it in T3 — your draft stays
        here.
      </ProblemCard>
    );
  if (card.kind === "incompatible")
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="T3 version is incompatible"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <SettingsLink selection={{ tab: "connection" }}>
              Open T3 connection settings
            </SettingsLink>
          </TextLink>
        }
      >
        Update T3 and check again. Until then Factory can show history but can’t start Runs.
      </ProblemCard>
    );
  return null;
}

function outcomeLaunchNotice(model: Composer) {
  const { card, start, draft } = model;
  if (card.kind === "start-unknown")
    return (
      <ProblemCard
        density="compact"
        tone="neutral"
        icon={CircleHelp}
        title="We couldn’t confirm the start"
        action={
          <MutationGate>
            <TextLink disabled={draft.busy} onClick={() => void start()}>
              Check now
            </TextLink>
          </MutationGate>
        }
      >
        {card.message}
      </ProblemCard>
    );
  if (
    card.kind === "start-rejected" &&
    draft.issues.some((issue) => issue.code === "completed_issue")
  )
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Review completed GitHub work"
        action={
          <MutationGate>
            <TextLink disabled={draft.busy} onClick={() => void start(true)}>
              Start anyway
            </TextLink>
          </MutationGate>
        }
      >
        {draft.issues.map((issue) => issue.message).join(" ")}
      </ProblemCard>
    );
  if (card.kind === "start-rejected")
    return (
      <ProblemCard
        density="compact"
        tone="error"
        title="Start was not accepted"
        action={<StartCauseList causes={card.causes} />}
      >
        No Run was created.
      </ProblemCard>
    );
  return null;
}

function setupLaunchNotice(model: Composer) {
  const { card } = model;
  if (card.kind === "discovery")
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Project discovery failed"
        action={<RefreshProjects model={model} />}
      >
        {card.message}
      </ProblemCard>
    );
  if (card.kind === "no-projects")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Add a project in T3 first"
        action={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <RefreshProjects model={model} />
            <TextLink trailingIcon={ExternalLink} href={T3_APP_URL}>
              Open T3
            </TextLink>
          </span>
        }
      >
        Choose an available project once T3 reports one. Factory uses the projects T3 knows about:
        add a repository in T3, then refresh — your prompt is kept.
      </ProblemCard>
    );
  if (card.kind === "choose-project")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Choose a project"
        action={<RefreshProjects model={model} />}
      >
        Choose an available project, then a Flow for it. Your prompt is kept.
      </ProblemCard>
    );
  if (card.kind === "create-agent")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Create your first Agent"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <StudioLink selection={{ tab: "agents" }}>Go to Agents</StudioLink>
          </TextLink>
        }
      />
    );
  if (card.kind === "setup-agent")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Set up an Agent"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <StudioLink selection={{ tab: "agents" }}>Go to Agents</StudioLink>
          </TextLink>
        }
      />
    );
  if (card.kind === "create-flow")
    return (
      <ProblemCard
        density="compact"
        tone="info"
        icon={Info}
        title="Create your first Flow"
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <StudioLink selection={{ tab: "flows" }}>Go to Flows</StudioLink>
          </TextLink>
        }
      >
        Your draft is kept while you are away.
      </ProblemCard>
    );
  if (card.kind === "no-ready-flows")
    return (
      <ProblemCard
        density="compact"
        tone="error"
        title={`No ready Flows for ${card.projectTitle}`}
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <StudioLink selection={{ tab: "flows" }}>Open Flows in Studio</StudioLink>
          </TextLink>
        }
      />
    );
  if (card.kind === "flow-not-ready")
    return (
      <ProblemCard
        density="compact"
        id={composerLaunchCardId}
        tone="error"
        title={`“${card.flowName}” isn’t ready to run`}
        action={
          <TextLink asChild trailingIcon={ChevronRight}>
            <StudioLink selection={{ tab: "flows", flowId: card.flowId }}>
              Open {card.flowName} in Flows
            </StudioLink>
          </TextLink>
        }
      >
        {card.issues.length ? `${card.issues.join(" ")} ${flowStay}` : flowStay}
      </ProblemCard>
    );
  if (card.kind === "draft-storage")
    return (
      <ProblemCard density="compact" tone="attention" title="This browser can’t save your draft">
        Your prompt and choices stay while this window is open. Allow site storage for Factory in
        your browser settings to keep drafts after a reload.
      </ProblemCard>
    );
  if (card.kind === "choices-stale")
    return (
      <ProblemCard
        density="compact"
        tone="neutral"
        icon={CircleHelp}
        title="Launch choices are out of date"
      >
        {card.message}
      </ProblemCard>
    );
  return null;
}
