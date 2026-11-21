/**
 * The portable definition document: the file a Definition export writes (always the current
 * version) and an import reads (any readable version). It holds only portable definition data: no
 * environment, server ids, revisions, definition timestamps or Runs.
 */
import type { AgentCapabilities, AgentExecutionSettings, AgentModelOptionValue } from "./agent.ts";
import type { BlockExit, FlowBlock, FlowFinishBlock, FlowGraph, FlowWorkspace } from "./flow.ts";
import { operation, type RawBody } from "./operation.ts";

export const PORTABLE_DOCUMENT_FORMAT = "t3-factory/definitions";
/** The version every export writes. */
export const PORTABLE_DOCUMENT_VERSION = 5;
export type PortableFormatVersion = 1 | 2 | 3 | 4 | typeof PORTABLE_DOCUMENT_VERSION;

/**
 * The exporter's model choice, which a receiving installation may match against its own catalog.
 * `driverKind` comes from the exporter's live catalog and is absent when it could not be resolved.
 */
export interface PortableModelHint {
  readonly driverKind?: string;
  readonly providerInstanceId: string;
  readonly modelId: string;
  readonly modelOptions: readonly AgentModelOptionValue[];
}

/** One bundled Agent; Agent and Flow documents share this entry. */
export interface PortableAgent {
  /** Document-local reference, `[A-Za-z][A-Za-z0-9_-]{0,63}`, unique within the document. */
  readonly key: string;
  readonly name: string;
  readonly prompt: string;
  /** Present exactly when the source Agent has execution settings. */
  readonly model: PortableModelHint | null;
  readonly exits: readonly BlockExit[];
}

interface PortableEnvelope<Version extends PortableFormatVersion> {
  readonly format: typeof PORTABLE_DOCUMENT_FORMAT;
  readonly formatVersion: Version;
  /** Informational only; import never interprets it. */
  readonly factoryVersion: string;
  /** Informational only; import never interprets it. */
  readonly exportedAt: string;
}

export interface PortableAgentDocument<
  Version extends PortableFormatVersion = typeof PORTABLE_DOCUMENT_VERSION,
> extends PortableEnvelope<Version> {
  readonly kind: "agent";
  /** Exactly one Agent. */
  readonly agents: readonly [PortableAgent];
}

/**
 * A Flow document's block. An Agent block names its Agent by document key, never by a local id or
 * name; `agentKey` is null when the exported block had no Agent or its Agent was missing.
 */
export type PortableFlowBlock =
  | (Omit<Extract<FlowBlock, { kind: "agent" }>, "agentId"> & { readonly agentKey: string | null })
  | (Omit<Extract<FlowBlock, { kind: "subflow" }>, "flowId"> & { readonly flowKey: string | null })
  | Exclude<FlowBlock, { kind: "agent" | "subflow" }>;

export interface PortableFlow {
  readonly name: string;
  readonly graph: Omit<FlowGraph, "blocks" | "finish"> & {
    readonly blocks: readonly PortableFlowBlock[];
    readonly finish?: FlowFinishBlock;
  };
  readonly workspace: FlowWorkspace;
}

export interface PortableFlowEntry extends PortableFlow {
  readonly key: string;
}

export interface PortableFlowDocument extends PortableEnvelope<typeof PORTABLE_DOCUMENT_VERSION> {
  readonly kind: "flow";
  readonly rootFlowKey: string;
  readonly flows: readonly PortableFlowEntry[];
  readonly agents: readonly PortableAgent[];
}

interface LegacyFlowDocument extends PortableEnvelope<
  Exclude<PortableFormatVersion, typeof PORTABLE_DOCUMENT_VERSION>
> {
  readonly kind: "flow";
  readonly flow: PortableFlow;
  readonly agents: readonly PortableAgent[];
}

/** Every document kind an export writes. */
export type PortableDocument = PortableAgentDocument | PortableFlowDocument;

/**
 * A file of any readable version as import decodes it: the current definition model under the
 * file's own `formatVersion`, which an import receipt's fingerprint covers.
 */
export type ImportedDocument =
  | PortableAgentDocument<PortableFormatVersion>
  | PortableFlowDocument
  | LegacyFlowDocument;

/** What an export answers: the file's document and what it could not keep. */
export interface DefinitionExport<Document extends PortableDocument = PortableDocument> {
  readonly document: Document;
  /** Bundled Agents whose model hint omits `driverKind` because the live catalog did not list it. */
  readonly driverKindOmitted: readonly Pick<PortableAgent, "key" | "name">[];
}

/**
 * How the review matched a bundled Agent's hint against the connected environment's live catalog.
 * Only `matched` proposes a model; `candidates` names the provider instances that tied.
 */
export type ImportModelMatch =
  | { readonly status: "matched" | "unmatched" | "no_model" }
  | { readonly status: "ambiguous"; readonly candidates: readonly string[] };

/** One bundled Agent as the import review shows it: its instruction inventory, never prompt text. */
export interface ImportReviewAgent {
  readonly key: string;
  readonly name: string;
  readonly promptLength: number;
  readonly exitCount: number;
  readonly hint: PortableModelHint | null;
  readonly match: ImportModelMatch;
  /** The selection the review starts from; null is Needs a model. */
  readonly proposed: AgentExecutionSettings | null;
  /** The hint's options the proposed model does not accept; empty without a proposal. */
  readonly droppedOptions: readonly AgentModelOptionValue[];
}

export type ImportReviewInstruction = {
  readonly blockId: string;
  readonly blockName: string;
  readonly length: number;
} & (
  | { readonly kind: "agent"; readonly agentName: string }
  | { readonly kind: "continuation" | "revisit" }
);

export interface ImportReviewFlow {
  readonly key: string | null;
  readonly name: string;
  readonly opensAfterImport: boolean;
  readonly blockCount: number;
  readonly workspace: FlowWorkspace;
  readonly uses: readonly { readonly flowName: string; readonly blockName: string }[];
  readonly usesItself: boolean;
  readonly instructions: readonly ImportReviewInstruction[];
}

/** What an import would create, computed without writing anything. */
export interface ImportReview {
  readonly kind: PortableDocument["kind"];
  readonly flows: readonly ImportReviewFlow[];
  readonly agents: readonly ImportReviewAgent[];
  /** The live catalog the review read; its picker offers only reporting-capable providers. */
  readonly capabilities: AgentCapabilities;
}

export interface CommitImportInput {
  /** Client-generated per import; a retry with the same content returns the original result. */
  readonly requestId: string;
  /** The file's document as read; any readable version. */
  readonly document: ImportedDocument;
  /** The reviewed choice for every bundled Agent by key: complete settings, or null (Needs a model). */
  readonly selections: Readonly<Record<string, AgentExecutionSettings | null>>;
  /**
   * The import target owning every created definition: a Factory Project id available for new
   * Runs, or null (the default when omitted) for Global.
   */
  readonly projectId?: string | null;
}

/** The definitions an import created, by document key. They may have been removed since. */
export interface ImportResult {
  readonly agents: readonly { readonly key: string; readonly id: string }[];
  /** The created Flow; null for an Agent file. */
  readonly flowId: string | null;
  readonly flows?: readonly { readonly key: string; readonly id: string }[];
}

/** Import of a portable document: a review that writes nothing, then an all-or-nothing commit. */
export const definitionImportOperations = {
  /** The chosen file's bytes, exactly as read. */
  reviewImport: operation<RawBody, ImportReview>()({
    method: "POST",
    path: "/api/imports/review",
    body: "bytes",
  }),
  commitImport: operation<CommitImportInput, ImportResult>()({
    method: "POST",
    path: "/api/imports",
    body: "json",
  }),
};
