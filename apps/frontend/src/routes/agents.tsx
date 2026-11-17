import { Button } from "../components/ui/button";
import { useEffect, useState } from "react";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import type { AgentCapabilities, AgentDefinition, FactoryProject } from "@t3-factory/contracts";
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
import { AgentsListPane } from "../components/studio-agents/agents-list-pane.tsx";
import { AgentEditorPane } from "../components/studio-agents/agent-editor-pane.tsx";
import { flowUsageCount } from "@/lib/agent-display";
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
  const error = agentsRead.error || flowsRead.error ? "Factory could not load Agents." : "";
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
  const library = useAgentsLibrary(definitions);
  const owners = useStudioOwners(definitions);
  const newOwner = useNewAgentOwner(definitions, library.flows, fromFlow);
  const serverId = useServerId();
  const [query, setQuery] = useState("");
  // This window's own Create or Duplicate, answered before Studio may have delivered it.
  const [acknowledged, setAcknowledged] = useState<AgentDefinition | null>(null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <AgentsListPane
        agents={library.agents}
        flows={library.flows}
        capabilities={library.capabilities ?? null}
        owners={owners}
        selectedId={agentId}
        creatingNew={agentId === "new"}
        query={query}
        onQueryChange={setQuery}
        onCreate={() => void openStudio({ tab: "agents", agentId: "new" })}
        onImported={(result) => void openImported(result, definitions, openStudio)}
        error={library.error}
        loading={library.agents === null || library.flows === null}
      />
      <section
        aria-label="Agent editor"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        {agentId ? (
          <SelectedAgentEditor
            // An editor never outlives its server, so a pending reply from another one is discarded.
            key={`${serverId ?? ""}:${agentId}`}
            agentId={agentId}
            library={library}
            acknowledged={acknowledged?.id === agentId ? acknowledged : null}
            onAcknowledged={setAcknowledged}
            reportDraft={reportAgentDraft}
            projects={owners.projects}
            newOwner={newOwner}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              Select an Agent from the list to edit it here, or add a new Agent definition.
            </p>
          </div>
        )}
      </section>
    </div>
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
      flowUsage={flowUsageCount(library.flows ?? [], agentId)}
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
