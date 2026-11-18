import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { ScreenLayout } from "../components/screen-layout.tsx";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AgentDefinition, FlowDraft, LaunchChoices } from "@t3-factory/contracts";
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
  t3AppUrl,
  type LaunchCard,
  type StartCause,
} from "../composer-launch.ts";
import { useLiveDelivery, useTransport, type TransportState } from "../transport.ts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronsUpDown,
  CircleHelp,
  CloudOff,
  Info,
  Play,
  TriangleAlert,
  Unplug,
  Workflow,
} from "lucide-react";
import { ProjectPicker, useProjectCatalog } from "../components/project-picker.tsx";
import { FieldStateTag } from "../components/field-state-tag.tsx";
import {
  Notice,
  NoticeButton,
  NoticeExternalLink,
  NoticeSettingsLink,
  NoticeStudioLink,
} from "../components/notice.tsx";
import { selectFieldClass, toolbarPillClass } from "../components/page.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { PickerMenuContent, PickerMenuSearch } from "../components/picker-menu-search.tsx";
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
  return async () => {
    if (draft.busy) return;
    if (!draft.pending && (!draft.text.trim() || !ready)) return;
    const runId = await runDraft.start();
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
          !enabled && "bg-accent text-subtle-foreground hover:bg-accent disabled:opacity-100",
        )}
      >
        <Play aria-hidden className="size-3" strokeWidth={2} />
        {draft.busy ? "Starting…" : draft.pending ? "Check same request" : "Start"}
        {enabled && (
          <kbd
            aria-hidden
            className="rounded-sm bg-primary-foreground/14 px-1 py-px font-sans text-2xs font-medium"
          >
            ⌘↵
          </kbd>
        )}
      </Button>
    </MutationGate>
  );
}

export function RunComposer() {
  const model = useComposer();
  const { project, projectReady, start } = model;
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
            {projectReady ? `What should we work on in ${project?.title}?` : "Start a new Run"}
          </h1>
          <ComposerBox model={model} />
          <LaunchNotice model={model} />
        </form>
      </main>
    </ScreenLayout>
  );
}

function flowFieldState({ draft, flows, flow }: Composer) {
  const empty = flows?.length === 0;
  const choices = composerFlows(flows ?? [], draft.projectId, draft.flowId);
  const notReady = !!flow && !flowCanLaunch(flow);
  return {
    empty,
    choices,
    notReady,
    placeholder: empty ? "No Flows yet" : "Choose a Flow",
    value:
      flow?.name ??
      (empty ? undefined : flows && draft.flowId ? "Selected Flow unavailable" : undefined),
  };
}

/** The Flow pill's value: the name, marked when the Flow cannot launch. */
function FlowFieldValue({
  model,
  value,
  placeholder,
}: {
  model: Composer;
  value?: string;
  placeholder: string;
}) {
  const { flow } = model;
  if (!value) return <span className="truncate text-muted-foreground">{placeholder}</span>;
  return (
    <>
      <span className="min-w-0 truncate font-medium">{value}</span>
      {flow && !flowCanLaunch(flow) && <FieldStateTag>Not ready</FieldStateTag>}
    </>
  );
}

const flowRadioItemClass =
  "my-0.5 rounded-md py-2 data-[state=checked]:bg-brand-soft data-[state=checked]:ring-1 data-[state=checked]:ring-brand-soft-border data-[state=checked]:ring-inset data-[state=checked]:focus:bg-brand-soft data-[state=checked]:focus-visible:ring-2 data-[state=checked]:focus-visible:ring-ring";

function FlowChoice({ flow, busy }: { flow: FlowDraft; busy: boolean }) {
  const label = `${flow.name}${flowCanLaunch(flow) ? "" : " · Not ready"}`;
  return (
    <DropdownMenuRadioItem
      value={flow.id}
      data-flow-id={flow.id}
      indicatorPosition="right"
      disabled={busy}
      aria-label={label}
      className={flowRadioItemClass}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuRadioItem>
  );
}

/** One heading and its Flows, or nothing when none match. */
function FlowGroup({
  title,
  flows,
  busy,
}: {
  title: string;
  flows: readonly FlowDraft[];
  busy: boolean;
}) {
  if (flows.length === 0) return null;
  return (
    <>
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      {flows.map((flow) => (
        <FlowChoice key={flow.id} flow={flow} busy={busy} />
      ))}
    </>
  );
}

/** Why the menu lists no Flow, if it lists none. */
function flowChoicesStatus(flows: readonly FlowDraft[] | null, offered: boolean, matched: boolean) {
  if (!flows) return "Loading Flows…";
  if (flows.length === 0) return "No Flows yet";
  if (!offered) return "No ready Flows for this project.";
  return matched ? undefined : "No matching Flows.";
}

function FlowChoices({
  model,
  busy,
  search,
  listRef,
  onSelect,
}: {
  model: Composer;
  busy: boolean;
  search: string;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (flowId: string) => void;
}) {
  const { draft, flows, flow, project } = model;
  const { choices } = flowFieldState(model);
  const query = search.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(query);
  const globalFlows = choices.global.filter((f) => matches(f.name));
  const projectFlows = choices.project.filter((f) => matches(f.name));
  const offered = choices.global.length + choices.project.length > 0;
  const showUnavailable =
    !!flows?.length && !!draft.flowId && !flow && matches("Selected Flow unavailable");
  const status = flowChoicesStatus(
    flows,
    offered,
    showUnavailable || globalFlows.length + projectFlows.length > 0,
  );
  const positioned = useRef(false);
  useLayoutEffect(() => {
    if (positioned.current || !flows) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-state="checked"]')
      ?.scrollIntoView({ block: "nearest" });
    positioned.current = true;
  }, [flows, listRef]);
  return (
    <div
      ref={listRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
      role="group"
      aria-label="Flows"
    >
      <DropdownMenuRadioGroup value={draft.flowId} onValueChange={onSelect}>
        {showUnavailable && (
          <DropdownMenuRadioItem
            value={draft.flowId}
            indicatorPosition="right"
            disabled={busy}
            aria-label="Selected Flow unavailable"
            className={flowRadioItemClass}
          >
            <span className="truncate text-muted-foreground">Selected Flow unavailable</span>
          </DropdownMenuRadioItem>
        )}
        {(offered || showUnavailable || !!flow) && (
          <DropdownMenuRadioItem value="" indicatorPosition="right" disabled={busy}>
            Choose a Flow
          </DropdownMenuRadioItem>
        )}
        <FlowGroup title="Global" flows={globalFlows} busy={busy} />
        <FlowGroup title={project?.title ?? ""} flows={projectFlows} busy={busy} />
      </DropdownMenuRadioGroup>
      {status && (
        <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {!!flows?.length && (
        <p className="px-3 pt-1 pb-2 text-2xs text-muted-foreground">
          Only ready Flows are listed. Flows of other Projects run only there.
        </p>
      )}
    </div>
  );
}

function FlowField({ model }: { model: Composer }) {
  const { draft, edit, locked, configured, card } = model;
  const state = flowFieldState(model);
  const busy = locked;
  // No Flow is chosen without a Project; a Flow held from Start Run stays visible.
  const disabled = state.choices.disabled || !configured;
  const describedBy = card.kind === "flow-not-ready" ? composerLaunchCardId : undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerLabel = state.value ?? state.placeholder;
  const showSearch = state.choices.global.length + state.choices.project.length > 0;
  return (
    <>
      <Label htmlFor="launch-flow" className="sr-only">
        Flow
      </Label>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open && !busy && !disabled);
          if (open) setSearch("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            id="launch-flow"
            variant="outline"
            disabled={disabled}
            aria-disabled={busy || disabled}
            aria-busy={busy}
            aria-label={`Select Flow: ${triggerLabel}`}
            aria-invalid={state.notReady || undefined}
            aria-describedby={describedBy}
            className={cn(
              selectFieldClass,
              toolbarPillClass,
              "w-55",
              state.notReady && "border-destructive",
            )}
          >
            <Workflow
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <FlowFieldValue
                model={model}
                placeholder={state.placeholder}
                {...(state.value ? { value: state.value } : {})}
              />
            </span>
            <ChevronsUpDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
          </Button>
        </DropdownMenuTrigger>
        <PickerMenuContent
          className="flex max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
          searchRef={searchRef}
          listRef={listRef}
          searchEnabled={showSearch}
        >
          {showSearch && (
            <PickerMenuSearch
              ariaLabel="Search Flows"
              placeholder="Search by Flow name…"
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              listRef={listRef}
              firstChoiceSelector="[data-flow-id]"
            />
          )}
          <FlowChoices
            model={model}
            busy={busy}
            search={search}
            listRef={listRef}
            onSelect={(flowId) => {
              if (busy) return;
              setMenuOpen(false);
              if (flowId !== draft.flowId) edit({ flowId });
            }}
          />
        </PickerMenuContent>
      </DropdownMenu>
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
      <NoticeButton disabled={projects.busy} onClick={() => void projects.act(api.recheckProjects)}>
        Refresh projects
      </NoticeButton>
    </MutationGate>
  );
}

function CauseLink({ cause }: { cause: StartCause }) {
  if (cause.destination === "reporting")
    return (
      <NoticeSettingsLink selection={{ tab: "agent-reporting" }}>
        Open Settings → Agent reporting
      </NoticeSettingsLink>
    );
  if (cause.destination === "connection")
    return (
      <NoticeSettingsLink selection={{ tab: "connection" }}>
        Open T3 connection settings
      </NoticeSettingsLink>
    );
  if (cause.destination === "flows")
    return (
      <NoticeStudioLink selection={{ tab: "flows", flowId: cause.flowId }}>
        Open Studio → Flows
      </NoticeStudioLink>
    );
  return <NoticeStudioLink selection={{ tab: "agents" }}>Open Studio → Agents</NoticeStudioLink>;
}

function StartCauseList({ causes }: { causes: readonly StartCause[] }) {
  return (
    <ul aria-label="Start blockers" className="list-disc space-y-1 pl-4 text-foreground">
      {causes.map((cause, index) => (
        <li key={`${cause.destination}:${cause.message}:${index}`} className="break-words">
          <span className="block">{cause.message}</span>
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
      <Notice tone="critical" icon={CloudOff} title="Factory offline">
        Your draft is kept.
      </Notice>
    );
  if (card.kind === "checking")
    return (
      <Notice tone="neutral" icon={CircleHelp} title="Checking T3 connection…">
        Start is available once Factory confirms T3 is connected.
      </Notice>
    );
  if (card.kind === "status-unknown")
    return (
      <Notice tone="critical" icon={TriangleAlert} title="Could not load T3 connection status">
        Your draft is kept. Check that Factory is running, then check the connection again.
      </Notice>
    );
  if (card.kind === "unconfigured")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Connect Factory to T3"
        action={
          <NoticeSettingsLink selection={{ tab: "connection" }}>
            Open T3 connection
          </NoticeSettingsLink>
        }
      />
    );
  if (card.kind === "disconnected")
    return (
      <Notice
        tone="critical"
        icon={Unplug}
        title="T3 is disconnected"
        action={
          <NoticeSettingsLink selection={{ tab: "connection" }}>
            Open T3 connection settings
          </NoticeSettingsLink>
        }
      >
        Your draft is kept and Project and Flow show their last known values. Start is available
        again as soon as Factory reconnects to T3.
      </Notice>
    );
  if (card.kind === "authorization")
    return (
      <Notice
        tone="attention"
        icon={TriangleAlert}
        title="Authorize Factory in T3"
        action={
          <NoticeSettingsLink selection={{ tab: "connection" }}>
            Open T3 connection settings
          </NoticeSettingsLink>
        }
      >
        T3 is running but hasn’t granted this Factory access. Approve it in T3 — your draft stays
        here.
      </Notice>
    );
  if (card.kind === "incompatible")
    return (
      <Notice
        tone="attention"
        icon={TriangleAlert}
        title="T3 version is incompatible"
        action={
          <NoticeSettingsLink selection={{ tab: "connection" }}>
            Open T3 connection settings
          </NoticeSettingsLink>
        }
      >
        Update T3 and check again. Until then Factory can show history but can’t start Runs.
      </Notice>
    );
  return null;
}

function outcomeLaunchNotice(model: Composer) {
  const { card, start, draft } = model;
  if (card.kind === "start-unknown")
    return (
      <Notice
        tone="neutral"
        icon={CircleHelp}
        title="We couldn’t confirm the start"
        action={
          <MutationGate>
            <NoticeButton disabled={draft.busy} onClick={() => void start()}>
              Check now
            </NoticeButton>
          </MutationGate>
        }
      >
        {card.message}
      </Notice>
    );
  if (card.kind === "start-rejected")
    return (
      <Notice
        tone="critical"
        icon={TriangleAlert}
        title="Start was not accepted"
        action={<StartCauseList causes={card.causes} />}
      >
        No Run was created.
      </Notice>
    );
  return null;
}

function setupLaunchNotice(model: Composer) {
  const { card } = model;
  if (card.kind === "discovery")
    return (
      <Notice
        tone="attention"
        icon={TriangleAlert}
        title="Project discovery failed"
        action={<RefreshProjects model={model} />}
      >
        {card.message}
      </Notice>
    );
  if (card.kind === "no-projects")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Add a project in T3 first"
        action={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <RefreshProjects model={model} />
            <NoticeExternalLink href={t3AppUrl}>Open T3</NoticeExternalLink>
          </span>
        }
      >
        Choose an available project once T3 reports one. Factory uses the projects T3 knows about:
        add a repository in T3 or in the Project picker, then refresh — your prompt is kept.
      </Notice>
    );
  if (card.kind === "choose-project")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Choose a project"
        action={<RefreshProjects model={model} />}
      >
        Choose an available project, then a Flow for it. Your prompt is kept.
      </Notice>
    );
  if (card.kind === "create-agent")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Create your first Agent"
        action={<NoticeStudioLink selection={{ tab: "agents" }}>Go to Agents</NoticeStudioLink>}
      />
    );
  if (card.kind === "setup-agent")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Set up an Agent"
        action={<NoticeStudioLink selection={{ tab: "agents" }}>Go to Agents</NoticeStudioLink>}
      />
    );
  if (card.kind === "create-flow")
    return (
      <Notice
        tone="info"
        icon={Info}
        title="Create your first Flow"
        action={<NoticeStudioLink selection={{ tab: "flows" }}>Go to Flows</NoticeStudioLink>}
      >
        Your draft is kept while you are away.
      </Notice>
    );
  if (card.kind === "no-ready-flows")
    return (
      <Notice
        tone="critical"
        icon={TriangleAlert}
        title={`No ready Flows for ${card.projectTitle}`}
        action={
          <NoticeStudioLink selection={{ tab: "flows" }}>Open Flows in Studio</NoticeStudioLink>
        }
      />
    );
  if (card.kind === "flow-not-ready")
    return (
      <Notice
        id={composerLaunchCardId}
        tone="critical"
        icon={TriangleAlert}
        title={`“${card.flowName}” isn’t ready to run`}
        action={
          <NoticeStudioLink selection={{ tab: "flows", flowId: card.flowId }}>
            Open {card.flowName} in Flows
          </NoticeStudioLink>
        }
      >
        {card.issues.length ? `${card.issues.join(" ")} ${flowStay}` : flowStay}
      </Notice>
    );
  if (card.kind === "draft-storage")
    return (
      <Notice tone="attention" icon={TriangleAlert} title="This browser can’t save your draft">
        Your prompt and choices stay while this window is open. Allow site storage for Factory in
        your browser settings to keep drafts after a reload.
      </Notice>
    );
  if (card.kind === "choices-stale")
    return (
      <Notice tone="neutral" icon={CircleHelp} title="Launch choices are out of date">
        {card.message}
      </Notice>
    );
  return null;
}
