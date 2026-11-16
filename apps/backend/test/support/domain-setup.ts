import {
  blockExit,
  controlledExecution,
  agentBlock,
  humanStep,
  waitBlock,
  WAIT_OUTPUT,
  connection,
  flowInput,
} from "./scenarios.ts";
import { runFactoryProcess } from "./factory-process.ts";
import { assert, type TestContext } from "@effect/vitest";
import { fileURLToPath } from "node:url";
import type { AgentDefinition, FlowGraph } from "@t3-factory/contracts";
import type { OwningProject } from "@t3-factory/domain-validation";
import { DatabaseSync } from "node:sqlite";
import { factoryHarness } from "./factory.ts";
import { ControlledT3 } from "./controlled-t3.ts";

/** A new Agent's single exit, as the Agent editor starts it. */
const doneExit = blockExit("done", "done", "", false);

/** A create input for an Agent owned by `projectId`, or a global one when omitted. */
export const sampleAgentInput = (name = "Coder", projectId: OwningProject = null) => ({
  name,
  prompt: "Improve the empty search state.\nUse $review-code when helpful.",
  execution: controlledExecution(),
  exits: [doneExit],
  projectId,
});

export async function openFactoryWithApprovedT3(context: TestContext) {
  const t3 = new ControlledT3();
  t3.approve();
  const harness = await factoryHarness(context);
  const factory = await harness.open({ t3 });
  assert((await factory.configureConnection({ endpoint: "http://127.0.0.1:3773/mcp" })).ok);
  assert((await factory.recheckConnection()).ok);
  return { harness, factory, t3 };
}

/** A saved Agent with T3 connected but its capability reads failing, and the reads sent so far. */
export async function savedAgentWhileCapabilitiesFail(context: TestContext) {
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  const saved = await factory.createAgent(sampleAgentInput());
  assert(saved.ok);
  t3.capabilitiesAvailable = false;
  return { factory, t3, agent: saved.value, capabilityReads: t3.capabilityReads };
}

export async function readAgentAfterRestart(
  harness: Awaited<ReturnType<typeof factoryHarness>>,
  agentId: string,
): Promise<{ ok: boolean; value: AgentDefinition }> {
  const child = await runFactoryProcess(
    [fileURLToPath(new URL("./agent-process.ts", import.meta.url)), harness.databasePath, agentId],
    harness.processHome,
  );
  return JSON.parse(child.stdout) as { ok: boolean; value: AgentDefinition };
}

export async function readFlowAfterRestart(
  harness: Awaited<ReturnType<typeof factoryHarness>>,
  flowId: string,
): Promise<unknown> {
  const child = await runFactoryProcess(
    [
      fileURLToPath(new URL("./operation-process.ts", import.meta.url)),
      harness.databasePath,
      flowId,
    ],
    harness.processHome,
  );
  return JSON.parse(child.stdout);
}

export function assertOk<A>(result: { ok: true; value: A } | { ok: false; error: unknown }): A {
  assert(result.ok);
  return result.value;
}

export async function flowWithAgent(context: TestContext) {
  const harness = await factoryHarness(context);
  const factory = await harness.open({ t3: new ControlledT3() });
  const created = await factory.createFlow({ name: "Change and review" });
  assert(created.ok);
  const agent = await factory.createAgent({
    name: "Coder",
    prompt: "Improve the empty search state",
    execution: {
      environmentId: "local",
      providerInstanceId: "codex",
      modelId: "model",
      modelOptions: [],
    },
    exits: [{ ...doneExit, description: "Work complete" }],
  });
  assert(agent.ok);
  const unconnectedGraph = {
    flowInput: flowInput(),
    blocks: [
      agentBlock("coder", "Coder", agent.value.id, { x: 20, y: 30 }, [], []),
      humanStep("human", "Review", { x: 400, y: 30 }),
    ],
    connections: [
      connection("coder", "done", "human"),
      connection("human", "request-changes", "coder"),
    ],
  };
  return { harness, factory, created, agent: agent.value, unconnectedGraph };
}

export const reviewerExits = [
  blockExit("pass", "pass", "The change is ready.", false),
  blockExit("fail", "fail", "Corrections are needed.", true),
];

/**
 * A saved, ready Flow: Coder hands its work to Code review, an Agent block of Reviewer whose
 * inherited `fail` exit returns to Coder. `save` replaces the graph's Code review block.
 */
export async function reviewedFlow(context: TestContext) {
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const reviewerInput = { ...sampleAgentInput("Reviewer"), exits: reviewerExits };
  const reviewer = assertOk(await factory.createAgent(reviewerInput));
  const created = assertOk(await factory.createFlow({ name: "Reviewed change" }));
  const position = { x: 0, y: 0 };
  const review = agentBlock("review", "Code review", reviewer.id, position, [], []);
  const graph = (block: typeof review) => ({
    flowInput: flowInput("coder"),
    blocks: [{ ...review, id: "coder", name: "Coder", agentId: coder.id }, block],
    connections: [connection("coder", "done", "review"), connection("review", "fail", "coder")],
  });
  let revision = created.revision;
  const save = async (block: typeof review) => {
    const saved = await factory.updateFlow(created.id, {
      name: created.name,
      expectedRevision: revision,
      expectedProjectId: created.projectId,
      workspace: created.workspace,
      graph: graph(block),
    });
    if (saved.ok) revision = saved.value.revision;
    return saved;
  };
  /** Saves Reviewer's next revision with `exits`. */
  const editReviewer = async (exits: readonly (typeof doneExit)[]) =>
    factory.updateAgent(reviewer.id, {
      ...reviewerInput,
      exits,
      expectedRevision: assertOk(await factory.getAgent(reviewer.id)).revision,
      expectedProjectId: reviewer.projectId,
    });
  return { factory, flowId: created.id, reviewer, review, save, editReviewer };
}

/** Factory connected to a T3 that lists two independent clones of one repository. */
export async function projectsHarness(context: TestContext) {
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.authorized = true;
  t3.projects = [
    { projectId: "one", title: "First clone", workspaceRoot: "/repos/one", available: true },
    {
      projectId: "clone",
      title: "Second clone",
      workspaceRoot: "/repos/clone",
      available: true,
    },
  ];
  const factory = await harness.open({ t3 });
  assertOk(await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" }));
  return { harness, factory, t3 };
}

/** `projectsHarness` with both clones discovered as available Factory Projects. */
export async function discoveredClones(context: TestContext) {
  const setup = await projectsHarness(context);
  const [first, second] = assertOk(await setup.factory.recheckProjects()).projects;
  return { ...setup, first: first!, second: second! };
}

/**
 * A Flow of the first of `discoveredClones` whose Build and Fix blocks place Coder, a global
 * Agent, whose Release block places Releaser, an Agent of that Project, and whose Audit block names
 * an Agent that does not exist.
 */
export async function projectFlowToDuplicate(context: TestContext) {
  const clones = await discoveredClones(context);
  const { factory, first } = clones;
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const releaser = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const flow = assertOk(
    await factory.createFlow({
      name: "Release",
      projectId: first.id,
      graph: {
        flowInput: flowInput("build"),
        blocks: [
          agentBlock("build", "Build", coder.id),
          agentBlock("release", "Release", releaser.id, { x: 300, y: 0 }),
          agentBlock("fix", "Fix", coder.id, { x: 600, y: 0 }),
          agentBlock("audit", "Audit", "missing-agent", { x: 900, y: 0 }),
        ],
        connections: [connection("build", "done", "release"), connection("release", "done", "fix")],
      },
    }),
  );
  return { ...clones, coder, releaser, flow };
}

/**
 * Sets a Flow's or Agent's owning Project in the open backend's storage without a revision or any
 * placement check. Change owner refuses the out-of-rule owners this produces, so it stands in only
 * for stored states no public operation can reach.
 */
export function ownerChangedInStorage(
  databasePath: string,
  definition: { readonly kind: "flow" | "agent"; readonly id: string },
  projectId: OwningProject,
) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  const table = definition.kind === "flow" ? "flows" : "agents";
  database.prepare(`UPDATE ${table} SET project_id=? WHERE id=?`).run(projectId, definition.id);
  database.close();
}

export async function uncertainProjectCreation(context: TestContext) {
  const p = await projectsHarness(context);
  p.t3.projects = [];
  const create = p.t3.createProject.bind(p.t3);
  p.t3.createProject = async (...args) => {
    await create(...args);
    throw new Error("Lost response with private content");
  };
  assert(!(await p.factory.addRepository({ path: "/repos/uncertain" })).ok);
  return p;
}

export async function validationFlow(context: TestContext) {
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });
  const created = await factory.createFlow({ name: "Validation" });
  assert(created.ok);
  const block = agentBlock(
    "a",
    "Worker",
    "missing-agent",
    { x: 0, y: 0 },
    [],
    [blockExit("e", "fail", "", false)],
  );
  return { factory, created, block };
}

/**
 * A Flow draft whose saved Coder hands "done" to a Wait of `duration` that forwards to Review, a
 * Human step; `save` replaces the Wait's configuration and the Flow input targets.
 */
export async function waitDraft(context: TestContext) {
  const { harness, factory, created, agent } = await flowWithAgent(context);
  const graph = (wait: ReturnType<typeof waitBlock>, targets: readonly string[] = ["coder"]) => ({
    flowInput: flowInput(...targets),
    blocks: [
      agentBlock("coder", "Coder", agent.id, { x: 0, y: 0 }, [], []),
      wait,
      humanStep("human", "Review", { x: 800, y: 0 }),
    ],
    connections: [connection("coder", "done", "pause"), connection("pause", WAIT_OUTPUT, "human")],
  });
  const save = (wait: ReturnType<typeof waitBlock>, targets?: readonly string[]) =>
    factory.updateFlow(created.value.id, {
      name: created.value.name,
      expectedRevision: created.value.revision,
      expectedProjectId: created.value.projectId,
      workspace: created.value.workspace,
      graph: graph(wait, targets),
    });
  const pause = (duration: Parameters<typeof waitBlock>[2]) =>
    waitBlock("pause", "Cool down", duration, { x: 400, y: 0 });
  return { harness, factory, agent, flowId: created.value.id, pause, save };
}

/** A saved Flow with an Agent and a Human step, whose graph a test replaces around a Condition. */
export async function conditionDraft(context: TestContext) {
  const { harness, factory, created, agent } = await flowWithAgent(context);
  const save = (graph: Omit<FlowGraph, "flowInput">, targets: readonly string[] = ["coder"]) =>
    factory.updateFlow(created.value.id, {
      name: created.value.name,
      expectedRevision: created.value.revision,
      expectedProjectId: created.value.projectId,
      workspace: created.value.workspace,
      graph: { flowInput: flowInput(...targets), ...graph },
    });
  const coder = agentBlock("coder", "Coder", agent.id, { x: 0, y: 0 }, [], []);
  const review = humanStep("human", "Review", { x: 800, y: 0 });
  return { harness, factory, agent, flowId: created.value.id, coder, review, save };
}
