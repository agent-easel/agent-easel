import {
  type AgentCapabilities,
  type AgentDefinition,
  type AgentExecutionSettings,
  type FlowAgentRevisions,
  type FlowGraphInput,
  type ProjectIcon,
  type ProjectIconColor,
  type StartTitleProvenance,
} from "@agent-easel/contracts";

export const TASK_TITLE_LIMIT = 500;

/** The automatic Run title: the prompt text's first non-empty line, trimmed and bounded. */
export function promptTitle(text: string): string | undefined {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, TASK_TITLE_LIMIT);
}

const START_TITLE_PROVENANCES: readonly unknown[] = [
  "automatic",
  "manual",
  "legacy",
] satisfies StartTitleProvenance[];

export function isStartTitleProvenance(value: unknown): value is StartTitleProvenance {
  return START_TITLE_PROVENANCES.includes(value);
}

/** Run navigation compares creation times as text, so only `Date.toISOString()` output is valid. */
export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

const PROJECT_ICON_COLORS = new Set<ProjectIconColor>([
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

const projectIconColor = (value: unknown): ProjectIconColor | undefined =>
  typeof value === "string" && PROJECT_ICON_COLORS.has(value as ProjectIconColor)
    ? (value as ProjectIconColor)
    : undefined;

const boundedText = (value: unknown, min: number, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return undefined;
  return trimmed;
};

const unsafeRenderableText = (value: string): boolean =>
  value.includes("<") || /^https?:\/\//i.test(value);

const optionalMonogram = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const text = boundedText(value, 1, 4);
  if (!text || unsafeRenderableText(text)) return undefined;
  return text;
};

function lucideProjectIcon(
  record: Record<string, unknown>,
  color: ProjectIconColor | undefined,
): ProjectIcon | null {
  const name = boundedText(record.name, 1, 128);
  if (!name || unsafeRenderableText(name) || !color) return null;
  const monogram = optionalMonogram(record.monogram);
  const monogramText = optionalMonogram(record.monogramText);
  return {
    kind: "lucide",
    name,
    color,
    ...(monogram !== undefined ? { monogram } : {}),
    ...(monogramText !== undefined ? { monogramText } : {}),
  };
}

const FAVICON_PATH_LIMIT = 512;

/** Bounds untrusted T3 faviconPath metadata; unknown or unsafe values become null. */
export function parseProjectFaviconPath(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  if (input.includes("\0")) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > FAVICON_PATH_LIMIT) return null;
  if (trimmed.startsWith("/") || trimmed.includes("\\") || /^[a-z]:/i.test(trimmed)) return null;
  if (trimmed.split("/").includes("..")) return null;
  return trimmed;
}

/** Bounds untrusted T3 projectIcon metadata; unknown or malformed values become null. */
export function parseProjectIcon(input: unknown): ProjectIcon | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const color = projectIconColor(record.color);
  if (record.kind === "emoji") {
    const emoji = boundedText(record.emoji, 1, 32);
    if (!emoji || unsafeRenderableText(emoji)) return null;
    return { kind: "emoji", emoji };
  }
  if (record.kind === "monogram") {
    const text = boundedText(record.text, 1, 4);
    if (!text || unsafeRenderableText(text) || !color) return null;
    return { kind: "monogram", text, color };
  }
  if (record.kind === "lucide") {
    return lucideProjectIcon(record, color);
  }
  return null;
}

/** Whether any Agent block in the graph references the saved Agent definition. */
export function flowGraphReferencesAgent(graph: FlowGraphInput, agentId: string): boolean {
  return graph.blocks.some((block) => block.kind === "agent" && block.agentId === agentId);
}

export function handoffRecipients(
  connections: FlowGraphInput["connections"],
  sourceBlockId: string,
  exitId: string,
): string[] {
  return [
    ...new Set(
      connections.flatMap((edge) =>
        edge.sourceBlockId === sourceBlockId &&
        edge.exitId === exitId &&
        edge.targetEndingId === undefined
          ? [edge.targetBlockId]
          : [],
      ),
    ),
  ];
}

export function handoffEndings(
  connections: FlowGraphInput["connections"],
  sourceBlockId: string,
  exitId: string,
): string[] {
  return [
    ...new Set(
      connections.flatMap((edge) =>
        edge.sourceBlockId === sourceBlockId &&
        edge.exitId === exitId &&
        edge.targetEndingId !== undefined
          ? [edge.targetEndingId]
          : [],
      ),
    ),
  ];
}

export {
  blockLabel,
  conditionStartReady,
  continuationSources,
  flowReadiness,
  placementIssues,
  reachesEnding,
  readinessAgent,
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  waitDurationMs,
  type ReadinessAgent,
  type ReadinessFlow,
  type ReadinessFlows,
} from "./readiness.ts";

/**
 * The dependency stamp of Flow readiness: readiness depends only on the graph and the saved
 * revision and owning Project of each Agent it places, because an Agent's exits and former exit
 * names are fixed per revision while its owner changes without one. Equal stamps for the same
 * graph mean equal readiness.
 */
export function flowAgentRevisions(
  graph: FlowGraphInput,
  agents: readonly Pick<AgentDefinition, "id" | "revision" | "projectId">[],
): FlowAgentRevisions {
  const revisions: Record<string, FlowAgentRevisions[string]> = {};
  for (const block of graph.blocks)
    if (block.kind === "agent" && block.agentId) {
      const agent = agents.find((candidate) => candidate.id === block.agentId);
      revisions[block.agentId] = agent
        ? { revision: agent.revision, projectId: agent.projectId }
        : null;
    }
  return revisions;
}

/** Resolve saved execution identifiers against a capability catalog without substituting defaults. */
export function resolveAgentModel(
  execution: Pick<AgentExecutionSettings, "providerInstanceId" | "modelId">,
  capabilities: AgentCapabilities | null,
) {
  const provider = capabilities?.providers.find(
    (entry) => entry.providerInstanceId === execution.providerInstanceId,
  );
  const model = provider?.models.find((entry) => entry.id === execution.modelId);
  return { provider, model };
}

export { connectionKey } from "./flow.ts";
export { joinSlots, type JoinSlot } from "./join.ts";
export {
  agentCaptureBytes,
  compositionReadiness,
  findingsPage,
  subflowCyclePath,
  type CompositionDefinitions,
  type CompositionReadiness,
} from "./composition.ts";
export {
  duplicateTreatment,
  mayPlaceAgent,
  mayPlaceFlow,
  mayStartFlow,
  OWNING_PROJECT_ID_LIMIT,
  type OwningProject,
  validateChangeOwner,
} from "./placement.ts";
export {
  CONDITION_OTHERWISE,
  CONTINUATION_EXIT,
  effectiveExits,
  exitsWithEndings,
  inheritedExits,
  HUMAN_EXITS,
  JOIN_OUTPUT,
  WAIT_OUTPUT,
  type EffectiveExit,
  type ExitFlows,
  type ExitSource,
  type ExitWithEndings,
} from "./block-exits.ts";
export {
  CLIENT_LABEL_LIMIT,
  FACTORY_MINIMUM_PEER_PROTOCOL,
  FACTORY_MINIMUM_SERVER_PROTOCOL,
  FACTORY_PROTOCOL,
  protocolCompatibility,
  validateClientAccessRequest,
} from "./client-access.ts";
export {
  imageSignatureMime,
  isSha256Hex,
  parseStartPrompt,
  promptText,
  RUN_IMAGE_DELETION_LIMIT,
  RUN_IMAGE_LIMIT,
  RUN_IMAGE_MAX_BYTES,
  RUN_IMAGE_MIME_TYPES,
  RUN_IMAGE_NAME_LIMIT,
  validateStartPrompt,
  type StartPrompt,
} from "./run-prompt.ts";
export {
  MAX_THEME_JSON_BYTES,
  parseCustomThemeJson,
  parseStoredCustomTheme,
  type CustomThemeParseResult,
  type StoredCustomTheme,
} from "./appearance.ts";
export { buildOptions, hintedSelection, optionAvailability, optionValue } from "./model-options.ts";
export {
  CANVAS_COORD_MAX,
  CANVAS_COORD_MESSAGE,
  CANVAS_COORD_MIN,
  flowEditSizeRefusal,
  isCanvasPosition,
  validateCreateFlow,
  validateDuplicateFlow,
  validateListFlowFindings,
  validatePreviewFlowDuplicate,
  validateUpdateFlow,
} from "./flow.ts";
export {
  executionForProject,
  validateCreateAgent,
  validateDuplicateAgent,
  validateExecutionSettings,
  validateUpdateAgent,
  validateUpdateRunTitleSetting,
} from "./agent.ts";
export {
  bindPortableBlocks,
  DEFINITION_REQUEST_LIMIT_BYTES,
  definitionSaveFits,
  parsePortableFile,
  saveRequestBound,
  PORTABLE_DOCUMENT_AGENT_LIMIT,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
  portableDocumentText,
  validateCommitImport,
  validatePortableDocument,
} from "./portable-document.ts";
export {
  CHAT_MODEL_BASE_URL_LIMIT,
  CHAT_MODEL_KEY_LIMIT,
  CHAT_MODEL_NAME_LIMIT,
  CHAT_MODEL_PROVIDER_KINDS,
  validateChatModelBaseUrl,
  validateCheckDiscordConnection,
  validateDiscordId,
  validateDiscordPublicKey,
  validateTestChatModel,
  validateUpdateChatModel,
  validateUpdateDiscordConnection,
  validateUpdateDiscordAccess,
  validateSetChatControlEnabled,
  validateRetryChatDelivery,
} from "./chat-control.ts";
export {
  parseTriggerQuery,
  validateTriggerLimit,
  validateTriggerSchedule,
  TRIGGER_DEFAULTS,
  validateCreateTrigger,
  validatePreviewNewTrigger,
  validatePreviewTrigger,
  validateRunTrigger,
  validateSetTriggerEnabled,
  validateUpdateTrigger,
  type TriggerPreviewSettings,
  type TriggerSettings,
  type TriggerUpdateSettings,
} from "./trigger.ts";
export {
  describeDiagnosticEntry,
  DIAGNOSTIC_ATTEMPT_PAGE_LIMIT,
  DIAGNOSTIC_ENTRY_LIMIT,
  DIAGNOSTIC_RECORDING_MS,
  DIAGNOSTIC_RETENTION_MS,
  diagnosticHost,
  diagnosticLogMarkdown,
  diagnosticOperationName,
  diagnosticPath,
  diagnosticVersion,
  validateDiagnosticEntry,
  type DiagnosticStepLine,
} from "./diagnostics.ts";
