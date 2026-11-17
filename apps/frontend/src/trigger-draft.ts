import { useSyncExternalStore } from "react";
import type {
  CreateTriggerInput,
  FlowDraft,
  TriggerDefinition,
  TriggerRepository,
  TriggerSave,
  UpdateTriggerInput,
  ValidationIssue,
} from "@t3-factory/contracts";
import {
  mayStartFlow,
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
  "getSnapshot" | "subscribe" | "createTrigger" | "updateTrigger" | "getTrigger"
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

const identityOf = ({ host, nameWithOwner, nodeId }: TriggerRepository): TriggerRepository => ({
  host,
  nameWithOwner,
  nodeId,
});

function contentOf(trigger: TriggerDefinition): TriggerContent {
  return {
    name: trigger.name,
    projectId: trigger.projectId,
    flowId: trigger.flowId,
    repository: identityOf(trigger.github.repository),
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

/**
 * The Flows a Trigger of `projectId` may start, as New Run offers them: global Flows and the
 * Project's own. The chosen Flow stays listed, so one moved to another Project is still named
 * while readiness explains why it cannot start. Without a Project only global Flows are offered.
 */
export function triggerFlows(flows: readonly FlowDraft[], projectId: string, flowId: string) {
  return flows.filter((flow) => flow.id === flowId || mayStartFlow(flow.projectId, projectId));
}

/** The settings a save would send, validated, or why they cannot be sent. */
type TriggerProposal =
  | { readonly error: string }
  | { readonly kind: "update"; readonly id: string; readonly input: UpdateTriggerInput }
  | { readonly kind: "create"; readonly input: CreateTriggerInput & TriggerReviewedFields };

/** The fields a create sends in full, so a review can describe them. */
type TriggerReviewedFields = Required<Pick<CreateTriggerInput, "schedule" | "maxActiveRuns">>;

function proposalOf(trigger: TriggerDefinition | null, content: TriggerContent): TriggerProposal {
  if (content.projectId && !content.repository)
    return { error: "Wait until Factory detects the Project's GitHub repository." };
  const settings = settingsOf(content);
  if (trigger) {
    const input = { ...settings, expectedRevision: trigger.revision };
    const validation = validateUpdateTrigger(input);
    if (!validation.ok) return { error: validation.error.message };
    return { kind: "update", id: trigger.id, input };
  }
  const validation = validateCreateTrigger(settings);
  if (!validation.ok) return { error: validation.error.message };
  return { kind: "create", input: settings };
}

function saveRequest(
  trigger: TriggerDefinition | null,
  content: TriggerContent,
  source: TriggerDraftSource,
  received: (save: TriggerSave) => TriggerDefinition,
): { error: string } | SaveRequest<TriggerDefinition, TriggerContent> {
  const proposal = proposalOf(trigger, content);
  if ("error" in proposal) return proposal;
  const fallback = "Could not save this Trigger. Your edits are still here.";
  if (proposal.kind === "update")
    return {
      submitted: content,
      send: () => source.updateTrigger(proposal.id, proposal.input).then(received),
      unknownMessage:
        "Save outcome unknown. Factory may have saved this Trigger; your edits are kept and nothing is retried.",
      fallback,
    };
  return {
    submitted: content,
    send: () => source.createTrigger(proposal.input).then(received),
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
    read: source.getTrigger,
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
  /**
   * A Trigger's Project is a saved setting, not an owner: another client's Project change is a new
   * revision the draft already shows as saved elsewhere, so it never waits for an acknowledgement.
   */
  function acceptProject() {
    const { ownerChange } = draft.getSnapshot();
    if (ownerChange.status === "changed") draft.acknowledgeOwner(ownerChange.to);
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
      const reconcile = () => {
        draft.reconcile();
        acceptProject();
      };
      const unsubscribe = source.subscribe(reconcile);
      reconcile();
      return unsubscribe;
    },
    edit,
    /** Another Project keeps only a Flow it may start, as New Run does. */
    chooseProject(projectId: string, flows: readonly FlowDraft[]) {
      const { saved, content } = draft.getSnapshot();
      const flow = flows.find((entry) => entry.id === content.flowId);
      edit({
        projectId,
        repository: saved && saved.projectId === projectId ? contentOf(saved).repository : null,
        ...(flow && !mayStartFlow(flow.projectId, projectId) ? { flowId: "" } : {}),
      });
    },
    /** Factory detected `projectId`'s repository; it fills the form only for that Project. */
    detectRepository(projectId: string, repository: TriggerRepository) {
      const { content } = draft.getSnapshot();
      if (content.projectId !== projectId || content.repository) return;
      draft.edit({ repository: identityOf(repository) });
    },
    /**
     * The author confirmed the repository the Project's folder names now in place of the one the
     * Trigger confirmed before, such as after the Project's remote moved; saving it reviews.
     */
    confirmRepository(repository: TriggerRepository) {
      edit({ repository: identityOf(repository) });
    },
    /**
     * The validated settings a save would send now, for a review before saving; a reason they
     * cannot be sent is reported like a refused save.
     */
    proposal() {
      const { saved, content, canSave } = draft.getSnapshot();
      if (!canSave) return undefined;
      const proposal = proposalOf(saved, content);
      if (!("error" in proposal)) return proposal;
      draft.report(proposal.error);
      return undefined;
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
    keepEdits(revision: number) {
      draft.keep(revision);
      acceptProject();
    },
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
