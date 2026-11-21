import type { ConnectionState, FlowWorkspace, T3Contract } from "@t3-factory/contracts";
import type { T3ConnectionReason, T3Endpoint } from "./connection.ts";

export interface T3ContractReader {
  inspect(target: T3Endpoint): Promise<T3Inspection>;
}

export interface T3Inspection {
  readonly state: ConnectionState;
  readonly reason: T3ConnectionReason;
  /** Opaque grant lineage, never an access/refresh token or client secret. */
  readonly authorizationIdentity?: string;
  readonly contract?: T3Contract;
  /** Every support answer of this inspection; nothing is supported unless T3 is ready. */
  readonly support: T3Support;
}
export interface ReportSupport {
  readonly supported: boolean;
  readonly explanation: string;
}
/** What T3's advertised tools let Factory do, as one inspection found them. */
export interface T3Support {
  /** A worktree Run's workers also need `worktree` and `existing_worktree` launches. */
  readonly launch: Readonly<Record<FlowWorkspace["mode"], LaunchSupport>>;
  /** The most images one launch may carry through `t3_attachment_prepare_upload`; null when T3
   * advertises no uploaded attachments with a request key. */
  readonly attachmentLimit: number | null;
  readonly send: LaunchSupport;
  readonly freshContextSend: boolean;
  readonly settle: ReportSupport;
  readonly stop: ReportSupport;
  readonly rename: RenameSupport;
  /** Whether public thread reads can retrieve reporting activity, before any harness check. */
  readonly reportReads: boolean;
}
export interface RenameSupport {
  readonly supported: boolean;
  readonly includeEnvironmentId: boolean;
  readonly explanation: string;
}
/** One connection check's answer: the authorization context, only while T3 is ready, and the
 * support answers of the same inspection. `answered` is false when T3 could not be reached for
 * it, so a missing context is no evidence that authorization changed. */
export interface T3ContractSnapshot {
  readonly contextId: string | null;
  readonly answered: boolean;
  readonly support: T3Support;
}
export interface LaunchSupport {
  readonly supported: boolean;
  /** Non-null only when the adapter can establish continuity AND retained replay keys.
   * Matching version/schema alone is insufficient. Changes invalidate uncertain replay. */
  readonly retryScope: string | null;
  /** Null when a replay proof could not be established, so whether T3 supports the operation is
   * unknown; each caller explains what that means for its operation. */
  readonly explanation: string | null;
}
type ToolSchema = T3Contract["tools"][number]["inputSchema"] | undefined;
type SchemaProperty = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
};
const propertiesOf = <P = SchemaProperty>(schema: ToolSchema) =>
  (schema?.properties ?? {}) as Record<string, P>;

const INDIRECT_SCHEMA = [
  "$ref",
  "$dynamicRef",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
];

const permitsOmittingRuntimeMode = (schema: ToolSchema) => {
  if (schema?.type !== "object") return false;
  // Only the flat launch contract is understood; compositions may impose hidden requirements.
  if (INDIRECT_SCHEMA.some((key) => key in schema)) return false;
  const required = schema.required;
  return required === undefined || (Array.isArray(required) && !required.includes("runtimeMode"));
};

const LAUNCH_STRING_FIELDS = [
  "environmentId",
  "projectId",
  "title",
  "message",
  "clientRequestId",
  "interactionMode",
];

/** Saved provider instance, model, options and workspace strategy must all be expressible. */
const preservesLaunchSettings = (schema: ToolSchema, props: Record<string, SchemaProperty>) =>
  schema?.type === "object" &&
  LAUNCH_STRING_FIELDS.every((field) => props[field]?.type === "string") &&
  props.modelSelection?.type === "object" &&
  ["instanceId", "model", "options"].every(
    (field) => field in (props.modelSelection?.properties ?? {}),
  ) &&
  props.workspaceStrategy?.type === "object";

/** T3 advertises its strategy union flattened into one object: every field Factory may send for
 * `worktree` or `existing_worktree` must be named and only `type` may be required. */
const expressesWorktreeLaunches = (props: Record<string, SchemaProperty>) => {
  const strategy = props.workspaceStrategy;
  const fields = (strategy?.properties ?? {}) as Record<string, SchemaProperty>;
  const strategyRequired = strategy?.required ?? [];
  return (
    ["worktree", "existing_worktree"].every((type) => fields.type?.enum?.includes(type)) &&
    ["baseRef", "branch", "worktreePath"].every((field) => fields[field]?.type === "string") &&
    fields.startFromOrigin?.type === "boolean" &&
    Array.isArray(strategyRequired) &&
    strategyRequired.every((field) => field === "type")
  );
};

function launchExplanation(supported: boolean, omissionPermitted: boolean) {
  if (supported)
    return "Launch schema supports saved settings and a request key. Replay requires separate continuity/retention proof.";
  if (!omissionPermitted)
    return "T3 launch schema does not establish support for omitting runtimeMode. Use a compatible T3 launch schema before starting or replaying this Run.";
  return "T3 launch schema cannot preserve the selected settings and request key.";
}

function launchSupport(ready: boolean, schema: ToolSchema): T3Support["launch"] {
  const props = propertiesOf(schema);
  const omissionPermitted = permitsOmittingRuntimeMode(schema);
  const launchable = omissionPermitted && ready && preservesLaunchSettings(schema, props);
  const checkout: LaunchSupport = {
    supported: launchable,
    retryScope: null,
    explanation: launchExplanation(launchable, omissionPermitted),
  };
  const worktree: LaunchSupport =
    launchable && !expressesWorktreeLaunches(props)
      ? {
          supported: false,
          retryScope: null,
          explanation:
            "T3 launch schema cannot express worktree and existing_worktree launches. Update T3 before starting a worktree Run.",
        }
      : checkout;
  return { checkout, worktree };
}

function attachmentLimit(ready: boolean, tools: T3Contract["tools"], launch: ToolSchema) {
  const props = propertiesOf<SchemaProperty & { maxItems?: unknown }>(launch);
  const attachments = props.attachments;
  return ready &&
    tools.some((tool) => tool.name === "t3_attachment_prepare_upload") &&
    props.clientRequestId?.type === "string" &&
    attachments?.type === "array" &&
    typeof attachments.maxItems === "number"
    ? attachments.maxItems
    : null;
}

function sendSupport(ready: boolean, schema: ToolSchema): LaunchSupport {
  const props = propertiesOf(schema);
  const supported =
    ready &&
    ["environmentId", "threadId", "clientRequestId", "message", "mode"].every(
      (field) => props[field]?.type === "string",
    ) &&
    props.mode?.enum?.includes("queue") === true;
  return {
    supported,
    retryScope: null,
    explanation: supported
      ? "Queue schema supports independent turns and a request key. Replay requires separate continuity/retention proof."
      : "T3 send schema cannot preserve queue mode and the request key.",
  };
}

function settleSupport(ready: boolean, schema: ToolSchema): ReportSupport {
  const props = propertiesOf(schema);
  const required = schema?.required ?? [];
  const supported =
    ready &&
    props.threadId?.type === "string" &&
    props.action?.type === "string" &&
    props.action.enum?.includes("settle") === true &&
    Array.isArray(required) &&
    required.every((field) => ["threadId", "action"].includes(field));
  return {
    supported,
    explanation: supported
      ? "Explicit thread settlement is supported. Organization has no execution compare-and-set or replay key."
      : "T3 organization schema cannot preserve explicit thread settlement.",
  };
}

function stopSupport(ready: boolean, schema: ToolSchema): ReportSupport {
  const props = propertiesOf(schema);
  const supported =
    ready &&
    ["threadId", "clientRequestId"].every((field) => props[field]?.type === "string") &&
    props.stop?.type === "boolean";
  return {
    supported,
    explanation: supported
      ? "Thread Stop supported; it is not run-fenced."
      : "T3 Stop schema unavailable.",
  };
}

type ReportSchemaProperty = SchemaProperty & {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
};
const REPORT_STRING_FIELDS = ["threadId", "itemId", "view"];
const REPORT_INTEGER_FIELDS = ["textOffset", "afterPosition", "limit", "maxCharsPerItem"];
const REPORT_READ_BOUNDS: readonly (readonly [string, number])[] = [
  ["limit", 100],
  ["maxCharsPerItem", 50_000],
  ["textOffset", 0],
  ["textOffset", 262_144],
  ["afterPosition", 0],
  ["afterPosition", 10_000],
];

function permitsReadNumber(property: ReportSchemaProperty | undefined, value: number) {
  if (!property) return false;
  return (
    (property.minimum === undefined || property.minimum <= value) &&
    (property.maximum === undefined || property.maximum >= value) &&
    (property.exclusiveMinimum === undefined || property.exclusiveMinimum < value) &&
    (property.exclusiveMaximum === undefined || property.exclusiveMaximum > value) &&
    (property.const === undefined || property.const === value) &&
    (!property.enum || property.enum.includes(value))
  );
}

function supportsReportReads(schema: ToolSchema) {
  if (schema?.type !== "object") return false;
  const props = propertiesOf<ReportSchemaProperty>(schema);
  const required = schema.required;
  return (
    REPORT_STRING_FIELDS.every((field) => props[field]?.type === "string") &&
    REPORT_INTEGER_FIELDS.every((field) => props[field]?.type === "integer") &&
    REPORT_READ_BOUNDS.every(([field, value]) => permitsReadNumber(props[field], value)) &&
    (!props.view?.enum || props.view.enum.includes("activity")) &&
    (props.view?.const === undefined || props.view.const === "activity") &&
    (!required ||
      (Array.isArray(required) && required.every((field: unknown) => field === "threadId")))
  );
}

const RENAMED_FIELDS = ["threadId", "action", "title", "clientRequestId"] as const;
const STRING_CONSTRAINTS = ["pattern", "format", ...INDIRECT_SCHEMA];

type BoundedString = SchemaProperty & { minLength?: unknown; maxLength?: unknown };

function flatToolSchema(schema: ToolSchema) {
  return (
    schema?.type === "object" &&
    !INDIRECT_SCHEMA.some((key) => key in schema) &&
    (schema.required === undefined || Array.isArray(schema.required))
  );
}

function plainString(property: BoundedString | undefined, shortest: number, longest: number) {
  return (
    property?.type === "string" &&
    property.enum === undefined &&
    property.const === undefined &&
    !STRING_CONSTRAINTS.some((key) => key in property) &&
    lengthAllows(property, shortest, longest)
  );
}

function lengthAllows(property: BoundedString | undefined, shortest: number, longest: number) {
  const minLength = property?.minLength;
  const maxLength = property?.maxLength;
  return (
    (minLength === undefined || (typeof minLength === "number" && minLength <= shortest)) &&
    (maxLength === undefined || (typeof maxLength === "number" && maxLength >= longest))
  );
}

function actionPermitsRename(action: BoundedString | undefined) {
  if (action?.type !== "string" || STRING_CONSTRAINTS.some((key) => key in action)) return false;
  if (action.const !== undefined && action.const !== "rename") return false;
  if (action.enum !== undefined && !(Array.isArray(action.enum) && action.enum.includes("rename")))
    return false;
  return (action.enum !== undefined || action.const !== undefined) && lengthAllows(action, 6, 6);
}

const unsupportedRename = (explanation: string): RenameSupport => ({
  supported: false,
  includeEnvironmentId: false,
  explanation,
});

function renameSupport(ready: boolean, schema: ToolSchema): RenameSupport {
  if (!ready || !flatToolSchema(schema))
    return unsupportedRename("T3 thread update schema does not advertise thread rename.");
  const props = propertiesOf<BoundedString>(schema);
  const environmentId = plainString(props.environmentId, 1, Infinity);
  const allowed = new Set<string>([...RENAMED_FIELDS, ...(environmentId ? ["environmentId"] : [])]);
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const supported =
    plainString(props.threadId, 1, Infinity) &&
    actionPermitsRename(props.action) &&
    plainString(props.title, 5, 200) &&
    plainString(props.clientRequestId, 64, 64) &&
    (props.environmentId === undefined || environmentId) &&
    !["enum", "const", "propertyNames", "patternProperties", "minProperties", "maxProperties"].some(
      (key) => key in schema!,
    ) &&
    required.every((field) => typeof field === "string" && allowed.has(field));
  if (!supported)
    return unsupportedRename("T3 thread update schema cannot accept a worker title rename.");
  return {
    supported: true,
    includeEnvironmentId: environmentId,
    explanation: environmentId
      ? "Thread rename is supported and includes environmentId."
      : "Thread rename is supported.",
  };
}

/**
 * Every support answer T3's listed tools give while T3 is `ready`; nothing is supported otherwise.
 * Replay scopes stay null: only the adapter can prove continuity for a supported answer.
 */
export function contractSupport(ready: boolean, tools: T3Contract["tools"]): T3Support {
  const schema = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;
  const objectReady = (name: string) => ready && schema(name)?.type === "object";
  const sendSchema = schema("t3_thread_send");
  const send = sendSupport(objectReady("t3_thread_send"), sendSchema);
  return {
    launch: launchSupport(objectReady("t3_thread_launch"), schema("t3_thread_launch")),
    attachmentLimit: attachmentLimit(ready, tools, schema("t3_thread_launch")),
    send,
    freshContextSend:
      send.supported &&
      propertiesOf(sendSchema).freshContext?.type === "boolean" &&
      !(Array.isArray(sendSchema?.required) && sendSchema.required.includes("freshContext")),
    settle: settleSupport(objectReady("t3_thread_organize"), schema("t3_thread_organize")),
    stop: stopSupport(objectReady("t3_thread_interrupt"), schema("t3_thread_interrupt")),
    rename: renameSupport(objectReady("t3_thread_update"), schema("t3_thread_update")),
    reportReads: ready && supportsReportReads(schema("t3_thread_read")),
  };
}

/** The answers of a T3 that is not ready: nothing is supported. */
export const NO_T3_SUPPORT = contractSupport(false, []);

/** Whether one launch can carry `count` uploaded images. */
export function attachmentSupport(support: T3Support, count: number): ReportSupport {
  const supported = support.attachmentLimit !== null && support.attachmentLimit >= count;
  return {
    supported,
    explanation: supported
      ? "T3 accepts uploaded image attachments on launches."
      : `T3 does not advertise t3_attachment_prepare_upload and launch attachments for ${count} images with a request key.`,
  };
}

export function reportSupport(support: T3Support): ReportSupport {
  const supported = support.reportReads;
  return {
    supported,
    explanation: supported
      ? "Public T3 reads support exact-item provenance and complete tool metadata retrieval; each observation validates the returned identity."
      : "T3 public reads cannot safely retrieve reporting activity for this harness. Reconnect or update T3 and recheck.",
  };
}
