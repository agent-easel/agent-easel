import { useEffect, useState } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import { useStudioNavigation, type StudioSelection } from "../settings-navigation.ts";
import { useStudioOwners, useStudioRead, type StudioDefinitions } from "../studio-definitions.ts";
import { triggerDraftId } from "../use-studio-draft-guard.ts";
import { useActiveView } from "../use-active-view.ts";
import { useServerId } from "../client-scope.ts";
import {
  createTriggerDraft,
  useTriggerDraftSnapshot,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../trigger-draft.ts";
import { StudioBackLink } from "../components/app-link.tsx";
import { StudioPage } from "../components/settings-page.tsx";
import { TriggersList, useEnableReview } from "../components/studio-triggers/triggers-list.tsx";
import { TriggerTypePicker } from "../components/studio-triggers/trigger-type-picker.tsx";
import {
  TriggerFields,
  TriggerReadinessList,
  type ReadinessRead,
} from "../components/studio-triggers/trigger-form.tsx";
import { TriggerStatusStrip } from "../components/studio-triggers/trigger-status-strip.tsx";
import {
  useTriggerActions,
  type TriggerActions,
} from "../components/studio-triggers/trigger-actions.ts";
import { useTriggerReadiness } from "../components/studio-triggers/use-trigger-readiness.ts";
import {
  TriggerReviewDialog,
  type TriggerReview,
} from "../components/studio-triggers/trigger-review-dialog.tsx";
import {
  reviewSummary,
  scheduleText,
  triggerRoute,
  type TriggerNames,
} from "../components/studio-triggers/trigger-text.ts";
import { widensAdmission } from "../trigger-review.ts";

type TriggersSelection = Extract<StudioSelection, { tab: "triggers" }>;
/** This window's Create was accepted; `enable` asks to enable it as the review showed. */
type OnCreated = (trigger: TriggerDefinition, enable: boolean) => Promise<void> | undefined;

/** Studio → Automate → Triggers: the list, the type picker, and the create and edit forms. */
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
  const enabling = useEnableReview(names, actions);
  const serverId = useServerId();
  // This window's own Create, answered before Studio may have delivered it.
  const [created, setCreated] = useState<TriggerDefinition | null>(null);
  const draftId = triggerDraftId(selection);
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
      ) : draftId === "new" ? (
        <TriggerTypePicker />
      ) : (
        <TriggerEditor
          // An editor never outlives its server, so a pending reply from another one is discarded.
          key={`${serverId ?? ""}:${draftId}`}
          draftId={draftId}
          definitions={definitions}
          names={names}
          actions={actions}
          created={created?.id === draftId ? created : null}
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
  const creating = draftId.startsWith("new:");
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
  reportDraft,
}: {
  draftId: string;
  definitions: StudioDefinitions;
  names: TriggerNames;
  actions: TriggerActions;
  created: TriggerDefinition | null;
  onCreated: OnCreated;
  reportDraft: ReportDraft;
}) {
  const openStudio = useStudioNavigation();
  const { trigger, live, unavailable } = useOpenedTrigger(draftId, definitions, created);
  if (unavailable)
    return (
      <main className="grid justify-items-start gap-3 px-8 pt-6 pb-8 max-sm:px-4">
        <p role="alert" className="text-sm text-destructive">
          Trigger not found
        </p>
        <Button variant="outline" onClick={() => void openStudio({ tab: "triggers" })}>
          Back to Triggers
        </Button>
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
  // Readiness is listed on create only, but edit also reads it for the repository and `@me`.
  const readiness = useTriggerReadiness(
    state.content.projectId,
    trigger ? "" : state.content.flowId,
  );
  useEffect(() => {
    if (readiness.status !== "answered" || !readiness.readiness.repository?.ready) return;
    draft.detectRepository(state.content.projectId, readiness.readiness.repository.repository);
  }, [draft, readiness, state.content.projectId]);
  useEffect(() => {
    if (state.updatedTo === null) return;
    const timer = setTimeout(draft.dismissUpdate, 4000);
    return () => clearTimeout(timer);
  }, [draft, state.updatedTo]);
  return { draft, state, readiness };
}

function OpenedTriggerEditor({
  draftId,
  trigger,
  live,
  definitions,
  names,
  actions,
  onCreated,
  reportDraft,
}: {
  draftId: string;
  trigger: TriggerDefinition | null;
  /** The Trigger as Studio currently lists it, for its status. */
  live: TriggerDefinition | null;
  definitions: StudioDefinitions;
  names: TriggerNames;
  actions: TriggerActions;
  onCreated: OnCreated;
  reportDraft: ReportDraft;
}) {
  const openStudio = useStudioNavigation();
  const active = useActiveView();
  const { draft, state, readiness } = useOpenedTriggerDraft(
    trigger,
    definitions,
    draftId,
    reportDraft,
  );
  const shown = live ?? state.saved;
  const [review, setReview] = useState<TriggerReview | null>(null);
  const pending = shown ? actions.state.pending.get(shown.id) : undefined;
  async function create(enable: boolean) {
    const saved = await draft.save();
    setReview(null);
    if (!saved || !active.current) return;
    await onCreated(saved, enable);
    void openStudio({ tab: "triggers", triggerId: saved.id });
  }
  async function applyAndCheck() {
    const saved = await draft.save();
    setReview(null);
    if (saved) await actions.run(saved);
  }
  /** Opens the review of what the draft's settings would start, as `confirmLabel` commits them. */
  function reviewDraft(confirmLabel: TriggerReview["confirmLabel"]) {
    const proposal = draft.proposal();
    if (!proposal || "error" in state.query) return undefined;
    const saved = state.saved;
    const { input } = proposal;
    const reviewed = {
      summary: reviewSummary(input, state.content.repository?.nameWithOwner ?? "", names),
      query: input.github.query ?? "",
      readyLabel: state.query.readyLabel,
      confirmLabel,
    };
    if (proposal.kind === "create")
      return setReview({
        ...reviewed,
        title: `Enable “${input.name}”?`,
        load: () => definitions.previewNewTrigger(proposal.input),
        saveDisabled: () => void create(false),
      });
    // Harmless edits, and any edit of a Trigger that is off, save without a review.
    if (!saved || !shown?.enabled || !widensAdmission(saved, proposal.input))
      return void draft.save();
    setReview({
      ...reviewed,
      title: `Apply changes to “${input.name}”?`,
      load: () => definitions.previewTrigger(proposal.id, proposal.input),
    });
  }
  return (
    <main className="grid content-start gap-4 px-8 pt-6 pb-8 max-sm:px-4">
      <EditorBackLink creating={!trigger} />
      <StudioPage
        title={shown ? shown.name : "New Trigger · GitHub Issues"}
        description={
          shown
            ? `${triggerRoute(shown, names)} · ${shown.github.repository.nameWithOwner} · ${scheduleText(shown.schedule)}`
            : "Factory checks one Project's tracker and starts the Flow for each new ready issue. It never writes to the tracker."
        }
      >
        {shown && (
          <TriggerStatusStrip
            trigger={shown}
            running={actions.state.pending.get(shown.id) === "run"}
            onRun={() => void actions.run(shown)}
          />
        )}
        <EditorNotices draft={draft} state={state} actions={actions} />
        <TriggerFields
          draft={draft}
          state={state}
          projects={names.projects}
          flows={names.flows}
          readiness={readiness}
        />
        {!trigger && (
          <TriggerReadinessList readiness={readiness} state={state} flows={names.flows} />
        )}
        <EditorFooter
          creating={!trigger}
          state={state}
          readiness={readiness}
          onSaveDisabled={() => void create(false)}
          onReview={() => reviewDraft(trigger ? "Apply and check" : "Enable and check")}
          onCancel={() => void openStudio({ tab: "triggers" })}
        />
      </StudioPage>
      <TriggerReviewDialog
        review={review}
        busy={state.saving || pending === "enable" || pending === "run"}
        onCancel={() => setReview(null)}
        onConfirm={() => void (trigger ? applyAndCheck() : create(true))}
      />
    </main>
  );
}

/** An opened Trigger goes back to the list; the create form goes back to the type picker. */
function EditorBackLink({ creating }: { creating: boolean }) {
  return creating ? (
    <StudioBackLink selection={{ tab: "triggers", triggerId: "new" }}>Trigger types</StudioBackLink>
  ) : (
    <StudioBackLink selection={{ tab: "triggers" }}>All Triggers</StudioBackLink>
  );
}

function EditorNotices({
  draft,
  state,
  actions,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  actions: TriggerActions;
}) {
  const openStudio = useStudioNavigation();
  const { conflict } = state;
  const failure = actions.state.failure;
  return (
    <>
      {state.removed && (
        <Alert variant="attention" role="status">
          <AlertDescription>
            This Trigger was removed elsewhere. Your edits are kept here, but they can no longer be
            saved.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openStudio({ tab: "triggers" })}
            >
              Back to Triggers
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {state.updatedTo !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          Updated to revision {state.updatedTo}
        </p>
      )}
      {conflict.status === "detected" && (
        <Alert variant="attention" role="status">
          <AlertDescription>
            {conflict.revision === null
              ? "A newer revision was saved elsewhere."
              : `Revision ${conflict.revision} was saved elsewhere.`}
            <Button variant="outline" size="sm" onClick={draft.compare}>
              Compare latest revision
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {conflict.status === "comparing" && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the latest revision…
        </p>
      )}
      {conflict.status === "compared" && (
        <Alert variant="attention" role="status">
          <AlertDescription>
            Revision {conflict.latest.revision} is “{conflict.latest.name}”, checking{" "}
            {conflict.latest.github.query} {scheduleText(conflict.latest.schedule)} with up to{" "}
            {conflict.latest.maxActiveRuns} active Runs.
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => draft.loadLatest(conflict.latest.revision)}
              >
                Load revision {conflict.latest.revision}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => draft.keepEdits(conflict.latest.revision)}
              >
                Keep my edits
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}
            {!state.saved && state.saveOutcome === "unknown" && (
              <Button variant="outline" size="sm" onClick={draft.allowCreateAgain}>
                Create again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {state.warnings.length > 0 && (
        <Alert variant="attention" role="status">
          <AlertDescription>
            {state.warnings.map((warning) => (
              <p key={warning.code}>{warning.message}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>
            {failure.name}: {failure.message}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

function EditorFooter({
  creating,
  state,
  readiness,
  onSaveDisabled,
  onReview,
  onCancel,
}: {
  creating: boolean;
  state: TriggerDraftSnapshot;
  readiness: ReadinessRead;
  onSaveDisabled: () => void;
  /** Saves, or first reviews what the settings would start when they can widen it. */
  onReview: () => void;
  onCancel: () => void;
}) {
  const busy = !state.canSave;
  if (creating) {
    const blocked = readiness.status !== "answered" || !readiness.readiness.gitHub.ready;
    return (
      <footer className="flex flex-wrap items-center gap-2">
        <p className="min-w-48 flex-1 text-2xs leading-tight tracking-label text-subtle-foreground">
          Nothing starts until you review the issues that would start.
        </p>
        <MutationGate>
          <Button variant="outline" disabled={busy} onClick={onSaveDisabled}>
            {state.saving ? "Saving…" : "Save disabled"}
          </Button>
          <Button disabled={busy || blocked} onClick={onReview}>
            Review and enable
          </Button>
        </MutationGate>
      </footer>
    );
  }
  return (
    <footer className="flex flex-wrap items-center gap-2">
      <p className="min-w-48 flex-1 text-2xs leading-tight tracking-label text-subtle-foreground">
        Changes that widen what starts (repository, label, filter, Flow, higher limit) are reviewed
        before saving.
      </p>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <MutationGate>
        <Button disabled={busy || !state.dirty} onClick={onReview}>
          {state.saving ? "Saving…" : "Save"}
        </Button>
      </MutationGate>
    </footer>
  );
}
