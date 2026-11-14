import type {
  AgentCapabilities,
  CommitImportInput,
  CreateAgentInput,
  DefinitionExport,
  ImportReview,
  ImportReviewAgent,
  PortableAgent,
  PortableAgentDocument,
  PortableDocument,
  PortableModelHint,
  Result,
  ValidationIssue,
} from "@t3-factory/contracts";
import {
  DEFINITION_REQUEST_LIMIT_BYTES,
  hintedSelection,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
  portableDocumentText,
  resolveAgentModel,
} from "@t3-factory/domain-validation";
import type { AgentRevision } from "./agent-revisions.ts";
import { unsupportedReportingFailure } from "./agents.ts";
import { failure } from "./result.ts";

/** The bundled entry of a saved Agent. The hint keeps the exporter's model but never its environment. */
export function portableAgent(
  agent: AgentRevision,
  key: string,
  capabilities: AgentCapabilities,
): PortableAgent {
  const { execution } = agent;
  if (execution === null)
    return { key, name: agent.name, prompt: agent.prompt, model: null, exits: agent.exits };
  const driverKind = resolveAgentModel(execution, capabilities).provider?.driverKind;
  return {
    key,
    name: agent.name,
    prompt: agent.prompt,
    model: {
      ...(driverKind === undefined ? {} : { driverKind }),
      providerInstanceId: execution.providerInstanceId,
      modelId: execution.modelId,
      modelOptions: execution.modelOptions,
    },
    exits: agent.exits,
  };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * The export, or a refusal when import could not accept its file: each definition's save request
 * must fit the definition limit and the whole file the import limit.
 */
export function definitionExport(
  document: PortableAgentDocument,
  agents: readonly AgentRevision[],
): Result<DefinitionExport> {
  const issues = agents.flatMap((agent, index): ValidationIssue[] => {
    const request: CreateAgentInput = {
      name: agent.name,
      prompt: agent.prompt,
      execution: agent.execution,
      exits: agent.exits,
    };
    return jsonBytes(request) > DEFINITION_REQUEST_LIMIT_BYTES
      ? [
          {
            code: "definition_too_large",
            path: `agents.${index}`,
            message: `Agent "${agent.name}" is larger than the 2 MB a definition may be.`,
          },
        ]
      : [];
  });
  if (Buffer.byteLength(portableDocumentText(document)) > PORTABLE_DOCUMENT_LIMIT_BYTES)
    issues.push({
      code: "document_too_large",
      path: "document",
      message: "The file would be larger than the 16 MiB an import accepts.",
    });
  if (issues.length > 0)
    return failure(
      "validation",
      "Factory could not export this file because another installation could not import it.",
      issues,
    );
  return {
    ok: true,
    value: {
      document,
      driverKindOmitted: document.agents
        .filter((agent) => agent.model !== null && agent.model.driverKind === undefined)
        .map(({ key, name }) => ({ key, name })),
    },
  };
}

/**
 * The proposal for one hint from the connected environment's catalog. Candidates are
 * reporting-capable instances of the hint's driver kind offering its exact model; the instance of
 * the same name wins, otherwise a sole candidate. A hint without a driver kind matches only that
 * same-named instance. Nothing matches while the catalog is not ready.
 */
function matchModelHint(
  hint: PortableModelHint | null,
  capabilities: AgentCapabilities,
): Pick<ImportReviewAgent, "match" | "proposed" | "droppedOptions"> {
  if (hint === null) return { match: { status: "no_model" }, proposed: null, droppedOptions: [] };
  const environmentId =
    capabilities.state === "ready" ? capabilities.environments[0]?.environmentId : undefined;
  const candidates =
    environmentId === undefined
      ? []
      : capabilities.providers.flatMap((provider) => {
          const model = provider.models.find((entry) => entry.id === hint.modelId);
          const eligible =
            hint.driverKind === undefined
              ? provider.providerInstanceId === hint.providerInstanceId
              : provider.driverKind === hint.driverKind;
          return model && eligible && provider.reporting.supported ? [{ provider, model }] : [];
        });
  const winner =
    candidates.find(({ provider }) => provider.providerInstanceId === hint.providerInstanceId) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (environmentId === undefined || winner === undefined)
    return {
      match:
        candidates.length > 1
          ? {
              status: "ambiguous",
              candidates: candidates.map(({ provider }) => provider.providerInstanceId),
            }
          : { status: "unmatched" },
      proposed: null,
      droppedOptions: [],
    };
  const { selection, droppedOptions } = hintedSelection(
    { environmentId, providerInstanceId: winner.provider.providerInstanceId },
    winner.model,
    hint.modelOptions,
  );
  return { match: { status: "matched" }, proposed: selection, droppedOptions };
}

/** What an import would create, with each Agent's model proposal from the catalog read here. */
export function importReview(
  document: PortableDocument,
  capabilities: AgentCapabilities,
): ImportReview {
  return {
    kind: document.kind,
    agents: document.agents.map((agent) => ({
      key: agent.key,
      name: agent.name,
      promptLength: agent.prompt.length,
      exitCount: agent.exits.length,
      hint: agent.model,
      ...matchModelHint(agent.model, capabilities),
    })),
    capabilities,
  };
}

/**
 * The ordinary save rule over every selection at once: a listed provider without Factory reporting
 * rejects the whole commit and names each affected Agent. A provider the catalog does not list,
 * including while it is unavailable, never rejects.
 */
export function unsupportedSelections(
  { document, selections }: CommitImportInput,
  capabilities: AgentCapabilities,
): Result<never> | undefined {
  const refused = document.agents.flatMap((agent) => {
    const refusal = unsupportedReportingFailure(selections[agent.key] ?? null, capabilities);
    return refusal && !refusal.ok ? [{ agent, explanation: refusal.error.message }] : [];
  });
  if (refused.length === 0) return undefined;
  const names = refused.map(({ agent }) => `"${agent.name}"`).join(", ");
  return failure(
    "validation",
    `Choose another model for ${names}: Factory cannot take reports from the chosen provider.`,
    refused.map(({ agent, explanation }) => ({
      code: "harness_unsupported",
      path: `selections.${agent.key}.providerInstanceId`,
      message: `Agent "${agent.name}": ${explanation}`,
    })),
  );
}
