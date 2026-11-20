import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import { expect, type Screen } from "e2e";
import {
  DEFINITION_REQUEST_LIMIT_BYTES,
  definitionSaveFits,
  saveRequestBound,
} from "../../packages/domain-validation/src/index.ts";
import type {
  AgentDefinition,
  FlowDraft,
  FlowWorkspace,
  Result,
} from "../../packages/contracts/src/index.ts";

const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

/** Every Flow create the page sends is refused as unavailable; reads still reach Factory. */
export async function refuseFlowCreate(browser: Browser) {
  await browser.route("**/api/flows", async (route) => {
    if (route.request.method !== "POST") return route.continue();
    await route.fulfill({
      status: 503,
      json: { ok: false, error: { code: "validation", message: "Unavailable", issues: [] } },
    });
  });
}

async function flowRequest(baseUrl: string | undefined, path: string, init?: RequestInit) {
  const result = (await (await fetch(new URL(path, baseUrl), init)).json()) as Result<unknown>;
  assert(result.ok);
  return result.value;
}

/**
 * Saves a new Flow with a seeded Flow's graph and the given workspace setting, placing the saved
 * Agent `blockAgents[blockId]` in each listed Agent block.
 */
export async function saveFlowCopy(
  baseUrl: string | undefined,
  source: string,
  name: string,
  workspace: FlowWorkspace,
  blockAgents: Readonly<Record<string, string>> = {},
) {
  const flows = (await flowRequest(baseUrl, "/api/flows")) as FlowDraft[];
  const seeded = flows.find((flow) => flow.name === source);
  assert(seeded);
  const created = (await flowRequest(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({ name }),
  })) as FlowDraft;
  await flowRequest(baseUrl, `/api/flows/${created.id}`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({
      name,
      expectedRevision: 1,
      expectedProjectId: created.projectId,
      workspace,
      graph: {
        ...seeded.graph,
        blocks: seeded.graph.blocks.map((block) =>
          block.kind === "agent" && blockAgents[block.id]
            ? { ...block, agentId: blockAgents[block.id] }
            : block,
        ),
      },
    }),
  });
  return created.id;
}

/** Saves Flow `id` again under `name` with its graph unchanged, creating its next revision. */
export async function renameFlow(baseUrl: string | undefined, id: string, name: string) {
  const flow = (await flowRequest(baseUrl, `/api/flows/${id}`)) as FlowDraft;
  await saveFlowElsewhere(baseUrl, flow, { name });
}

/**
 * Saves a new checkout Flow whose input starts one block of the named saved Agent; with
 * `wiredExit`, that Agent exit hands over to a Human step named Review.
 */
export async function saveSingleAgentFlow(
  baseUrl: string | undefined,
  name: string,
  agentName: string,
  block: {
    readonly id: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly revisitInstruction?: string;
  },
  wiredExit?: string,
) {
  const review = { id: "review", kind: "human", name: "Review" };
  const agents = (await flowRequest(baseUrl, "/api/agents")) as AgentDefinition[];
  const agent = agents.find((item) => item.name === agentName);
  assert(agent);
  const created = (await flowRequest(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({
      name,
      workspace: { mode: "checkout" },
      graph: {
        flowInput: { position: { x: 40, y: 60 }, targetBlockIds: [block.id] },
        blocks: [
          {
            id: block.id,
            kind: "agent",
            name: block.name,
            agentId: agent.id,
            hiddenExitIds: [],
            localExits: [],
            revisitInstruction: block.revisitInstruction,
            position: { x: block.x, y: block.y },
          },
          ...(wiredExit ? [{ ...review, position: { x: block.x + 360, y: block.y } }] : []),
        ],
        connections: wiredExit
          ? [{ sourceBlockId: block.id, exitId: wiredExit, targetBlockId: review.id }]
          : [],
      },
    }),
  })) as FlowDraft;
  return created.id;
}

/**
 * Saves a new checkout Flow at the definition size limit: the Flow input starts one block of the
 * named saved Agent (`worker`, named Coder), whose `exitId` reaches Condition Escalate, and
 * Otherwise reaches Human step Review. With `wiring: "last"`, Escalate holds as many rules as a
 * save request carries 1,000 bytes under the limit, so a short rename still saves, and only its
 * last rule reaches Review: the Flow is not ready, since every Condition output needs a wire. With
 * `wiring: "every"`, every rule reaches Review, so the Flow is ready and the connection limit
 * bounds the rules, each padded to stay at the size limit. Rules are named `Route N`, have
 * ID-length IDs and strictly descending thresholds down to 2.
 */
export async function saveConditionAtSizeLimit(
  baseUrl: string | undefined,
  name: string,
  agentName: string,
  exitId: string,
  wiring: "last" | "every",
) {
  const agents = (await flowRequest(baseUrl, "/api/agents")) as AgentDefinition[];
  const agent = agents.find((item) => item.name === agentName);
  assert(agent);
  const condition = {
    id: "escalate",
    kind: "condition",
    name: "Escalate",
    position: { x: 380, y: 60 },
    rules: [] as { id: string; name: string; fromArrival: number }[],
    otherwise: { id: "otherwise" },
  };
  const graph = {
    flowInput: { position: { x: 40, y: 60 }, targetBlockIds: ["worker"] },
    blocks: [
      {
        id: "worker",
        kind: "agent",
        name: "Coder",
        agentId: agent.id,
        hiddenExitIds: [],
        localExits: [],
        revisitInstruction: "",
        position: { x: 80, y: 260 },
      },
      condition,
      { id: "review", kind: "human", name: "Review", position: { x: 720, y: 60 } },
    ],
    connections: [
      { sourceBlockId: "worker", exitId, targetBlockId: condition.id },
      { sourceBlockId: condition.id, exitId: "otherwise", targetBlockId: "review" },
    ],
  };
  const body = { name, workspace: { mode: "checkout" }, graph };
  const budget = DEFINITION_REQUEST_LIMIT_BYTES - 1_000;
  const withRules = (count: number, padding: number) => {
    condition.rules = Array.from({ length: count }, (_, index) => ({
      id: `rule-${String(index).padStart(31, "0")}`,
      name: `Route ${index + 1}${padding ? ` ${"·".repeat(padding)}` : ""}`,
      fromArrival: count - index + 1,
    }));
    const wired = wiring === "every" ? condition.rules : condition.rules.slice(-1);
    graph.connections.splice(
      2,
      Infinity,
      ...wired.map((rule) => ({
        sourceBlockId: condition.id,
        exitId: rule.id,
        targetBlockId: "review",
      })),
    );
    return saveBytes(body);
  };
  // The largest rule count, or with every rule wired the longest padding, that fits the budget.
  // The Agent's wire and Otherwise's take two of the connection limit.
  const fill =
    wiring === "every"
      ? (size: number) => withRules(CONNECTION_LIMIT - 2, size)
      : (size: number) => withRules(size, 0);
  let [fits, overflows] = wiring === "every" ? [0, 10_000] : [1, 100_000];
  while (overflows - fits > 1) {
    const size = Math.floor((fits + overflows) / 2);
    if (fill(size) <= budget) fits = size;
    else overflows = size;
  }
  const bytes = fill(fits);
  assert(definitionSaveFits(body) && bytes <= budget);
  const created = (await flowRequest(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify(body),
  })) as FlowDraft;
  return { id: created.id, rules: condition.rules, bytes };
}

/** Every Flow graph holds at most this many connections. */
const CONNECTION_LIMIT = 5000;

/** A save request's size, measured like `definitionSaveFits` at the largest revision and owner. */
const saveBytes = (body: object) =>
  new TextEncoder().encode(JSON.stringify(saveRequestBound(body))).byteLength;

/** The Flow is not ready, and its expanded readiness issues name the repairable cause. */
export async function expectFlowBlocked(screen: Screen, message: RegExp) {
  await screen.getByRole("button", /^Not ready/).tap();
  await expect(
    screen.getByRole("list", "Readiness issues").getByRole("button", message),
  ).toBeVisible();
}

/** Opens Studio on a wide canvas and creates the named Flow through New Flow. */
export async function createStudioFlow(
  app: { open(path: string): Promise<unknown> },
  screen: Screen,
  browser: { setViewport(size: { width: number; height: number }): Promise<unknown> },
  name: string,
) {
  await browser.setViewport({ width: 1920, height: 1000 });
  await app.open("/studio/flows");
  await screen.getByRole("button", "New Flow").tap();
  await screen.getByLabel("Flow name").fill(name);
  await screen.getByRole("button", "Create Flow").tap();
}

/** Removes a Flow through another client's public write boundary. */
export async function removeFlowElsewhere(baseUrl: string | undefined, id: string) {
  await flowRequest(baseUrl, `/api/flows/${id}`, { method: "DELETE", headers: mutation });
}

/** Reads the saved Flow through Factory's public API. */
export async function readFlow(baseUrl: string | undefined, id: string) {
  return (await flowRequest(baseUrl, `/api/flows/${id}`)) as FlowDraft;
}

/** Another client saves a complete Flow revision through the public HTTP boundary. */
export async function saveFlowElsewhere(
  baseUrl: string | undefined,
  flow: FlowDraft,
  change: Partial<Pick<FlowDraft, "name" | "graph" | "workspace">>,
) {
  return (await flowRequest(baseUrl, `/api/flows/${flow.id}`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({
      name: flow.name,
      graph: flow.graph,
      workspace: flow.workspace,
      expectedRevision: flow.revision,
      expectedProjectId: flow.projectId,
      ...change,
    }),
  })) as FlowDraft;
}

/** Another client places saved Agent `agentId` in Agent block `blockId` of Flow `id`. */
export async function placeAgentElsewhere(
  baseUrl: string | undefined,
  id: string,
  blockId: string,
  agentId: string,
) {
  const flow = await readFlow(baseUrl, id);
  const blocks = flow.graph.blocks.map((block) =>
    block.kind === "agent" && block.id === blockId ? { ...block, agentId } : block,
  );
  return saveFlowElsewhere(baseUrl, flow, { graph: { ...flow.graph, blocks } });
}
