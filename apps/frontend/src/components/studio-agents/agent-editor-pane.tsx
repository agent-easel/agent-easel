import { LaunchSkillStatus } from "../launch-skill-status.tsx";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { StudioRemovedDraft } from "../studio-removed-draft.tsx";
import { useState, type ReactNode } from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentProjectOverride,
  FactoryProject,
  FlowDraft,
} from "@t3-factory/contracts";
import { fieldLabelClass } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Check, CircleAlert, Copy, FolderGit2, MoreHorizontal, Workflow } from "lucide-react";
import { SettingsLink } from "../app-link.tsx";
import { agentReportingStatus, useReportingState } from "../../reporting-state.tsx";
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
import { cn } from "@/lib/utils";
import {
  createShapedContent,
  type AgentDraftModel,
  type AgentDraftSnapshot,
} from "../../agent-draft.ts";
import { agentRuntimeMeta, flowUsageLabel, placingFlows } from "@/lib/agent-display";
import { AgentExitsField } from "./agent-exits-field.tsx";
import { DefinitionExportDialog, DefinitionExportMenuItem } from "../definition-export-control.tsx";
import { useMenuActions } from "../menu-actions.ts";
import type { DefinitionExportModel, DefinitionExportSnapshot } from "../../definition-export.ts";
import { AgentRevisionPanel } from "./agent-revision-panel.tsx";
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
import { studioOwner, type StudioOwner } from "../../studio-definitions.ts";

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
      readonly hint: string;
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
  /** Opens Duplicate…; absent before the first save. */
  onDuplicate?: (() => void) | undefined;
  /** Opens Change owner…; absent before the first save. */
  onChangeOwner?: (() => void) | undefined;
  /** Absent until the Agent's first save. */
  exporter?: { model: DefinitionExportModel; state: DefinitionExportSnapshot } | undefined;
  onDeleted: () => void;
};

export function AgentEditorPane(props: AgentEditorProps) {
  const { capabilities, draft, state } = props;
  const { name, prompt, exits, execution, projectOverrides } = state.content;
  const { ownership } = props;
  // Only a global Agent has Project overrides; a Project Agent's own Worker applies there.
  const global =
    ownership.kind === "saved" ? ownership.owner.projectId === null : ownership.chosen === null;
  const settings = { ...state.choices, ...draft, execution, needsModel: state.needsModel };
  const saving = (state.saving || props.duplicating) && !state.removed;
  const error = state.error;
  return (
    <>
      <form
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSave();
        }}
      >
        <AgentEditorHeader
          {...props}
          name={name}
          saving={saving}
          picker={
            <AgentModelPicker
              settings={settings}
              capabilities={capabilities}
              saving={saving}
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
        />
        {state.removed ? (
          <StudioRemovedDraft
            kind="Agent"
            json={JSON.stringify(createShapedContent(state.content), null, 2)}
          />
        ) : (
          <>
            {props.ownership.kind === "saved" && (
              <OwnerChangeNotice
                kind="Agent"
                change={state.ownerChange}
                projects={props.ownership.projects}
                onAcknowledge={draft.acknowledgeOwner}
                className="rounded-none border-x-0 border-t-0 px-4 sm:px-6 md:px-8"
              />
            )}
            <AgentRevisionPanel draft={draft} state={state} projects={ownership.projects} />
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6 md:px-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            {settings.execution.providerInstanceId && (
              <AgentReportingNotice providerId={settings.execution.providerInstanceId} />
            )}
            {!global && state.strandedOverrides && (
              <StrandedOverrides
                overrides={projectOverrides}
                owner={ownership.kind === "saved" ? ownership.owner.title : ""}
                projects={ownership.projects}
                capabilities={capabilities}
                disabled={saving}
                onRemove={draft.removeOverrides}
              />
            )}
            {!global && !state.saved && projectOverrides.length > 0 && (
              <Alert role="status" variant="attention">
                <CircleAlert aria-hidden />
                <AlertTitle>Project overrides left out</AlertTitle>
                <AlertDescription>
                  A Project Agent has no Project overrides, so Create leaves out the{" "}
                  {projectOverrides.length === 1
                    ? "override"
                    : `${projectOverrides.length} overrides`}{" "}
                  in this draft. Choose Global to keep them.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="agent-name" className={fieldLabelClass}>
                Name
              </Label>
              <Input
                id="agent-name"
                maxLength={200}
                value={name}
                onChange={(event) => draft.edit({ name: event.target.value })}
                disabled={saving}
                className="bg-muted"
              />
            </div>
            {props.ownership.kind === "new" && (
              <OwnerPicker
                kind="Agent"
                chosen={props.ownership.chosen}
                projects={props.ownership.projects}
                onChange={props.ownership.onChange}
                disabled={saving}
                initial={props.ownership.initial}
                hint={props.ownership.hint}
              />
            )}
            {/* The Prompt grows to fill the editor; Exits stay reachable below it. */}
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="agent-prompt" className={fieldLabelClass}>
                Prompt
              </Label>
              <Textarea
                id="agent-prompt"
                rows={8}
                aria-describedby="agent-prompt-help"
                value={prompt}
                onChange={(event) => draft.edit({ prompt: event.target.value })}
                disabled={saving}
                className="min-h-38 flex-1 bg-muted font-mono text-xs"
              />
              <p id="agent-prompt-help" className="text-2xs tracking-label text-subtle-foreground">
                Reusable across projects. Mention skills as plain text, for example{" "}
                <code className="font-mono">$review-code</code>. No skill catalog is required.
              </p>
            </div>
            <AgentExitsField
              exits={exits}
              disabled={saving}
              onChange={(exits) => draft.edit({ exits })}
            />
          </div>
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>
                <p>{error}</p>
                {!state.saved && state.saveOutcome === "unknown" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => draft.allowCreateAgain()}
                  >
                    I checked the Agent list
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </form>
    </>
  );
}

/**
 * A saved Agent moved to a Project elsewhere while this draft held Project overrides: they stay
 * visible here, and Save waits until they are removed or the Agent is made global again.
 */
function StrandedOverrides({
  overrides,
  owner,
  projects,
  capabilities,
  disabled,
  onRemove,
}: {
  overrides: readonly AgentProjectOverride[];
  owner: string;
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <Alert role="alert" variant="attention" aria-label="Project overrides this Agent cannot keep">
      <CircleAlert aria-hidden />
      <AlertTitle>Project overrides can't be saved</AlertTitle>
      <AlertDescription>
        <p>
          This Agent is owned by {owner} now, and a Project Agent has no Project overrides. Remove
          them from this draft to save, or use Change owner… to make it Global again and keep them.
        </p>
        <ul className="list-disc pl-4">
          {overrides.map((override) => (
            <li key={override.projectId}>
              {ownerName(studioOwner(override.projectId, projects))}:{" "}
              {agentRuntimeMeta(override.execution, capabilities)}
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRemove}>
          Remove Project overrides from draft
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Reporting stays silent while it is checking or installed; only a problem takes form space. */
function AgentReportingNotice({ providerId }: { providerId: string }) {
  const status = agentReportingStatus(providerId, useReportingState());
  if (status.state !== "attention") return null;
  return (
    <Alert role="status" aria-label="Agent reporting status" variant="attention">
      <CircleAlert aria-hidden />
      <AlertTitle>{status.label}</AlertTitle>
      <AlertDescription>
        {status.message && <p>{status.message}</p>}
        <LaunchSkillStatus state={status.launchSkill} />
        <p>This provider cannot start a Run until reporting is configured.</p>
        <SettingsLink selection={{ tab: "agent-reporting" }}>Open Agent reporting</SettingsLink>
      </AlertDescription>
    </Alert>
  );
}

/** Figma SA01: the owner, the name with the model picker, More actions and Save, and one status line. */
function AgentEditorHeader(
  props: AgentEditorProps & { name: string; saving: boolean; picker: ReactNode },
) {
  const { state, flowUsage, name, saving, ownership, picker } = props;
  const agent = state.saved;
  const saveLabel = agent ? "Save" : "Create Agent";
  const ownerBlock = ownership.kind === "new" ? ownership.blocked : null;
  const blankName = name.trim() === "";
  // A blank name disables the action with no reason. A clean Agent has nothing to save.
  const ready = state.canSave && state.dirty && !ownerBlock && !blankName;
  const beside = blankName ? "" : ownerBlock || saveBlockedReason(state) || "";
  return (
    <header className="flex min-w-0 shrink-0 flex-col gap-1.5 border-b px-4 pt-5 pb-4 sm:px-6 md:px-8">
      {ownership.kind === "saved" && <AgentOwner owner={ownership.owner} />}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 max-w-full break-words text-xl font-semibold">
          {agent ? name || agent.name : "New Agent"}
        </h1>
        {/* The actions wrap together, so Save never leaves More actions behind. */}
        <div className="ml-auto flex max-w-full min-w-0 items-center gap-2">
          {picker}
          {agent && <AgentMoreActions {...props} agent={agent} />}
          {beside && <p className="min-w-0 text-sm text-destructive">{beside}</p>}
          <MutationGate>
            <Button
              type="submit"
              variant={saving || ready ? "default" : "outline"}
              disabled={saving || !ready}
            >
              {saving ? "Saving…" : saveLabel}
            </Button>
          </MutationGate>
        </div>
      </div>
      <AgentStatusLine state={state} flowUsage={flowUsage} />
    </header>
  );
}

/** The saved Agent's owner in the owner tones; a Project's tooltip names the placement rule. */
function AgentOwner({ owner }: { owner: StudioOwner }) {
  const global = owner.projectId === null;
  const Icon = global ? Workflow : FolderGit2;
  const text = (
    <p
      // Focusable so a keyboard reaches the Project's placement rule.
      tabIndex={global ? undefined : 0}
      className={cn(
        "flex w-fit max-w-full items-center gap-1.25 rounded-xs text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        global
          ? "text-subtle-foreground"
          : owner.unavailable
            ? "text-attention"
            : "text-brand-cyan",
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{ownerName(owner)}</span>
    </p>
  );
  if (global) return text;
  const rule = `Only ${owner.title} Flows can place this Agent.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent>{owner.unavailable ? `${owner.unavailable}. ${rule}` : rule}</TooltipContent>
    </Tooltip>
  );
}

function AgentStatusLine({ state, flowUsage }: { state: AgentDraftSnapshot; flowUsage: number }) {
  const agent = state.saved;
  const className = "flex items-center gap-1.25 text-xs text-subtle-foreground";
  if (state.removed) return <p className={className}>Removed elsewhere · retained draft</p>;
  if (!agent) return <p className={className}>Not saved yet · Create Agent saves rev 1</p>;
  const usage = flowUsage === 0 ? "Unused" : `Used in ${flowUsageLabel(flowUsage)}`;
  const facts = `rev ${agent.revision} · ${usage}`;
  if (state.dirty) return <p className={className}>Unsaved changes · {facts}</p>;
  return (
    <p className={className}>
      <Check aria-hidden className="size-3 shrink-0 text-success" />
      Saved · {facts}
    </p>
  );
}

const removedReason = "This Agent was removed elsewhere.";

/**
 * Figma SA01d: Duplicate…, Change owner…, Export JSON and Remove… act on the saved revision, so
 * they exist only after the first save.
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
                variant="outline"
                size="icon"
                aria-label="More actions"
                disabled={saving}
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
            onDelete={() => {
              if (draft.getSnapshot().removed) return;
              draft.clearRemovalError();
              setConfirmingDelete(true);
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {exporter && <DefinitionExportDialog {...exporter} />}
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

/** More actions' items; a disabled item shows why. */
function AgentMenuItems({
  state,
  onDuplicate,
  onChangeOwner,
  exporter,
  queue,
  onDelete,
}: Pick<AgentEditorProps, "state" | "onDuplicate" | "onChangeOwner" | "exporter"> & {
  queue: (action: () => void) => void;
  onDelete: () => void;
}) {
  const writable = useMutationsAllowed() && !state.removed;
  const reason = state.removed ? removedReason : undefined;
  return (
    <>
      {onDuplicate && (
        <DropdownMenuItem
          aria-label="Duplicate"
          disabled={!writable || state.dirty}
          description={duplicateBlockedReason(state)}
          onSelect={() => queue(onDuplicate)}
        >
          <Copy aria-hidden />
          Duplicate…
        </DropdownMenuItem>
      )}
      {onChangeOwner && (
        <DropdownMenuItem
          disabled={!writable}
          description={reason}
          onSelect={() => queue(onChangeOwner)}
        >
          <FolderGit2 aria-hidden />
          Change owner…
        </DropdownMenuItem>
      )}
      {exporter && (
        <DefinitionExportMenuItem
          state={exporter.state}
          disabled={state.removed}
          description={reason}
          onSelect={() => queue(() => void exporter.model.request(state.dirty))}
        />
      )}
      <DropdownMenuSeparator />
      <RemoveMenuItem disabled={!writable} description={reason} onSelect={() => queue(onDelete)} />
    </>
  );
}

function duplicateBlockedReason(state: AgentDraftSnapshot): string | undefined {
  if (state.removed) return removedReason;
  if (state.dirty) return "Save your changes before duplicating this Agent.";
  return undefined;
}

function saveBlockedReason(state: AgentDraftSnapshot): string | undefined {
  if (state.removed) return removedReason;
  if (state.conflict.status !== "none") return "Compare the latest revision before saving.";
  if (state.ownerChange.status !== "none")
    return "Acknowledge the owner changed elsewhere before saving.";
  if (state.strandedOverrides)
    return "Remove the Project overrides a Project Agent can't keep, or make it Global again.";
  if (!state.saved && state.saveOutcome === "unknown")
    return "Check the Agent list before creating this Agent again.";
  return undefined;
}

/** Remove… confirms, or lists the Flows that still place the Agent. */
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
        description="Removing this Agent removes it from Studio and keeps its saved revisions for existing Runs."
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
          <Alert variant="destructive">
            <AlertDescription>{removalError}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
