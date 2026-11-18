import { Button } from "../components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import type {
  AgentCapabilities,
  AgentDefinition,
  FactoryProject,
  FlowDraft,
  ValidationIssue,
} from "@t3-factory/contracts";
import { useStudioNavigation } from "../settings-navigation.ts";
import {
  createAgentDraft,
  useAgentDraftSnapshot,
  type AgentDraftModel,
  type AgentDraftSnapshot,
  type AgentDraftSource,
} from "../agent-draft.ts";
import { api } from "../api.ts";
import {
  defaultOwner,
  ownerPicker,
  studioOwner,
  useStudioOwners,
  useStudioRead,
  type StudioDefinitions,
  type StudioDefinitionsSnapshot,
} from "../studio-definitions.ts";
import { ownerHint } from "../components/studio-owner.tsx";
import { ChangeOwnerDialog, DuplicateAgentDialog } from "../components/studio-owner-dialogs.tsx";
import { useActiveView } from "../use-active-view.ts";
import {
  AgentsListColumn,
  agentsListEmpty,
  firstOpenAgent,
} from "../components/studio-agents/agents-list-pane.tsx";
import { AgentEditorPane } from "../components/studio-agents/agent-editor-pane.tsx";
import { placingFlows } from "@/lib/agent-display";
import { DefinitionImportControl } from "../components/definition-import-control.tsx";
import {
  StudioListEmpty,
  StudioListHeader,
  StudioListMessage,
  studioListClass,
} from "../components/studio-list.tsx";
import { OwnerFilter } from "../components/studio-owner.tsx";
import {
  CantRemoveDialog,
  flowBlockers,
  namedBlockers,
  racedBlockers,
} from "../components/studio-removal.tsx";
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { MutationGate } from "@/client-gate";
import { ApiError } from "../api.ts";
import { Bot } from "lucide-react";
import { useReportingState } from "../reporting-state.tsx";
import { useDefinitionExport } from "../definition-export.ts";
import { openImported } from "../definition-import.ts";
import { definitionExportNotice } from "../components/definition-export-control.tsx";
import { useServerId } from "../client-scope.ts";

type ShownLists = {
  readonly [K in "agents" | "flows"]: NonNullable<StudioDefinitionsSnapshot[K]["value"]>;
};

/**
 * Studio's saved Agents and Flows as the Agents page shows them: entering the page waits until
 * both were delivered, then later deliveries replace the shown rows. Both lists are shown
 * together, only once both are synchronized, so Agents never appear beside another delivery's
 * Flow usage.
 */
function useShownLists(definitions: StudioDefinitions) {
  const agentsRead = useStudioRead(definitions, "agents");
  const flowsRead = useStudioRead(definitions, "flows");
  const agents = agentsRead.value;
  const flows = flowsRead.value;
  const [shown, setShown] = useState<ShownLists | null>(null);
  const answered = agentsRead.synchronized && flowsRead.synchronized;
  if (
    answered &&
    agents !== null &&
    flows !== null &&
    (shown?.agents !== agents || shown.flows !== flows)
  )
    setShown({ agents, flows });
  const error = agentsRead.error || flowsRead.error ? "Couldn’t load Agents." : "";
  return { shown, error };
}

/** The Agents page's saved lists and capabilities; reporting is checked on entry and after each write. */
function useAgentsLibrary(definitions: StudioDefinitions) {
  const { refresh: refreshReporting } = useReportingState();
  const { shown, error } = useShownLists(definitions);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>();
  useEffect(() => {
    void refreshReporting();
  }, [refreshReporting]);
  useEffect(() => {
    let active = true;
    void api.getAgentCapabilities().then(
      (value) => {
        if (active) setCapabilities(value);
      },
      () => {
        if (active) setCapabilities(null);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return {
    agents: shown?.agents ?? null,
    flows: shown?.flows ?? null,
    capabilities,
    error,
    definitions,
    refreshReporting,
  };
}

/** New Agent's owner: preselected from the asking Flow, else from the owner filter. */
function useNewAgentOwner(
  definitions: StudioDefinitions,
  flows: ShownLists["flows"] | null,
  fromFlow: string | undefined,
) {
  const { projects, filter } = useStudioOwners(definitions);
  const flow = fromFlow ? flows?.find((entry) => entry.id === fromFlow) : undefined;
  return {
    projects,
    initial: defaultOwner(filter, flow),
    hint: ownerHint(filter, projects, "Agents", flow),
  };
}

export function StudioAgentsPage({
  agentId,
  fromFlow,
  definitions,
  reportAgentDraft,
}: {
  agentId: string | undefined;
  /** The Flow whose editor asked for a new Agent. */
  fromFlow: string | undefined;
  definitions: StudioDefinitions;
  reportAgentDraft: ReportDraft;
}) {
  const openStudio = useStudioNavigation();
  const openRef = useRef(openStudio);
  useEffect(() => {
    openRef.current = openStudio;
  }, [openStudio]);
  const library = useAgentsLibrary(definitions);
  const owners = useStudioOwners(definitions);
  const newOwner = useNewAgentOwner(definitions, library.flows, fromFlow);
  const serverId = useServerId();
  const [query, setQuery] = useState("");
  const [rowAction, setRowAction] = useState<AgentRowAction | null>(null);
  // This window's own Create or Duplicate, answered before Studio may have delivered it.
  const [acknowledged, setAcknowledged] = useState<AgentDefinition | null>(null);
  const creating = agentId === "new";
  const firstId = firstOpenAgent(library.agents, query, owners);
  useEffect(() => {
    if (agentId !== undefined || !firstId) return;
    void openRef.current({ tab: "agents", agentId: firstId });
  }, [agentId, firstId]);
  const empty = agentsListEmpty(library.agents, creating, owners.filter, query);
  const showEditor = agentId !== undefined;
  return (
    <div className={`min-h-0 flex-1 overflow-auto ${studioListClass}`}>
      <StudioListHeader
        title="Agents"
        count={library.agents ? library.agents.length : null}
        query={query}
        onQueryChange={setQuery}
        onCreate={() => void openStudio({ tab: "agents", agentId: "new" })}
        createLabel="New Agent"
        createVariant={creating ? "outline" : "default"}
        importer={
          <DefinitionImportControl
            projects={owners.projects}
            onImported={(result) => void openImported(result, definitions, openStudio)}
          />
        }
        filter={
          <OwnerFilter
            filter={owners.filter}
            projects={owners.projects}
            onChange={owners.setFilter}
          />
        }
      />
      <AgentsBoard
        library={library}
        owners={owners}
        empty={empty}
        agentId={agentId}
        creating={creating}
        query={query}
        serverId={serverId}
        acknowledged={acknowledged}
        onAcknowledged={setAcknowledged}
        reportDraft={reportAgentDraft}
        newOwner={newOwner}
        showEditor={showEditor}
        onChangeOwner={(agent) => setRowAction({ kind: "owner", agent })}
        onRemove={(agent) => setRowAction({ kind: "remove", agent })}
      />
      <AgentListDialogs
        action={rowAction}
        definitions={definitions}
        projects={owners.projects}
        flows={library.flows ?? []}
        onClose={() => setRowAction(null)}
        onDuplicate={(agent, target) => setRowAction({ kind: "duplicate", agent, target })}
        onRemoved={(agent) => {
          setRowAction(null);
          if (agentId === agent.id) void openStudio({ tab: "agents" });
        }}
      />
    </div>
  );
}

function AgentsBoard({
  library,
  owners,
  empty,
  agentId,
  creating,
  query,
  serverId,
  acknowledged,
  onAcknowledged,
  reportDraft,
  newOwner,
  showEditor,
  onChangeOwner,
  onRemove,
}: {
  library: ReturnType<typeof useAgentsLibrary>;
  owners: ReturnType<typeof useStudioOwners>;
  empty: boolean;
  agentId: string | undefined;
  creating: boolean;
  query: string;
  serverId: string | null;
  acknowledged: AgentDefinition | null;
  onAcknowledged: (agent: AgentDefinition) => void;
  reportDraft: ReportDraft;
  newOwner: ReturnType<typeof useNewAgentOwner>;
  showEditor: boolean;
  onChangeOwner: (agent: AgentDefinition) => void;
  onRemove: (agent: AgentDefinition) => void;
}) {
  if (library.error && !library.agents)
    return <StudioListMessage tone="error">Couldn’t load Agents.</StudioListMessage>;
  if (empty && agentId === undefined)
    return (
      <StudioListEmpty
        icon={<Bot aria-hidden className="size-8" strokeWidth={1.5} />}
        title="No Agents yet"
      />
    );
  return (
    <div className="flex min-w-0 items-start gap-6">
      <AgentsListColumn
        agents={library.agents}
        flows={library.flows}
        capabilities={library.capabilities ?? null}
        owners={owners}
        selectedId={agentId}
        creatingNew={creating}
        query={query}
        error={library.error}
        onChangeOwner={onChangeOwner}
        onRemove={onRemove}
      />
      <OpenedAgentSection
        showEditor={showEditor}
        agentId={agentId}
        serverId={serverId}
        library={library}
        acknowledged={acknowledged}
        onAcknowledged={onAcknowledged}
        reportDraft={reportDraft}
        projects={owners.projects}
        newOwner={newOwner}
      />
    </div>
  );
}

function OpenedAgentSection({
  showEditor,
  agentId,
  serverId,
  library,
  acknowledged,
  onAcknowledged,
  reportDraft,
  projects,
  newOwner,
}: {
  showEditor: boolean;
  agentId: string | undefined;
  serverId: string | null;
  library: ReturnType<typeof useAgentsLibrary>;
  acknowledged: AgentDefinition | null;
  onAcknowledged: (agent: AgentDefinition) => void;
  reportDraft: ReportDraft;
  projects: readonly FactoryProject[];
  newOwner: ReturnType<typeof useNewAgentOwner>;
}) {
  if (!showEditor || agentId === undefined) return null;
  const known = acknowledged?.id === agentId ? acknowledged : null;
  return (
    <section
      aria-label="Agent editor"
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l pl-6"
    >
      <SelectedAgentEditor
        key={`${serverId ?? ""}:${agentId}`}
        agentId={agentId}
        library={library}
        acknowledged={known}
        onAcknowledged={onAcknowledged}
        reportDraft={reportDraft}
        projects={projects}
        newOwner={newOwner}
      />
    </section>
  );
}

type AgentRowAction =
  | { readonly kind: "owner"; readonly agent: AgentDefinition }
  | { readonly kind: "duplicate"; readonly agent: AgentDefinition; readonly target: string | null }
  | { readonly kind: "remove"; readonly agent: AgentDefinition };

function AgentListDialogs({
  action,
  definitions,
  projects,
  flows,
  onClose,
  onDuplicate,
  onRemoved,
}: {
  action: AgentRowAction | null;
  definitions: StudioDefinitions;
  projects: readonly FactoryProject[];
  flows: readonly FlowDraft[];
  onClose: () => void;
  onDuplicate: (agent: AgentDefinition, target: string | null) => void;
  onRemoved: (agent: AgentDefinition) => void;
}) {
  if (!action) return null;
  const subject = {
    id: action.agent.id,
    name: action.agent.name,
    projectId: action.agent.projectId,
  };
  if (action.kind === "owner")
    return (
      <ChangeOwnerDialog
        kind="Agent"
        subject={subject}
        definitions={definitions}
        onClose={onClose}
        onChanged={onClose}
        onDuplicateInstead={(target) => onDuplicate(action.agent, target)}
      />
    );
  if (action.kind === "duplicate")
    return (
      <AgentDuplicateFromList
        agent={action.agent}
        target={action.target}
        subject={subject}
        definitions={definitions}
        projects={projects}
        onClose={onClose}
      />
    );
  return (
    <AgentRemoveFromList
      agent={action.agent}
      definitions={definitions}
      projects={projects}
      flows={flows}
      onClose={onClose}
      onRemoved={onRemoved}
    />
  );
}

function AgentDuplicateFromList({
  agent,
  target,
  subject,
  definitions,
  projects,
  onClose,
}: {
  agent: AgentDefinition;
  target: string | null;
  subject: { id: string; name: string; projectId: string | null };
  definitions: StudioDefinitions;
  projects: readonly FactoryProject[];
  onClose: () => void;
}) {
  const openStudio = useStudioNavigation();
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState("");
  return (
    <DuplicateAgentDialog
      source={subject}
      projects={projects}
      initialTarget={target}
      duplicating={duplicating}
      error={error}
      onClose={onClose}
      onDuplicate={(next) => {
        setDuplicating(true);
        setError("");
        void definitions
          .duplicateAgent(agent.id, { projectId: next })
          .then((copy) => {
            onClose();
            void openStudio({ tab: "agents", agentId: copy.id });
          })
          .catch((cause: unknown) => {
            setError(
              cause instanceof Error ? cause.message : "Factory could not duplicate this Agent.",
            );
            setDuplicating(false);
          });
      }}
    />
  );
}

function AgentRemoveFromList({
  agent,
  definitions,
  projects,
  flows,
  onClose,
  onRemoved,
}: {
  agent: AgentDefinition;
  definitions: StudioDefinitions;
  projects: readonly FactoryProject[];
  flows: readonly FlowDraft[];
  onClose: () => void;
  onRemoved: (agent: AgentDefinition) => void;
}) {
  const openStudio = useStudioNavigation();
  const [removing, setRemoving] = useState(false);
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([]);
  const [error, setError] = useState("");
  const placing = placingFlows(flows, agent.id);
  const raced = namedBlockers(issues, "agent_in_use").filter(
    (blocker) => !placing.some((flow) => flow.id === blocker.id),
  );
  const openFlow = (id: string) => void openStudio({ tab: "flows", flowId: id });
  if (placing.length > 0 || raced.length > 0)
    return (
      <CantRemoveDialog open name={agent.name} label="Flows" onClose={onClose}>
        {flowBlockers(placing, projects, openFlow)}
        {racedBlockers(raced, "Flow", openFlow)}
      </CantRemoveDialog>
    );
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !removing) onClose();
      }}
    >
      <DialogContent
        title={<>Remove “{agent.name}”?</>}
        description="Removing this Agent removes it from Studio and keeps its saved revisions for existing Runs."
        closeDisabled={removing}
        actions={
          <>
            <Button type="button" variant="outline" disabled={removing} onClick={onClose}>
              Cancel
            </Button>
            <MutationGate>
              <Button
                type="button"
                variant="destructive"
                disabled={removing}
                onClick={() => {
                  setRemoving(true);
                  void definitions
                    .removeAgent(agent.id)
                    .then(() => onRemoved(agent))
                    .catch((cause: unknown) => {
                      setIssues(cause instanceof ApiError ? cause.detail.issues : []);
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Factory could not remove this Agent.",
                      );
                      setRemoving(false);
                    });
                }}
              >
                {removing ? "Removing…" : "Remove Agent"}
              </Button>
            </MutationGate>
          </>
        }
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The saved Agent an editor opens over: the first one Studio lists for this visit, or this
 * window's acknowledged Create or Duplicate before Studio delivers it. Once opened, the draft
 * follows Studio itself, so a later removal keeps the opened editor. `undefined` while loading.
 */
function useOpenedAgent(
  agentId: string,
  library: ReturnType<typeof useAgentsLibrary>,
  acknowledged: AgentDefinition | null,
) {
  const creating = agentId === "new";
  const pending = library.definitions.hasObserved("agents", agentId) ? null : acknowledged;
  const listed = library.agents?.find((entry) => entry.id === agentId) ?? pending;
  const [opened, setOpened] = useState<AgentDefinition | null>(null);
  if (!creating && !opened && listed) setOpened(listed);
  if (creating) return { agent: null, unavailable: false };
  const agent = opened ?? listed ?? undefined;
  return { agent, unavailable: !agent && Boolean(library.error || library.agents) };
}

function SelectedAgentEditor({
  agentId,
  library,
  acknowledged,
  onAcknowledged,
  reportDraft,
  projects,
  newOwner,
}: {
  agentId: string;
  library: ReturnType<typeof useAgentsLibrary>;
  acknowledged: AgentDefinition | null;
  onAcknowledged: (agent: AgentDefinition) => void;
  reportDraft: ReportDraft;
  projects: readonly FactoryProject[];
  newOwner: ReturnType<typeof useNewAgentOwner>;
}) {
  const openStudio = useStudioNavigation();
  const active = useActiveView();
  const { agent, unavailable } = useOpenedAgent(agentId, library, acknowledged);
  const saved = (value: AgentDefinition) => {
    void library.refreshReporting();
    if (!active.current) return;
    if (value.id === agentId) return;
    onAcknowledged(value);
    void openStudio({ tab: "agents", agentId: value.id });
  };
  const deleted = () => {
    void library.refreshReporting();
    if (!active.current) return;
    void openStudio({ tab: "agents" });
  };
  if (unavailable)
    return (
      <div className="grid justify-items-start gap-3 p-8">
        <p role="alert" className="text-sm text-destructive">
          {library.error ? "Factory could not load this Agent editor." : "Agent not found"}
        </p>
        <Button variant="outline" onClick={() => void openStudio({ tab: "agents" })}>
          Back to list
        </Button>
      </div>
    );
  if (agent === undefined || library.capabilities === undefined) {
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        Loading Agent…
      </p>
    );
  }
  return (
    <OpenedAgentEditor
      agent={agent}
      capabilities={library.capabilities}
      source={library.definitions}
      agentId={agentId}
      flowUsage={placingFlows(library.flows ?? [], agentId).length}
      flows={library.flows ?? []}
      projects={projects}
      newOwner={newOwner}
      reportDraft={reportDraft}
      onSaved={saved}
      onDuplicated={saved}
      onDeleted={deleted}
    />
  );
}

/**
 * A saved Agent's owner for its badge, or a new Agent's owner choice. The choice follows its
 * default until the user picks an owner; a saved Agent keeps its own.
 */
function useAgentOwnership(
  saved: AgentDefinition | null,
  /** The saved Agent's owning Project as Studio shows it now. */
  owner: string | null,
  projects: readonly FactoryProject[],
  newOwner: ReturnType<typeof useNewAgentOwner>,
) {
  const [picked, setPicked] = useState<{ readonly owner: string | null }>();
  if (saved) return { kind: "saved", owner: studioOwner(owner, projects), projects } as const;
  const chosen = picked ? picked.owner : newOwner.initial;
  return {
    kind: "new",
    chosen,
    initial: newOwner.initial,
    projects,
    hint: newOwner.hint,
    blocked: ownerPicker(chosen, projects).blocked,
    onChange: (owner: string | null) => setPicked({ owner }),
  } as const;
}

/**
 * One loaded editor owns its draft, which follows Studio's saved Agents while mounted; disposal
 * detaches it and clears only its own Studio guard.
 */
function useOpenedAgentDraft(
  agent: AgentDefinition | null,
  capabilities: AgentCapabilities | null,
  source: AgentDraftSource,
  id: string,
  reportDraft: ReportDraft,
) {
  const [draft] = useState(() => createAgentDraft(agent, capabilities, source));
  useEffect(() => draft.connect(), [draft]);
  useDraftGuard(draft, id, reportDraft);
  return { draft, state: useAgentDraftSnapshot(draft) };
}

type AgentOwnerDialog =
  | { readonly kind: "change-owner" }
  | { readonly kind: "duplicate"; readonly target?: string | null };

/**
 * The open owner dialog of an Agent editor and its Duplicate; Duplicate may come with the target
 * a refused Change owner named.
 */
function useAgentOwnerDialogs(
  draft: AgentDraftModel,
  onDuplicated: (copy: AgentDefinition) => void,
) {
  const [dialog, setDialog] = useState<AgentOwnerDialog | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState("");
  return {
    dialog,
    duplicating,
    error,
    open: setDialog,
    close() {
      setDialog(null);
      setError("");
    },
    async duplicate(target: string | null) {
      if (duplicating) return;
      setDuplicating(true);
      setError("");
      await draft
        .duplicate(target)
        .then((copy) => {
          if (!copy) return;
          setDialog(null);
          onDuplicated(copy);
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : "Factory could not duplicate this Agent.",
          );
        })
        .finally(() => setDuplicating(false));
    },
  };
}

function AgentOwnerDialogs({
  dialogs,
  draft,
  state,
  source,
  projects,
}: {
  dialogs: ReturnType<typeof useAgentOwnerDialogs>;
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  source: StudioDefinitions;
  projects: readonly FactoryProject[];
}) {
  const { dialog } = dialogs;
  const { saved } = state;
  if (!saved || !dialog) return null;
  const subject = { id: saved.id, name: saved.name, projectId: state.owner };
  if (dialog.kind === "change-owner")
    return (
      <ChangeOwnerDialog
        kind="Agent"
        subject={subject}
        definitions={source}
        onClose={dialogs.close}
        onChanged={draft.ownerChangedHere}
        onDuplicateInstead={(target) => dialogs.open({ kind: "duplicate", target })}
        duplicateBlocked={
          state.dirty ? "Save your changes before duplicating this Agent." : undefined
        }
      />
    );
  return (
    <DuplicateAgentDialog
      source={subject}
      projects={projects}
      initialTarget={dialog.target}
      duplicating={dialogs.duplicating}
      error={dialogs.error}
      onClose={dialogs.close}
      onDuplicate={(target) => void dialogs.duplicate(target)}
    />
  );
}

function OpenedAgentEditor({
  agent,
  capabilities,
  source,
  agentId,
  reportDraft,
  onSaved,
  onDuplicated,
  projects,
  newOwner,
  ...props
}: {
  agent: AgentDefinition | null;
  capabilities: AgentCapabilities | null;
  source: StudioDefinitions;
  agentId: string;
  reportDraft: ReportDraft;
  projects: readonly FactoryProject[];
  newOwner: ReturnType<typeof useNewAgentOwner>;
  onSaved: (agent: AgentDefinition) => void;
  onDuplicated: (agent: AgentDefinition) => void;
  flowUsage: number;
  flows: readonly FlowDraft[];
  onDeleted: () => void;
}) {
  const { draft, state } = useOpenedAgentDraft(agent, capabilities, source, agentId, reportDraft);
  const exporter = useDefinitionExport(() => api.exportAgent(agentId));
  const ownership = useAgentOwnership(state.saved, state.owner, projects, newOwner);
  const dialogs = useAgentOwnerDialogs(draft, onDuplicated);
  async function save() {
    if (ownership.kind === "new" && ownership.blocked) return;
    const result = await draft.save(ownership.kind === "new" ? ownership.chosen : null);
    if (result) onSaved(result);
  }
  const notice = definitionExportNotice(exporter.state);
  return (
    <>
      {notice && (
        <p className="shrink-0 px-6 pt-4 text-sm text-attention md:px-8" role="status">
          {notice}
        </p>
      )}
      <AgentEditorPane
        {...props}
        draft={draft}
        state={state}
        capabilities={capabilities}
        ownership={ownership}
        exporter={agentId === "new" ? undefined : exporter}
        onSave={save}
        duplicating={dialogs.duplicating}
        onDuplicate={agent ? () => dialogs.open({ kind: "duplicate" }) : undefined}
        onChangeOwner={agent ? () => dialogs.open({ kind: "change-owner" }) : undefined}
      />
      <AgentOwnerDialogs
        dialogs={dialogs}
        draft={draft}
        state={state}
        source={source}
        projects={projects}
      />
    </>
  );
}
