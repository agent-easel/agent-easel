import { useEffect, useState } from "react";
import type {
  TriggerCheckReply,
  TriggerDefinition,
  TriggerRepository,
} from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import { useStudioNavigation, type StudioSelection } from "../settings-navigation.ts";
import { useStudioOwners, useStudioRead, type StudioDefinitions } from "../studio-definitions.ts";
import { useActiveView } from "../use-active-view.ts";
import { useServerId } from "../client-scope.ts";
import {
  createTriggerDraft,
  useTriggerDraftSnapshot,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../trigger-draft.ts";
import { TriggersList, useEnableReview } from "../components/studio-triggers/triggers-list.tsx";
import {
  TriggerFields,
  chosenFlowProblem,
  queryWarning,
} from "../components/studio-triggers/trigger-form.tsx";
import { TriggerStatusStrip } from "../components/studio-triggers/trigger-status-strip.tsx";
import { StudioEditorHeader, StudioSaveButton } from "../components/studio-editor-header.tsx";
import {
  useTriggerActions,
  type TriggerActions,
} from "../components/studio-triggers/trigger-actions.ts";
import { useTriggerReadiness } from "../components/studio-triggers/use-trigger-readiness.ts";
import {
  TriggerReviewDialog,
  type TriggerReview,
} from "../components/studio-triggers/trigger-review-dialog.tsx";
import { reviewSummary, type TriggerNames } from "../components/studio-triggers/trigger-text.ts";
import {
  EditorNotices,
  otherRepositoryWatchers,
  SharedRepositoryCard,
  TriggerFieldNotices,
} from "../components/studio-triggers/trigger-notices.tsx";
import { widensAdmission } from "../trigger-review.ts";

type TriggersSelection = Extract<StudioSelection, { tab: "triggers" }>;
/** This window's Create was accepted; `enable` asks to enable it as the review showed. */
type OnCreated = (trigger: TriggerDefinition, enable: boolean) => Promise<void> | undefined;

/** Studio → Automate → Triggers: the list and the create and edit forms. */
export function StudioTriggersPage({
  selection,
  definitions,
  reportTriggerDraft,
}: {
  selection: TriggersSelection;
  definitions: StudioDefinitions;
  reportTriggerDraft: ReportDraft;
}) {
  const triggers = useStudioRead(definitions, "triggers");
  const owners = useStudioOwners(definitions);
  const names: TriggerNames = {
    projects: owners.projects,
    flows: useStudioRead(definitions, "flows").value,
  };
  const actions = useTriggerActions(definitions);
  // Shared by the list's switches and Create, and kept open when Create opens the new Trigger.
  const enabling = useEnableReview(names, actions, triggers.value);
  const serverId = useServerId();
  // This window's own Create, answered before Studio may have delivered it.
  const [created, setCreated] = useState<TriggerDefinition | null>(null);
  const draftId = selection.triggerId;
  return (
    <>
      {!draftId ? (
        <TriggersList
          triggers={triggers}
          names={names}
          projects={owners.projects}
          actions={actions}
          onEnable={enabling.open}
        />
      ) : (
        <TriggerEditor
          // An editor never outlives its server, so a pending reply from another one is discarded.
          key={`${serverId ?? ""}:${draftId}`}
          draftId={draftId}
          definitions={definitions}
          names={names}
          actions={actions}
          created={created?.id === draftId ? created : null}
          onEnable={enabling.open}
          onCreated={(trigger, enable) => {
            setCreated(trigger);
            // The created revision holds exactly the settings the review showed.
            return enable ? enabling.enable(trigger, trigger.revision) : undefined;
          }}
          reportDraft={reportTriggerDraft}
        />
      )}
      {enabling.dialog}
    </>
  );
}

/**
 * The saved Trigger an editor opens over: the first one Studio lists for this visit, or this
 * window's acknowledged Create before Studio delivers it. `undefined` while loading.
 */
function useOpenedTrigger(
  draftId: string,
  definitions: StudioDefinitions,
  created: TriggerDefinition | null,
) {
  const triggers = useStudioRead(definitions, "triggers");
  const creating = draftId === "new";
  const pending = definitions.hasObserved("triggers", draftId) ? null : created;
  const listed = triggers.value?.find((entry) => entry.id === draftId) ?? pending;
  const [opened, setOpened] = useState<TriggerDefinition | null>(null);
  if (!creating && !opened && listed) setOpened(listed);
  if (creating) return { trigger: null, live: null, unavailable: false };
  const trigger = opened ?? listed ?? undefined;
  return {
    trigger,
    live: listed ?? null,
    unavailable: !trigger && Boolean(triggers.error || triggers.value),
  };
}

function TriggerEditor({
  draftId,
  definitions,
  names,
  actions,
  created,
  onCreated,
  onEnable,
  reportDraft,
}: {
  draftId: string;
  definitions: StudioDefinitions;
  names: TriggerNames;
  actions: TriggerActions;
  created: TriggerDefinition | null;
  onCreated: OnCreated;
  onEnable: (trigger: TriggerDefinition) => void;
  reportDraft: ReportDraft;
}) {
  const { trigger, live, unavailable } = useOpenedTrigger(draftId, definitions, created);
  if (unavailable)
    return (
      <main className="grid justify-items-start gap-3 px-8 pt-6 pb-8 max-sm:px-4">
        <p role="alert" className="text-sm text-destructive">
          Trigger not found
        </p>
      </main>
    );
  if (trigger === undefined)
    return (
      <p role="status" className="px-8 pt-6 text-sm text-muted-foreground">
        Loading Trigger…
      </p>
    );
  return (
    <OpenedTriggerEditor
      draftId={draftId}
      trigger={trigger}
      live={live}
      definitions={definitions}
      names={names}
      actions={actions}
      onCreated={onCreated}
      onEnable={onEnable}
      reportDraft={reportDraft}
    />
  );
}

/** One loaded editor owns its draft, which follows Studio's saved Triggers while mounted. */
function useOpenedTriggerDraft(
  trigger: TriggerDefinition | null,
  definitions: StudioDefinitions,
  draftId: string,
  reportDraft: ReportDraft,
) {
  const [draft] = useState(() => createTriggerDraft(trigger, definitions));
  useEffect(() => draft.connect(), [draft]);
  useDraftGuard(draft, draftId, reportDraft);
  const state = useTriggerDraftSnapshot(draft);
  const { read, retry } = useTriggerReadiness(state.content.projectId);
  const readiness = read.status === "answered" ? read.readiness : undefined;
  const answer = readiness?.repository;
  useEffect(() => {
    if (answer?.ready) draft.detectRepository(state.content.projectId, answer.repository);
  }, [draft, answer, state.content.projectId]);
  useEffect(() => {
    if (state.updatedTo === null) return;
    const timer = setTimeout(draft.dismissUpdate, 4000);
    return () => clearTimeout(timer);
  }, [draft, state.updatedTo]);
  return { draft, state, readiness, read, retry };
}

type OpenedTriggerEditorProps = {
  draftId: string;
  trigger: TriggerDefinition | null;
  /** The Trigger as Studio currently lists it, for its status. */
  live: TriggerDefinition | null;
  definitions: StudioDefinitions;
  names: TriggerNames;
  actions: TriggerActions;
  onCreated: OnCreated;
  onEnable: (trigger: TriggerDefinition) => void;
  reportDraft: ReportDraft;
};

function useTriggerEditor({
  draftId,
  trigger,
  live,
  definitions,
  names,
  actions,
  onCreated,
  reportDraft,
}: OpenedTriggerEditorProps) {
  const openStudio = useStudioNavigation();
  const active = useActiveView();
  const host = useOpenedTriggerDraft(trigger, definitions, draftId, reportDraft);
  const { draft, state } = host;
  const creating = !trigger;
  const shown = live ?? state.saved;
  const [checked, setChecked] = useState<TriggerCheckReply>();
  const pending = shown ? actions.state.pending.get(shown.id) : undefined;
  const { content } = state;
  const triggers = useStudioRead(definitions, "triggers").value;
  const validation = triggerFormReadiness(state, names, host);
  const { canSave } = validation;
  const ghProblem = readinessNotice(validation.ghProblem, shown?.error?.code);
  const repositoryName = content.repository?.nameWithOwner ?? "";
  const watchers = otherRepositoryWatchers(triggers, content.repository, shown?.id);

  async function finishSave(enable: boolean) {
    const saved = await draft.save();
    closeReview();
    if (!saved || !active.current) return;
    if (!creating) {
      await check(saved);
      return;
    }
    await onCreated(saved, enable);
    void openStudio({ tab: "triggers", triggerId: saved.id });
  }

  async function check(target: TriggerDefinition) {
    const result = await actions.run(target);
    if (result) setChecked(result);
  }

  const saveOff = () => void finishSave(false);
  const { review, reviewDraft, closeReview } = useDraftReview({
    draft,
    definitions,
    names,
    repositoryName,
    watchers,
    enabled: shown?.enabled === true,
    saveOff,
  });

  const currentCheck = visibleCheck(checked, shown);
  const canSubmit = canSave && !pending;
  const closeBlocked = state.saving || pending === "enable" || pending === "run";
  const fieldsLocked = state.saving || (state.saveOutcome === "unknown" && creating);
  function openRecovered(found: TriggerDefinition) {
    draft.openRecovered(found);
    void onCreated(found, false);
    void openStudio({ tab: "triggers", triggerId: found.id });
  }
  return {
    host,
    validation,
    creating,
    shown,
    pending,
    ghProblem,
    currentCheck,
    canSubmit,
    closeBlocked,
    fieldsLocked,
    sharedRepository: { watchers, repository: repositoryName },
    reviewActions: { review, reviewDraft, closeReview, finishSave },
    check,
    saveOff,
    openRecovered,
  };
}

function OpenedTriggerEditor(props: OpenedTriggerEditorProps) {
  const { names, actions, onEnable } = props;
  const editor = useTriggerEditor(props);
  const { draft, state, readiness, retry } = editor.host;
  const { flowProblem, repositoryProblem, moved, canSave, canReview } = editor.validation;
  const { review, reviewDraft, closeReview, finishSave } = editor.reviewActions;
  const { creating, shown, pending } = editor;
  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-4 max-sm:px-4">
        <TriggerEditorHeader
          trigger={creating ? null : shown}
          checked={editor.currentCheck}
          checking={pending === "run"}
          disabled={state.removed || state.saving || Boolean(pending)}
          dirty={state.dirty}
          removed={state.removed}
          moved={moved}
          onEnable={onEnable}
          onDisable={(target) => void actions.disable(target)}
          onCheck={(target) => void editor.check(target)}
        />
        <fieldset className="grid min-w-0 gap-5" disabled={editor.fieldsLocked}>
          <TriggerFields
            draft={draft}
            state={state}
            projects={names.projects ?? []}
            flows={names.flows}
            readiness={readiness}
            flowProblem={flowProblem}
            repositoryProblem={repositoryProblem}
            movedRepository={moved}
          />
        </fieldset>
      </div>
      <footer className="flex max-h-[50%] shrink-0 flex-col gap-3 border-t px-8 py-3 max-sm:px-4">
        <div className="grid min-h-0 gap-3 overflow-y-auto empty:hidden">
          <EditorNotices
            draft={draft}
            state={state}
            failure={actions.state.failure}
            recovered={editor.openRecovered}
          />
          <TriggerFieldNotices
            state={state}
            repositoryProblem={repositoryProblem}
            flowProblem={flowProblem}
            publicQueryWarning={queryWarning(state, readiness)}
            ghProblem={editor.ghProblem}
            retry={retry}
          />
          {!state.removed && <SharedRepositoryCard {...editor.sharedRepository} />}
        </div>
        <EditorActions
          creating={creating}
          state={state}
          canSave={editor.canSubmit}
          canReview={Boolean(canReview)}
          onSave={creating ? editor.saveOff : reviewDraft}
          onReview={reviewDraft}
        />
      </footer>
      <TriggerReviewDialog
        review={review}
        busy={editor.closeBlocked}
        blocked={creating ? !canReview : !canSave}
        saveBlocked={!canSave}
        onCancel={closeReview}
        onConfirm={() => void finishSave(true)}
      />
    </main>
  );
}

function triggerFormReadiness(
  state: TriggerDraftSnapshot,
  names: TriggerNames,
  { read, readiness }: ReturnType<typeof useOpenedTriggerDraft>,
) {
  const { content } = state;
  const ghProblem =
    read.status === "failed"
      ? read.message
      : readiness && !readiness.gitHub.ready
        ? readiness.gitHub.problem
        : undefined;
  const repository = readiness?.repository;
  const { repositoryProblem, moved } = repositoryState(
    state.content.repository,
    repository,
    ghProblem,
  );
  const flowProblem = chosenFlowProblem(content, names.flows);
  const projectAvailable = names.projects?.some(
    (entry) => entry.id === content.projectId && entry.availability === "available",
  );
  const canSave =
    state.canSave && !flowProblem && !repositoryProblem && !moved && projectAvailable === true;
  const canReview = canSave && readiness?.gitHub.ready && repository?.ready;
  return { ghProblem, repositoryProblem, moved, flowProblem, canSave, canReview };
}

function repositoryState(
  confirmed: TriggerRepository | null,
  repository:
    | NonNullable<ReturnType<typeof useOpenedTriggerDraft>["readiness"]>["repository"]
    | undefined,
  ghProblem: string | undefined,
) {
  if (!repository) return { moved: null };
  if (!repository.ready)
    return { moved: null, repositoryProblem: ghProblem ? undefined : repository.problem };
  const moved =
    confirmed && repository.repository.nodeId !== confirmed.nodeId ? repository.repository : null;
  return { moved };
}

function readinessNotice(problem: string | undefined, recordedCode: string | undefined) {
  return recordedCode === "github_signed_out" || recordedCode === "github_gh_missing"
    ? undefined
    : problem;
}

function visibleCheck(checked: TriggerCheckReply | undefined, shown: TriggerDefinition | null) {
  if (!checked?.latestCheck) return undefined;
  if (shown?.latestCheck && shown.latestCheck.checkedAt > checked.latestCheck.checkedAt)
    return undefined;
  return checked;
}

/** A review captures the proposal to preview, while the repository warning follows Studio. */
function useDraftReview({
  draft,
  definitions,
  names,
  repositoryName,
  watchers,
  enabled,
  saveOff,
}: {
  draft: TriggerDraftModel;
  definitions: StudioDefinitions;
  names: TriggerNames;
  repositoryName: string;
  watchers: readonly TriggerDefinition[];
  enabled: boolean;
  saveOff: () => void;
}) {
  const [review, setReview] = useState<Omit<TriggerReview, "watchers"> | null>(null);
  function reviewDraft() {
    const proposal = draft.proposal();
    const { saved } = draft.getSnapshot();
    if (!proposal) return;
    const { input } = proposal;
    const reviewed = {
      summary: reviewSummary(input, repositoryName, names),
      repository: repositoryName,
    };
    if (proposal.kind === "create") {
      setReview({
        ...reviewed,
        title: `Enable “${input.name}”?`,
        confirmLabel: "Enable and check",
        load: () => definitions.previewNewTrigger(proposal.input),
        saveOff,
      });
      return;
    }
    // Edits that do not widen admission and edits to an off Trigger save directly.
    if (!saved || !enabled || !widensAdmission(saved, proposal.input)) {
      void draft.save();
      return;
    }
    setReview({
      ...reviewed,
      title: `Enable “${input.name}”?`,
      confirmLabel: "Apply and check",
      load: () => definitions.previewTrigger(proposal.id, proposal.input),
    });
  }

  return {
    review: review && { ...review, watchers },
    reviewDraft,
    closeReview: () => setReview(null),
  };
}

function TriggerEditorHeader({
  trigger,
  checked,
  checking,
  disabled,
  dirty,
  removed,
  moved,
  onEnable,
  onDisable,
  onCheck,
}: {
  trigger: TriggerDefinition | null;
  checked: TriggerCheckReply | undefined;
  checking: boolean;
  disabled: boolean;
  dirty: boolean;
  removed: boolean;
  moved: TriggerRepository | null;
  onEnable: (trigger: TriggerDefinition) => void;
  onDisable: (trigger: TriggerDefinition) => void;
  onCheck: (trigger: TriggerDefinition) => void;
}) {
  const existing = trigger && !removed ? trigger : null;
  return (
    <StudioEditorHeader
      layout="page"
      title={trigger?.name ?? "New GitHub Issues Trigger"}
      headingLevel={2}
      controls={
        existing && (
          <MutationGate>
            <Switch
              aria-label="Trigger enabled"
              checked={existing.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => (enabled ? onEnable(existing) : onDisable(existing))}
            />
          </MutationGate>
        )
      }
      status={
        existing && (
          <TriggerStatusStrip
            trigger={existing}
            checked={checked}
            checking={checking}
            disabled={disabled || dirty}
            moved={moved}
            onCheck={() => onCheck(existing)}
          />
        )
      }
    />
  );
}

function EditorActions({
  creating,
  state,
  canSave,
  canReview,
  onSave,
  onReview,
}: {
  creating: boolean;
  state: TriggerDraftSnapshot;
  canSave: boolean;
  canReview: boolean;
  onSave: () => void;
  onReview: () => void;
}) {
  const { name, projectId, flowId } = state.content;
  const missing = !name.trim() || !projectId || !flowId;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {creating && missing && (
        <p className="mr-auto text-xs text-muted-foreground">Name, Project and Flow are required</p>
      )}
      <StudioSaveButton
        unsaved={creating || state.dirty}
        ready={canSave}
        saving={state.saving}
        onClick={onSave}
      />
      {creating && (
        <MutationGate>
          <Button variant="outline" disabled={!canReview} onClick={onReview}>
            Review and enable
          </Button>
        </MutationGate>
      )}
    </div>
  );
}
