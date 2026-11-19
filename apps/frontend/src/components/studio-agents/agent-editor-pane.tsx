import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { StudioRemovedDraft } from "../studio-removed-draft.tsx";
import { useState } from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FactoryProject,
  FlowDraft,
} from "@t3-factory/contracts";
import { fieldLabelClass } from "@/components/page";
import { ChevronRight, Copy, FolderGit2, MoreHorizontal, Unplug } from "lucide-react";
import { agentReportingStatus, useReportingState } from "../../reporting-state.tsx";
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  StudioEditorHeader,
  StudioSaveButton,
  StudioSaveStatus,
} from "../studio-editor-header.tsx";
import { cn } from "@/lib/utils";
import {
  createShapedContent,
  type AgentDraftModel,
  type AgentDraftSnapshot,
} from "../../agent-draft.ts";
import { flowUsageLabel, placingFlows } from "@/lib/agent-display";
import { AgentExitsField } from "./agent-exits-field.tsx";
import { DefinitionExportDialog, DefinitionExportMenuItem } from "../definition-export-control.tsx";
import { useMenuActions } from "../menu-actions.ts";
import type { DefinitionExportModel, DefinitionExportSnapshot } from "../../definition-export.ts";
import { AgentRevisionCard, AgentUpdatedNotice } from "./agent-revision-panel.tsx";
import { AgentModelPicker } from "./agent-model-picker.tsx";
import { OwnerChangeNotice, OwnerPicker, ownerName } from "../studio-owner.tsx";
import {
  CantRemoveDialog,
  RemoveMenuItem,
  flowBlockers,
  namedBlockers,
  racedBlockers,
} from "../studio-removal.tsx";
import { useStudioNavigation } from "../../settings-navigation.ts";
import type { StudioOwner } from "../../studio-definitions.ts";
import { TextLink } from "@/components/ui/text-link";
import { SettingsLink } from "../app-link.tsx";
import { ProblemCard } from "../problem-card.tsx";

/** A saved Agent's owner, or the owner choice of a new one. */
type AgentOwnership =
  | {
      readonly kind: "saved";
      readonly owner: StudioOwner;
      readonly projects: readonly FactoryProject[];
    }
  | {
      readonly kind: "new";
      readonly chosen: string | null;
      readonly initial: string | null;
      readonly projects: readonly FactoryProject[];
      /** Why the chosen owner cannot own a new Agent; Create waits for another choice. */
      readonly blocked: string | null;
      readonly onChange: (owner: string | null) => void;
    };

type AgentEditorProps = {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  capabilities: AgentCapabilities | null;
  ownership: AgentOwnership;
  flowUsage: number;
  /** Saved Flows, so Remove can name the ones that still place this Agent. */
  flows: readonly FlowDraft[];
  duplicating: boolean;
  onSave: () => Promise<void>;
  /** Opens the Agent a lost Create made. */
  onOpenCreated: (agent: AgentDefinition) => void;
  /** Opens Duplicate…; absent before the first save. */
  onDuplicate?: (() => void) | undefined;
  /** Opens Change owner…; absent before the first save. */
  onChangeOwner?: (() => void) | undefined;
  /** Absent until the Agent's first save. */
  exporter?: { model: DefinitionExportModel; state: DefinitionExportSnapshot } | undefined;
  onDeleted: () => void;
};

/** The cards' ids, which the fields they explain point at with `aria-describedby`. */
const exitsCardId = "agent-exits-problem";
const workerCardId = "agent-worker-problem";

export function AgentEditorPane(props: AgentEditorProps) {
  const { capabilities, draft, state, ownership } = props;
  const { name, prompt, exits, execution, projectOverrides } = state.content;
  // Only a global Agent has Project overrides; a Project Agent's own Worker applies there.
  const global =
    ownership.kind === "saved" ? ownership.owner.projectId === null : ownership.chosen === null;
  // A Project that left T3 while the editor was open makes it read-only until Change owner….
  const ownerGone = ownership.kind === "saved" && ownership.owner.gone;
  const settings = { ...state.choices, ...draft, execution, needsModel: state.needsModel };
  const saving = (state.saving || props.duplicating) && !state.removed;
  const reporting = useReportingState();
  const reportingStatus = execution.providerInstanceId
    ? agentReportingStatus(execution.providerInstanceId, reporting)
    : null;
  const reportingProblem = reportingStatus?.state === "attention" ? reportingStatus : null;
  const readOnly = saving || ownerGone;
  const agent = state.saved;
  return (
    <form
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSave();
      }}
    >
      <StudioEditorHeader
        layout="stacked"
        title={agentTitle(state)}
        controls={
          <AgentModelPicker
            settings={settings}
            capabilities={capabilities}
            saving={saving}
            disabled={ownerGone || state.removed}
            attention={reportingProblem !== null}
            describedBy={workerCardId}
            overrides={
              global
                ? {
                    list: projectOverrides,
                    projects: ownership.projects,
                    onSet: draft.setOverride,
                    onRemove: draft.removeOverride,
                  }
                : undefined
            }
          />
        }
        moreActions={agent && <AgentMoreActions {...props} agent={agent} saving={saving} />}
        save={
          <AgentSaveButton
            state={state}
            ownership={ownership}
            saving={saving}
            ownerGone={ownerGone}
          />
        }
        status={<AgentSaveStatus state={state} flowUsage={props.flowUsage} />}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <AgentEditorCards
          {...props}
          ownerGone={ownerGone}
          global={global}
          reportingProblem={reportingProblem}
        />
        <fieldset
          disabled={readOnly}
          // A Project gone from T3 leaves the form readable but not editable.
          inert={ownerGone || undefined}
          className={cn("flex min-w-0 flex-col gap-4", ownerGone && "opacity-60")}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name" className={fieldLabelClass}>
              Name
            </Label>
            <Input
              id="agent-name"
              maxLength={200}
              value={name}
              onChange={(event) => draft.edit({ name: event.target.value })}
              className="bg-muted"
            />
          </div>
          {ownership.kind === "new" && (
            <OwnerPicker
              kind="Agent"
              chosen={ownership.chosen}
              projects={ownership.projects}
              onChange={ownership.onChange}
              disabled={saving}
              initial={ownership.initial}
              hint=""
            />
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="agent-prompt" className={fieldLabelClass}>
              Prompt
            </Label>
            <Textarea
              id="agent-prompt"
              rows={6}
              value={prompt}
              onChange={(event) => draft.edit({ prompt: event.target.value })}
              className="h-38 min-h-24 resize-y bg-muted font-mono text-xs"
            />
          </div>
          <AgentExitsField
            exits={exits}
            disabled={readOnly}
            problems={state.exitProblems?.tags}
            problemCardId={exitsCardId}
            onChange={(next) => draft.edit({ exits: next })}
          />
        </fieldset>
      </div>
    </form>
  );
}

type CardProps = AgentEditorProps & {
  ownerGone: boolean;
  global: boolean;
  reportingProblem: ReturnType<typeof agentReportingStatus> | null;
};

/**
 * One card per page-level problem, under the editor header: the owner, a removal elsewhere,
 * saving, exit names, a newer revision, owner changes, Project overrides and the Worker.
 */
function AgentEditorCards(props: CardProps) {
  const { draft, state, ownership, capabilities, onOpenCreated } = props;
  return (
    <>
      <AgentUpdatedNotice draft={draft} state={state} />
      <OwnerGoneCard {...props} />
      {state.removed && (
        <StudioRemovedDraft
          kind="Agent"
          json={JSON.stringify(createShapedContent(state.content), null, 2)}
        />
      )}
      <SaveOutcomeCard draft={draft} state={state} onOpenCreated={onOpenCreated} />
      {state.exitProblems && (
        <ProblemCard id={exitsCardId} tone="error" title={state.exitProblems.card.title}>
          {state.exitProblems.card.body}
        </ProblemCard>
      )}
      {!state.removed && (
        <AgentRevisionCard
          draft={draft}
          state={state}
          projects={ownership.projects}
          capabilities={capabilities}
        />
      )}
      {!state.removed && ownership.kind === "saved" && (
        <OwnerChangeNotice
          kind="Agent"
          change={state.ownerChange}
          projects={ownership.projects}
          onAcknowledge={draft.acknowledgeOwner}
        />
      )}
      <OverridesCard {...props} />
      <WorkerCard {...props} />
    </>
  );
}

/** Figma SA06u: the owning Project left T3 while the editor was open. */
function OwnerGoneCard({ ownership, ownerGone, onChangeOwner }: CardProps) {
  if (ownership.kind !== "saved" || !ownerGone) return null;
  return (
    <ProblemCard
      tone="attention"
      icon={Unplug}
      title={`${ownership.owner.title} is no longer in T3`}
      action={onChangeOwner && <TextLink onClick={onChangeOwner}>Change owner…</TextLink>}
    >
      This Agent can’t be edited or placed until it has an owner in T3.
    </ProblemCard>
  );
}

/** Project overrides a Project Agent can't keep (SA06n), or that Create leaves out. */
function OverridesCard({ draft, state, ownership, global }: CardProps) {
  const overrides = state.content.projectOverrides.length;
  // While an owner change waits for acknowledgement, its own card is the one message.
  if (global || overrides === 0 || state.removed || state.ownerChange.status !== "none")
    return null;
  if (ownership.kind === "saved")
    return state.strandedOverrides ? (
      <ProblemCard
        tone="attention"
        title="Project overrides can’t be kept"
        action={
          <TextLink onClick={draft.removeOverrides}>
            {overrides === 1 ? "Remove override" : "Remove overrides"}
          </TextLink>
        }
      >
        This Agent is owned by {ownerName(ownership.owner)} now, and a Project Agent has no Project
        overrides.
      </ProblemCard>
    ) : null;
  return (
    <ProblemCard tone="attention" title="Project overrides left out">
      A Project Agent has no Project overrides. Choose Global to keep them.
    </ProblemCard>
  );
}

/** Needs a model (SA06h), else reporting not configured for the chosen provider (SA06i). */
function WorkerCard({ state, ownerGone, reportingProblem }: CardProps) {
  if (ownerGone) return null;
  if (state.needsModel)
    return (
      <ProblemCard id={workerCardId} tone="attention" title="Needs a model">
        Flows that use this Agent can’t start until it has one.
      </ProblemCard>
    );
  if (!reportingProblem) return null;
  return (
    <ProblemCard
      id={workerCardId}
      label="Agent reporting status"
      tone="attention"
      title={reportingProblem.label}
      action={
        <TextLink asChild trailingIcon={ChevronRight}>
          <SettingsLink selection={{ tab: "agent-reporting" }}>Open Agent reporting</SettingsLink>
        </TextLink>
      }
    >
      {reportingProblem.message}
    </ProblemCard>
  );
}

const createOutcomeCopy = {
  checking: "Factory may have created this Agent. Checking before it can be created again…",
  created: "Factory created this Agent.",
  removed: "Factory created this Agent and it was removed elsewhere. Your changes are kept.",
  absent: "Factory didn’t create this Agent. Your changes are kept.",
  unconfirmed: "Factory couldn’t confirm the outcome. Your changes are kept.",
};

function CreateOutcomeCard({
  status,
  draft,
  onOpenCreated,
}: {
  status: keyof typeof createOutcomeCopy;
  draft: AgentDraftModel;
  onOpenCreated: (agent: AgentDefinition) => void;
}) {
  const actions = {
    created: (
      <TextLink
        trailingIcon={ChevronRight}
        onClick={() => {
          const made = draft.openCreated();
          if (made) onOpenCreated(made);
        }}
      >
        Open Agent
      </TextLink>
    ),
    absent: <TextLink onClick={draft.createAgain}>Create again</TextLink>,
    unconfirmed: <TextLink onClick={() => void draft.checkCreate()}>Check again</TextLink>,
    checking: undefined,
    removed: undefined,
  };
  return (
    <ProblemCard tone="attention" title="Create outcome unknown" action={actions[status]}>
      {createOutcomeCopy[status]}
    </ProblemCard>
  );
}

/** A refused save or one whose reply was lost. */
function SaveOutcomeCard({
  draft,
  state,
  onOpenCreated,
}: {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  onOpenCreated: (agent: AgentDefinition) => void;
}) {
  const { status } = state.createCheck;
  if (status !== "none")
    return <CreateOutcomeCard status={status} draft={draft} onOpenCreated={onOpenCreated} />;
  if (!state.error) return null;
  if (state.saveOutcome === "unknown")
    return (
      <ProblemCard tone="attention" title="Save outcome unknown">
        {state.error}
      </ProblemCard>
    );
  return (
    <ProblemCard tone="error" title="Couldn’t save the Agent">
      Your changes are kept. {state.error}
    </ProblemCard>
  );
}

/** The draft's name, the saved name while it is blank, or **New Agent** before the first save. */
function agentTitle({ saved, content }: AgentDraftSnapshot) {
  return saved ? content.name || saved.name : "New Agent";
}

/** **Save**, or **Create Agent** for a new Agent, under the one Save rule. */
function AgentSaveButton({
  state,
  ownership,
  saving,
  ownerGone,
}: Pick<AgentEditorProps, "state" | "ownership"> & { saving: boolean; ownerGone: boolean }) {
  const ownerBlock = ownership.kind === "new" ? ownership.blocked : null;
  return (
    <StudioSaveButton
      type="submit"
      unsaved={state.dirty}
      ready={state.canSave && !ownerBlock && state.content.name.trim() !== "" && !ownerGone}
      saving={saving}
    >
      {state.saved ? "Save" : "Create Agent"}
    </StudioSaveButton>
  );
}

/** The status line: the save state, revision and Flow usage of a saved Agent. */
function AgentSaveStatus({ state, flowUsage }: { state: AgentDraftSnapshot; flowUsage: number }) {
  const agent = state.saved;
  const usage = flowUsage === 0 ? "Unused" : `Used in ${flowUsageLabel(flowUsage)}`;
  return (
    <StudioSaveStatus unsaved={!agent || state.dirty || state.removed}>
      {state.removed
        ? "Removed elsewhere"
        : !agent
          ? "Not saved yet"
          : `${state.dirty ? "Unsaved changes" : "Saved"} · Revision ${agent.revision} · ${usage}`}
    </StudioSaveStatus>
  );
}

/**
 * Figma SA06q: Duplicate…, Change owner…, Export JSON, Remove worker and Remove… act on the
 * saved revision, so they exist only after the first save.
 */
function AgentMoreActions({
  agent,
  draft,
  state,
  flows,
  saving,
  ownership,
  onDuplicate,
  onChangeOwner,
  exporter,
  onDeleted,
}: AgentEditorProps & { agent: AgentDefinition; saving: boolean }) {
  const { trigger, queue, onCloseAutoFocus } = useMenuActions();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingWorker, setConfirmingWorker] = useState(false);
  if (confirmingDelete && state.removed && !state.removing) setConfirmingDelete(false);
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={trigger}
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More actions"
                disabled={saving || state.removed}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-58" onCloseAutoFocus={onCloseAutoFocus}>
          <AgentMenuItems
            state={state}
            onDuplicate={onDuplicate}
            onChangeOwner={onChangeOwner}
            exporter={exporter}
            queue={queue}
            onRemoveWorker={() => {
              if (draft.getSnapshot().content.projectOverrides.length) setConfirmingWorker(true);
              else draft.removeWorker();
            }}
            onDelete={() => {
              if (draft.getSnapshot().removed) return;
              draft.clearRemovalError();
              setConfirmingDelete(true);
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {exporter && <DefinitionExportDialog {...exporter} />}
      <AlertDialog open={confirmingWorker} onOpenChange={setConfirmingWorker}>
        <AlertDialogContent
          title="Remove worker and Project overrides?"
          description="Saving without a Worker also removes all Project overrides from this Agent."
          actions={
            <>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <MutationGate>
                <Button
                  variant="destructive"
                  onClick={() => {
                    draft.removeWorker();
                    setConfirmingWorker(false);
                  }}
                >
                  Remove worker
                </Button>
              </MutationGate>
            </>
          }
          onCloseAutoFocus={(event) => {
            if (!trigger.current?.isConnected) return;
            event.preventDefault();
            trigger.current.focus();
          }}
        />
      </AlertDialog>
      <AgentRemoveDialog
        open={confirmingDelete}
        agent={agent}
        draft={draft}
        state={state}
        flows={flows}
        projects={ownership.projects}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={onDeleted}
      />
    </>
  );
}

function AgentMenuItems({
  state,
  onDuplicate,
  onChangeOwner,
  exporter,
  queue,
  onDelete,
  onRemoveWorker,
}: Pick<AgentEditorProps, "state" | "onDuplicate" | "onChangeOwner" | "exporter"> & {
  queue: (action: () => void) => void;
  onDelete: () => void;
  onRemoveWorker: () => void;
}) {
  const writable = useMutationsAllowed();
  // **Remove worker** is the deliberate way back to Needs a model now that the picker has no Clear.
  const canRemoveWorker =
    Boolean(state.saved?.execution) &&
    (!state.needsModel || state.content.projectOverrides.length > 0);
  return (
    <>
      {onDuplicate && (
        <DropdownMenuItem
          aria-label="Duplicate"
          disabled={!writable}
          onSelect={() => queue(onDuplicate)}
        >
          <Copy aria-hidden />
          Duplicate…
        </DropdownMenuItem>
      )}
      {onChangeOwner && (
        <DropdownMenuItem disabled={!writable} onSelect={() => queue(onChangeOwner)}>
          <FolderGit2 aria-hidden />
          Change owner…
        </DropdownMenuItem>
      )}
      {exporter && (
        <DefinitionExportMenuItem
          state={exporter.state}
          disabled={false}
          onSelect={() => queue(() => void exporter.model.request(state.dirty))}
        />
      )}
      {canRemoveWorker && (
        <DropdownMenuItem disabled={!writable} onSelect={() => queue(onRemoveWorker)}>
          <Unplug aria-hidden />
          Remove worker
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <RemoveMenuItem disabled={!writable} onSelect={() => queue(onDelete)} />
    </>
  );
}

/** Figma SA06s / SA05: Remove… confirms, or lists the Flows that still place the Agent. */
function AgentRemoveDialog({
  open,
  agent,
  draft,
  state,
  flows,
  projects,
  onClose,
  onDeleted,
}: {
  open: boolean;
  agent: AgentDefinition;
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  flows: readonly FlowDraft[];
  projects: readonly FactoryProject[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const openStudio = useStudioNavigation();
  const { removing, removalError, removalIssues } = state;
  const placing = placingFlows(flows, agent.id);
  const raced = namedBlockers(removalIssues, "agent_in_use").filter(
    (blocker) => !placing.some((flow) => flow.id === blocker.id),
  );
  async function confirm() {
    if (await draft.remove()) {
      onClose();
      onDeleted();
    }
  }
  if (placing.length > 0 || raced.length > 0)
    return (
      <CantRemoveDialog open={open} name={agent.name} label="Flows" onClose={onClose}>
        {flowBlockers(placing, projects, (id) => void openStudio({ tab: "flows", flowId: id }))}
        {racedBlockers(raced, "Flow", (id) => void openStudio({ tab: "flows", flowId: id }))}
      </CantRemoveDialog>
    );
  const inUse = removalIssues.some((issue) => issue.code === "agent_in_use");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !removing) onClose();
      }}
    >
      <DialogContent
        title={<>Remove “{agent.name}”?</>}
        description="Runs that used it keep the revision they started with."
        actions={
          <>
            <Button type="button" variant="outline" disabled={removing} onClick={onClose}>
              Cancel
            </Button>
            <MutationGate>
              <Button
                type="button"
                variant="destructive"
                disabled={removing || state.removed}
                onClick={() => void confirm()}
              >
                {removing ? "Removing…" : "Remove Agent"}
              </Button>
            </MutationGate>
          </>
        }
        closeDisabled={removing}
      >
        {removalError && !inUse && (
          <ProblemCard tone="error" title="Couldn’t remove the Agent">
            {removalError}
          </ProblemCard>
        )}
      </DialogContent>
    </Dialog>
  );
}
