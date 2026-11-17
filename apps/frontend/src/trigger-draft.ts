import { useSyncExternalStore } from "react";
import type {
  TriggerDefinition,
  TriggerRepository,
  TriggerSave,
  ValidationIssue,
} from "@t3-factory/contracts";
import {
  parseTriggerQuery,
  TRIGGER_DEFAULTS,
  validateCreateTrigger,
  validateUpdateTrigger,
} from "@t3-factory/domain-validation";
import type { StudioDefinitions } from "./studio-definitions.ts";
import {
  createRevisionedDraft,
  type RevisionedDraftState,
  type SaveRequest,
} from "./revisioned-draft.ts";

/** Studio's saved Triggers as one Trigger draft follows them, and the writes it sends. */
export type TriggerDraftSource = Pick<
  StudioDefinitions,
  "getSnapshot" | "subscribe" | "createTrigger" | "updateTrigger"
>;

export type IntervalUnit = "minutes" | "hours";

/** The form's fields; number fields keep the text typed until a save converts it. */
export interface TriggerContent {
  readonly name: string;
  readonly projectId: string;
  readonly flowId: string;
  /** The repository confirmed for the Project; null until Factory detects one. */
  readonly repository: TriggerRepository | null;
  readonly query: string;
  readonly scheduleEnabled: boolean;
  readonly interval: string;
  readonly unit: IntervalUnit;
  readonly maxActiveRuns: string;
}

/** A whole number of hours is shown in hours, anything else in minutes. */
function intervalParts(minutes: number): { interval: string; unit: IntervalUnit } {
  return minutes % 60 === 0
    ? { interval: String(minutes / 60), unit: "hours" }
    : { interval: String(minutes), unit: "minutes" };
}

function contentOf(trigger: TriggerDefinition): TriggerContent {
  const { host, nameWithOwner, nodeId } = trigger.github.repository;
  return {
    name: trigger.name,
    projectId: trigger.projectId,
    flowId: trigger.flowId,
    repository: { host, nameWithOwner, nodeId },
    query: trigger.github.query,
    scheduleEnabled: trigger.schedule.enabled,
    ...intervalParts(trigger.schedule.intervalMinutes),
    maxActiveRuns: String(trigger.maxActiveRuns),
  };
}

const newContent: TriggerContent = {
  name: "",
  projectId: "",
  flowId: "",
  repository: null,
  query: TRIGGER_DEFAULTS.query,
  scheduleEnabled: TRIGGER_DEFAULTS.schedule.enabled,
  ...intervalParts(TRIGGER_DEFAULTS.schedule.intervalMinutes),
  maxActiveRuns: String(TRIGGER_DEFAULTS.maxActiveRuns),
};

/** Blank number fields stay invalid, so the validator names them instead of saving zero. */
const whole = (text: string) => (text.trim() ? Number(text) : Number.NaN);

/** The typed settings a create or update sends. */
function settingsOf(content: TriggerContent) {
  return {
    kind: "github_issues" as const,
    name: content.name,
    projectId: content.projectId,
    flowId: content.flowId,
    schedule: {
      enabled: content.scheduleEnabled,
      intervalMinutes: whole(content.interval) * (content.unit === "hours" ? 60 : 1),
    },
    maxActiveRuns: whole(content.maxActiveRuns),
    github: { repositoryNodeId: content.repository?.nodeId ?? "", query: content.query },
  };
}

function saveRequest(
  trigger: TriggerDefinition | null,
  content: TriggerContent,
  source: TriggerDraftSource,
  received: (save: TriggerSave) => TriggerDefinition,
): { error: string } | SaveRequest<TriggerDefinition, TriggerContent> {
  if (content.projectId && !content.repository)
    return { error: "Wait until Factory detects the Project's GitHub repository." };
  const settings = settingsOf(content);
  const fallback = "Could not save this Trigger. Your edits are still here.";
  if (trigger) {
    const input = { ...settings, expectedRevision: trigger.revision };
    const validation = validateUpdateTrigger(input);
    if (!validation.ok) return { error: validation.error.message };
    return {
      submitted: content,
      send: () => source.updateTrigger(trigger.id, input).then(received),
      unknownMessage:
        "Save outcome unknown. Factory may have saved this Trigger; your edits are kept and nothing is retried.",
      fallback,
    };
  }
  const validation = validateCreateTrigger(settings);
  if (!validation.ok) return { error: validation.error.message };
  return {
    submitted: content,
    send: () => source.createTrigger(settings).then(received),
    unknownMessage:
      "Save outcome unknown. Factory may have created this Trigger; check the Trigger list before creating it again.",
    fallback,
  };
}

export interface TriggerDraftSnapshot extends RevisionedDraftState<
  TriggerDefinition,
  TriggerContent
> {
  /** The query's ready label, or why the query cannot be saved. */
  readonly query:
    | { readonly readyLabel: string; readonly authorFilter: boolean }
    | { error: string };
  /** What the last accepted save asked its author to be aware of. */
  readonly warnings: readonly ValidationIssue[];
}

/**
 * One opened Trigger, or the create form when `trigger` is null, on the shared revision
 * protocol. The repository follows the chosen Project: choosing another Project clears it until
 * Factory detects that Project's repository, and choosing the saved Project again restores the
 * confirmed one.
 */
export function createTriggerDraft(trigger: TriggerDefinition | null, source: TriggerDraftSource) {
  let warnings: readonly ValidationIssue[] = [];
  const draft = createRevisionedDraft({
    saved: trigger,
    content: trigger ? contentOf(trigger) : newContent,
    contentOf,
    list: () => source.getSnapshot().triggers,
    view(state): TriggerDraftSnapshot {
      const query = parseTriggerQuery(state.content.query);
      return {
        ...state,
        canSave: state.canSave && !(!state.saved && state.saveOutcome === "unknown"),
        query: query.ok ? query.value : { error: query.error.message },
        warnings,
      };
    },
  });
  function received(save: TriggerSave) {
    warnings = save.warnings;
    return save.trigger;
  }
  function edit(change: Partial<TriggerContent>) {
    const { saving, removed, removing } = draft.getSnapshot();
    if ((saving && !removed) || removing) return;
    warnings = [];
    draft.edit(change);
  }
  return {
    getSnapshot: draft.getSnapshot,
    subscribe: draft.subscribe,
    /** Follows Studio's saved Triggers until the returned function is called. */
    connect() {
      const unsubscribe = source.subscribe(draft.reconcile);
      draft.reconcile();
      return unsubscribe;
    },
    edit,
    chooseProject(projectId: string) {
      const saved = draft.getSnapshot().saved;
      edit({
        projectId,
        repository: saved && saved.projectId === projectId ? contentOf(saved).repository : null,
      });
    },
    /** Factory detected `projectId`'s repository; it fills the form only for that Project. */
    detectRepository(projectId: string, repository: TriggerRepository) {
      const { content } = draft.getSnapshot();
      if (content.projectId !== projectId || content.repository) return;
      const { host, nameWithOwner, nodeId } = repository;
      draft.edit({ repository: { host, nameWithOwner, nodeId } });
    },
    /** Validates and sends the draft against its saved revision, or creates it. */
    async save() {
      const { saved, content, canSave } = draft.getSnapshot();
      if (!canSave) return undefined;
      const request = saveRequest(saved, content, source, received);
      if (!("error" in request)) return draft.save(request);
      draft.report(request.error);
      return undefined;
    },
    dismissUpdate: draft.dismissUpdate,
    compare: draft.compare,
    loadLatest: draft.takeLatest,
    keepEdits: draft.keep,
    /** The user checked the Trigger list after an unknown Create, so Create may be sent again. */
    allowCreateAgain() {
      if (draft.getSnapshot().saved) return;
      draft.acknowledgeUnknownSave();
    },
  };
}

export type TriggerDraftModel = ReturnType<typeof createTriggerDraft>;

export function useTriggerDraftSnapshot(draft: TriggerDraftModel) {
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
}
