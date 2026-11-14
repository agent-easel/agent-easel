/**
 * The portable definition document (version 1): the file a Definition export writes and an import
 * reads. It holds only portable definition data: no environment, server ids, revisions,
 * definition timestamps or Runs.
 */
import type { AgentModelOptionValue } from "./agent.ts";
import type { BlockExit } from "./flow.ts";

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

/** What an export answers: the file's document and what it could not keep. */
export interface DefinitionExport<Document extends PortableEnvelope = PortableAgentDocument> {
  readonly document: Document;
  /** Bundled Agents whose model hint omits `driverKind` because the live catalog did not list it. */
  readonly driverKindOmitted: readonly Pick<PortableAgent, "key" | "name">[];
}
