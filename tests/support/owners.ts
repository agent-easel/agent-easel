import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition, FlowDraft, Result } from "../../packages/contracts/src/index.ts";
import { listAgentDefinitions } from "./agents.ts";

const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

async function call<T>(baseUrl: string | undefined, path: string, init?: RequestInit) {
  const result = (await (await fetch(new URL(path, baseUrl), init)).json()) as Result<T>;
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

export const listFlows = (baseUrl: string | undefined) => call<FlowDraft[]>(baseUrl, "/api/flows");

/** A seeded Flow of the fixture's ownership set, such as "Northwind release" or "Docs refresh". */
export async function ownedFlow(baseUrl: string | undefined, name: string) {
  const flow = (await listFlows(baseUrl)).find((entry) => entry.name === name);
  assert(flow?.projectId, `${name} is a Project Flow`);
  return flow;
}

/** The seeded Agent named `name`. */
export async function namedAgent(baseUrl: string | undefined, name: string) {
  const agent = (await listAgentDefinitions(baseUrl)).find((entry) => entry.name === name);
  assert(agent, `${name} is seeded`);
  return agent;
}

/** Another client changes the Agent's owning Project through the public API. */
export const changeAgentOwnerElsewhere = (
  baseUrl: string | undefined,
  agent: AgentDefinition,
  projectId: string | null,
) =>
  call<AgentDefinition>(baseUrl, `/api/agents/${agent.id}/owner`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({ expectedProjectId: agent.projectId, projectId }),
  });

/** Another client changes the Flow's owning Project through the public API. */
export const changeFlowOwnerElsewhere = (
  baseUrl: string | undefined,
  flow: FlowDraft,
  projectId: string | null,
) =>
  call<FlowDraft>(baseUrl, `/api/flows/${flow.id}/owner`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({ expectedProjectId: flow.projectId, projectId }),
  });

/** A Flow owned by `projectId` whose blocks place each of `agents`, in order. */
export async function projectFlowPlacing(
  baseUrl: string | undefined,
  name: string,
  projectId: string,
  agents: readonly AgentDefinition[],
) {
  const flow = await call<FlowDraft>(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({ name, projectId }),
  });
  const blocks = agents.map((agent, index) => ({
    id: `block-${index}`,
    name: agent.name,
    kind: "agent" as const,
    agentId: agent.id,
    position: { x: 320 + index * 280, y: 180 },
    hiddenExitIds: [],
    localExits: [],
    revisitInstruction: "",
  }));
  return call<FlowDraft>(baseUrl, `/api/flows/${flow.id}`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({
      name,
      expectedRevision: flow.revision,
      expectedProjectId: projectId,
      workspace: { mode: "checkout" },
      graph: {
        blocks,
        connections: [],
        flowInput: { position: { x: 40, y: 180 }, targetBlockIds: ["block-0"] },
      },
    }),
  });
}

/** Saves a saved Agent's or Flow's export document as a file Import can choose. */
export async function exportDefinitionFile(
  baseUrl: string | undefined,
  kind: "agent" | "flow",
  id: string,
) {
  const { document } = await call<{ document: unknown }>(baseUrl, `/api/${kind}s/${id}/export`);
  const directory = join(process.cwd(), ".e2e", "tmp");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${id}.${kind}.json`);
  await writeFile(path, JSON.stringify(document));
  return path;
}
