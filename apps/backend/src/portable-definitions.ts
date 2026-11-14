import type {
  AgentCapabilities,
  CreateAgentInput,
  DefinitionExport,
  PortableAgent,
  PortableAgentDocument,
  Result,
  ValidationIssue,
} from "@t3-factory/contracts";
import {
  DEFINITION_REQUEST_LIMIT_BYTES,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
  portableDocumentText,
  resolveAgentModel,
} from "@t3-factory/domain-validation";
import type { AgentRevision } from "./agent-revisions.ts";
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
