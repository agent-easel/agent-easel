import { useEffect, useState } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import { useStudioNavigation, type StudioSelection } from "../settings-navigation.ts";
import { useStudioRead, type StudioDefinitions } from "../studio-definitions.ts";
import { triggerDraftId } from "../use-studio-draft-guard.ts";
import { useProjects } from "../use-projects.ts";
import { useActiveView } from "../use-active-view.ts";
import { useServerId } from "../client-scope.ts";
import {
  createTriggerDraft,
  useTriggerDraftSnapshot,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../trigger-draft.ts";
import { SettingsPage } from "../components/settings-page.tsx";
import { TriggersList } from "../components/studio-triggers/triggers-list.tsx";
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
  scheduleText,
  triggerRoute,
  type TriggerNames,
} from "../components/studio-triggers/trigger-text.ts";

type TriggersSelection = Extract<StudioSelection, { tab: "triggers" }>;

/** Studio → AUTOMATE → Triggers: the list, the type picker, and the create and edit forms. */
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
  const names: TriggerNames = {
    projects: useProjects(),
    flows: useStudioRead(definitions, "flows").value,
  };
  const actions = useTriggerActions(definitions);
  const serverId = useServerId();
  // This window's own Create, answered before Studio may have delivered it.
  const [created, setCreated] = useState<TriggerDefinition | null>(null);
  const draftId = triggerDraftId(selection);
  if (!draftId) return <TriggersList triggers={triggers} names={names} actions={actions} />;
  if (draftId === "new") return <TriggerTypePicker />;
  return (
    <TriggerEditor
      // An editor never outlives its server, so a pending reply from another one is discarded.
      key={`${serverId ?? ""}:${draftId}`}
      draftId={draftId}
      definitions={definitions}
      names={names}
      actions={actions}
      created={created?.id === draftId ? created : null}
      onCreated={setCreated}
      reportDraft={reportTriggerDraft}
    />
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
  onCreated: (trigger: TriggerDefinition) => void;
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
  onCreated: (trigger: TriggerDefinition) => void;
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
  async function create(enable: boolean) {
    const saved = await draft.save();
    if (!saved || !active.current) return;
    onCreated(saved);
    if (enable) await actions.setEnabled(saved, true);
    void openStudio({ tab: "triggers", triggerId: saved.id });
  }
  return (
    <main className="grid max-w-206 content-start px-8 pt-6 pb-8 max-sm:px-4">
      <SettingsPage
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
          onCreate={(enable) => void create(enable)}
          onSave={() => void draft.save()}
          onCancel={() => void openStudio({ tab: "triggers" })}
        />
      </SettingsPage>
    </main>
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
  onCreate,
  onSave,
  onCancel,
}: {
  creating: boolean;
  state: TriggerDraftSnapshot;
  readiness: ReadinessRead;
  onCreate: (enable: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const busy = !state.canSave;
  if (creating) {
    const blocked = readiness.status !== "answered" || !readiness.readiness.gitHub.ready;
    return (
      <footer className="flex flex-wrap items-center gap-2">
        <p className="min-w-48 flex-1 text-2xs leading-tight tracking-label text-subtle-foreground">
          Nothing starts until the Trigger is turned on.
        </p>
        <MutationGate>
          <Button variant="outline" disabled={busy} onClick={() => onCreate(false)}>
            {state.saving ? "Saving…" : "Save disabled"}
          </Button>
          <Button disabled={busy || blocked} onClick={() => onCreate(true)}>
            Save and enable
          </Button>
        </MutationGate>
      </footer>
    );
  }
  return (
    <footer className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <MutationGate>
        <Button disabled={busy || !state.dirty} onClick={onSave}>
          {state.saving ? "Saving…" : "Save"}
        </Button>
      </MutationGate>
    </footer>
  );
}
