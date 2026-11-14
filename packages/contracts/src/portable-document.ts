/**
 * The portable definition document (version 1): the file a Definition export writes and an import
 * reads. It holds only portable definition data: no environment, server ids, revisions,
 * definition timestamps or Runs.
 */
import type { AgentCapabilities, AgentExecutionSettings, AgentModelOptionValue } from "./agent.ts";
import type { BlockExit } from "./flow.ts";
import { operation, type RawBody } from "./operation.ts";

export const PORTABLE_DOCUMENT_FORMAT = "t3-factory/definitions";
export const PORTABLE_DOCUMENT_VERSION = 1;

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

interface PortableEnvelope {
  readonly format: typeof PORTABLE_DOCUMENT_FORMAT;
  readonly formatVersion: typeof PORTABLE_DOCUMENT_VERSION;
  /** Informational only; import never interprets it. */
  readonly factoryVersion: string;
  /** Informational only; import never interprets it. */
  readonly exportedAt: string;
}

export interface PortableAgentDocument extends PortableEnvelope {
  readonly kind: "agent";
  /** Exactly one Agent. */
  readonly agents: readonly [PortableAgent];
}

/** Every document kind an import reads. */
export type PortableDocument = PortableAgentDocument;

/** What an export answers: the file's document and what it could not keep. */
export interface DefinitionExport<Document extends PortableEnvelope = PortableAgentDocument> {
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

/** What an import would create, computed without writing anything. */
export interface ImportReview {
  readonly kind: PortableDocument["kind"];
  readonly agents: readonly ImportReviewAgent[];
  /** The live catalog the review read; its picker offers only reporting-capable providers. */
  readonly capabilities: AgentCapabilities;
}

export interface CommitImportInput {
  /** Client-generated per import; a retry with the same content returns the original result. */
  readonly requestId: string;
  readonly document: PortableDocument;
  /** The reviewed choice for every bundled Agent by key: complete settings, or null (Needs a model). */
  readonly selections: Readonly<Record<string, AgentExecutionSettings | null>>;
}

/** The definitions an import created, by document key. They may have been removed since. */
export interface ImportResult {
  readonly agents: readonly { readonly key: string; readonly id: string }[];
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
