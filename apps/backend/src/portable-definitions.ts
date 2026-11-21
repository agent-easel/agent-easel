import type {
  AgentCapabilities,
  CommitImportInput,
  DefinitionExport,
  ImportedDocument,
  ImportReview,
  ImportReviewAgent,
  ImportReviewFlow,
  ImportReviewInstruction,
  PortableAgent,
  PortableDocument,
  PortableFlow,
  PortableFlowEntry,
  PortableFlowBlock,
  PortableFlowDocument,
  PortableModelHint,
  Result,
} from "@t3-factory/contracts";
import {
  definitionSaveFits,
  hintedSelection,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
  portableDocumentText,
  validatePortableDocument,
  resolveAgentModel,
} from "@t3-factory/domain-validation";
import type { AgentRevision } from "./agent-revisions.ts";
import { unsupportedReportingFailure } from "./agents.ts";
import type { FlowRevision } from "./flow-revisions.ts";
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

export function portableComposition(
  flows: readonly FlowRevision[],
  placedAgents: readonly AgentRevision[],
  capabilities: AgentCapabilities,
) {
  const flowKeys = new Map(flows.map((flow, index) => [flow.id, `flow-${index + 1}`]));
  const agents = new Map(
    placedAgents.map((agent, index) => [
      agent.id,
      portableAgent(agent, `agent-${index + 1}`, capabilities),
    ]),
  );
  const entries = flows.map((flow): PortableFlowEntry => ({
    key: flowKeys.get(flow.id)!,
    name: flow.name,
    workspace: flow.workspace,
    graph: {
      ...flow.graph,
      blocks: flow.graph.blocks.map((block): PortableFlowBlock => {
        if (block.kind === "agent") {
          const { agentId, ...rest } = block;
          return {
            ...rest,
            agentKey: agentId === null ? null : (agents.get(agentId)?.key ?? null),
          };
        }
        if (block.kind === "subflow") {
          const { flowId, ...rest } = block;
          return { ...rest, flowKey: flowId === null ? null : (flowKeys.get(flowId) ?? null) };
        }
        return block;
      }),
    },
  }));
  return {
    rootFlowKey: entries[0]!.key,
    flows: entries,
    agents: [...agents.values()],
  } satisfies Pick<PortableFlowDocument, "flows" | "agents" | "rootFlowKey">;
}

function exportSizeOffender(document: PortableDocument) {
  const flows = document.kind === "flow" ? document.flows : [];
  const definitions = [...flows, ...document.agents];
  let bytes = 0;
  for (const entry of definitions) {
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (bytes > PORTABLE_DOCUMENT_LIMIT_BYTES) return entry.name;
  }
  if (Buffer.byteLength(portableDocumentText(document)) > PORTABLE_DOCUMENT_LIMIT_BYTES)
    return definitions[0]!.name;
  return undefined;
}

export function definitionExport<Document extends PortableDocument>(
  document: Document,
  agents: readonly AgentRevision[],
): Result<DefinitionExport<Document>> {
  const validated = validatePortableDocument(document);
  if (!validated.ok)
    return failure(
      validated.error.code,
      "Factory could not export this file because another installation could not import it.",
      validated.error.issues,
    );
  const oversized = agents.flatMap(({ name, prompt, execution, exits }, index) =>
    definitionSaveFits({ name, prompt, execution, exits, projectOverrides: [] })
      ? []
      : [
          {
            code: "definition_too_large",
            path: `agents.${index}`,
            message: `Agent "${name}" is larger than the 2 MB a definition may be.`,
          },
        ],
  );
  if (oversized.length) return failure("too_large", oversized[0]!.message, oversized);
  const offender = exportSizeOffender(document);
  if (offender !== undefined)
    return failure("too_large", "The file would be larger than the 16 MiB an import accepts.", [
      {
        code: "document_too_large",
        path: "document",
        message: `The bundle containing "${offender}" would exceed the 16 MiB file limit.`,
      },
    ]);
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

function instructionsFor(
  flow: PortableFlow,
  agents: ReadonlyMap<string, PortableAgent>,
): ImportReviewInstruction[] {
  const instructions: ImportReviewInstruction[] = [];
  for (const block of flow.graph.blocks) {
    const placement = { blockId: block.id, blockName: block.name };
    if (block.kind === "continuation")
      instructions.push({ ...placement, kind: "continuation", length: block.prompt.length });
    if (block.kind !== "agent") continue;
    const agent = block.agentKey === null ? undefined : agents.get(block.agentKey);
    if (agent)
      instructions.push({
        ...placement,
        kind: "agent",
        agentName: agent.name,
        length: agent.prompt.length,
      });
    if (block.revisitInstruction.length > 0)
      instructions.push({ ...placement, kind: "revisit", length: block.revisitInstruction.length });
  }
  return instructions;
}

function flowReviewNames(flows: readonly PortableFlowEntry[]) {
  const counts = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const used = new Set(flows.map(({ name }) => name));
  for (const { name } of flows) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(
    flows.map(({ key, name }) => {
      const number = (occurrences.get(name) ?? 0) + 1;
      occurrences.set(name, number);
      if (counts.get(name) === 1) return [key, name];
      let label = `${name} (${number})`;
      while (used.has(label)) label += ` [${key}]`;
      used.add(label);
      return [key, label];
    }),
  );
}

function flowUses(flows: readonly PortableFlowEntry[], names: ReadonlyMap<string, string>) {
  const uses = new Map<string, { flowName: string; blockName: string }[]>();
  const self = new Set<string>();
  for (const flow of flows) {
    for (const block of flow.graph.blocks) {
      if (block.kind !== "subflow" || block.flowKey === null) continue;
      const placements = uses.get(block.flowKey) ?? [];
      placements.push({ flowName: names.get(flow.key)!, blockName: block.name });
      uses.set(block.flowKey, placements);
      if (block.flowKey === flow.key) self.add(flow.key);
    }
  }
  return { uses, self };
}

function reviewFlows(document: ImportedDocument): ImportReviewFlow[] {
  if (document.kind === "agent") return [];
  const agents = new Map(document.agents.map((agent) => [agent.key, agent]));
  if (document.formatVersion !== 5) {
    const { flow } = document;
    return [
      {
        key: null,
        name: flow.name,
        opensAfterImport: true,
        blockCount: flow.graph.blocks.length,
        workspace: flow.workspace,
        uses: [],
        usesItself: false,
        instructions: instructionsFor(flow, agents),
      },
    ];
  }
  const { flows, rootFlowKey } = document;
  const names = flowReviewNames(flows);
  const { uses, self } = flowUses(flows, names);
  const rows = flows.map((flow): ImportReviewFlow => ({
    key: flow.key,
    name: names.get(flow.key)!,
    opensAfterImport: flow.key === rootFlowKey,
    blockCount: flow.graph.blocks.length,
    workspace: flow.workspace,
    uses: uses.get(flow.key) ?? [],
    usesItself: self.has(flow.key),
    instructions: instructionsFor(flow, agents),
  }));
  return [
    rows.find((row) => row.opensAfterImport)!,
    ...rows.filter((row) => !row.opensAfterImport),
  ];
}

/** What an import would create, with each Agent's model proposal from the catalog read here. */
export function importReview(
  document: ImportedDocument,
  capabilities: AgentCapabilities,
): ImportReview {
  return {
    kind: document.kind,
    flows: reviewFlows(document),
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
