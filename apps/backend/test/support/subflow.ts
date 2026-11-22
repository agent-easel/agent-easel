import { assert, type TestContext } from "@effect/vitest";
import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type CreateFlowInput,
  type EndingOutput,
  type FlowGraphInput,
} from "@t3-factory/contracts";
import type { OwningProject } from "@t3-factory/domain-validation";
import type { Factory } from "../../src/index.ts";
import { assertOk, discoveredClones, sampleAgentInput } from "./domain-setup.ts";
import { agentBlock, connection, flowInput, launchedWorkers } from "./scenarios.ts";
import { prepared } from "./prepared-runner.ts";

export async function parallelReleasePanel(context: TestContext) {
  const setup = await prepared(context);
  const { f, input, agent, world } = setup;
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: {
      flowInput: flowInput("panel"),
      blocks: [
        subflowBlock("panel", "Review panel", child.id),
        agentBlock("notes", "Release notes", agent.id, { x: 400, y: 0 }),
      ],
      connections: [connection("panel", "approved", "notes"), toEnding("notes", "done", "done")],
      finish: { position: { x: 800, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [security, style],
  } = await launchedWorkers(world, started.id);
  const reply = await f.runtime.submit({
    arguments: { blockId: style!.blockId, to: "finished", exit: "done", message: "Style done" },
  });
  assert(reply.code === "ACCEPTED");
  return { ...setup, runId: started.id, security: security!, style: style! };
}

export function loseStopReplyAfterInterrupt(
  t3: Awaited<ReturnType<typeof prepared>>["t3"],
  onInterrupt: () => void,
) {
  const original = t3.threads.stopThread.bind(t3.threads);
  t3.threads.stopThread = async (target, payload) => {
    await original(target, payload);
    onInterrupt();
    throw Error("Lost Stop reply after remote interruption");
  };
}

export function omitRecentRunsOnActiveRead(
  t3: Awaited<ReturnType<typeof prepared>>["t3"],
  threadId: string,
) {
  const original = t3.threads.readExecution.bind(t3.threads);
  t3.threads.readExecution = async (target, id) => {
    const read = await original(target, id);
    if (id !== threadId || !read.activeRunId) return read;
    return { ...read, recentRuns: [] };
  };
}

export async function parallelFinish(context: TestContext) {
  const setup = await prepared(context);
  const { f, input, agent, world } = setup;
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const graph = placingGraph(child.id);
  const parent = await savedFlow(f, {
    name: "Parallel Finish",
    graph: {
      ...graph,
      flowInput: flowInput("root", "inner-0"),
      blocks: [agentBlock("root", "Root worker", agent.id), ...graph.blocks],
      connections: [toEnding("root", "done", "done")],
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [root, inner],
  } = await launchedWorkers(world, started.id);
  return { ...setup, runId: started.id, root: root!, inner: inner! };
}

type Position = { readonly x: number; readonly y: number };

export const subflowBlock = (
  id: string,
  name: string,
  flowId: string | null,
  position: Position = { x: 0, y: 0 },
) => ({ id, name, kind: "subflow" as const, flowId, position });

export const ending = (id: string, name: string, output: EndingOutput = "optional") => ({
  id,
  name,
  description: "",
  output,
  outputDescription: "",
});

export const toEnding = (sourceBlockId: string, exitId: string, endingId: string) => ({
  sourceBlockId,
  exitId,
  targetBlockId: FINISH_BLOCK_ID,
  targetEndingId: endingId,
});

export const reviewPanelGraph = (reviewerId: string): FlowGraphInput => ({
  flowInput: flowInput("security", "style"),
  blocks: [
    agentBlock("security", "Security reviewer", reviewerId, { x: 200, y: 0 }),
    agentBlock("style", "Style reviewer", reviewerId, { x: 200, y: 200 }),
  ],
  connections: [
    toEnding("security", "done", "approved"),
    toEnding("style", "done", "needs-changes"),
  ],
  finish: {
    position: { x: 500, y: 0 },
    endings: [ending("approved", "Approved"), ending("needs-changes", "Needs changes", "none")],
  },
});

export const releaseGraph = (coderId: string, childId: string | null): FlowGraphInput => ({
  flowInput: flowInput("coder"),
  blocks: [
    agentBlock("coder", "Coder", coderId),
    subflowBlock("review", "Review", childId, { x: 300, y: 0 }),
    agentBlock("notes", "Release notes", coderId, { x: 600, y: 0 }),
  ],
  connections: [
    connection("coder", "done", "review"),
    connection("review", "approved", "notes"),
    toEnding("review", "needs-changes", "returned"),
  ],
  finish: { position: { x: 900, y: 0 }, endings: [ending("returned", "Returned", "none")] },
});

export const placingGraph = (...flowIds: (string | null)[]): FlowGraphInput => ({
  flowInput: flowInput("inner-0"),
  blocks: flowIds.map((flowId, i) =>
    subflowBlock(`inner-${i}`, `Inner ${i}`, flowId, { x: 300 * i, y: 0 }),
  ),
  connections: [
    ...flowIds.slice(1).map((_, i) => connection(`inner-${i}`, "done", `inner-${i + 1}`)),
    toEnding(`inner-${flowIds.length - 1}`, "done", "done"),
  ],
  finish: { position: { x: 300 * flowIds.length, y: 0 }, endings: [ending("done", "Done")] },
});

export async function heavyWriters(factory: Factory, prompt: string): Promise<AgentDefinition[]> {
  const writers: AgentDefinition[] = [];
  for (let i = 0; i < 190; i++)
    writers.push(
      assertOk(
        await factory.createAgent({
          ...sampleAgentInput(i === 0 ? "Lead writer" : `Writer ${i}`),
          prompt,
        }),
      ),
    );
  return writers;
}

export async function savedFlow(factory: Pick<Factory, "createFlow">, input: CreateFlowInput) {
  return assertOk(await factory.createFlow(input));
}

export async function resave(factory: Factory, flowId: string, graph: FlowGraphInput) {
  const flow = assertOk(await factory.getFlow(flowId));
  return factory.updateFlow(flowId, {
    name: flow.name,
    expectedRevision: flow.revision,
    expectedProjectId: flow.projectId,
    workspace: flow.workspace,
    graph,
  });
}

export async function composition(context: TestContext) {
  const clones = await discoveredClones(context);
  const { factory } = clones;
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const reviewer = assertOk(await factory.createAgent(sampleAgentInput("Reviewer")));
  const child = await savedFlow(factory, {
    name: "Review panel",
    graph: reviewPanelGraph(reviewer.id),
  });
  const parent = await savedFlow(factory, {
    name: "Release",
    graph: releaseGraph(coder.id, child.id),
  });
  const endingFlow = (name: string, projectId: OwningProject, graph?: FlowGraphInput) =>
    savedFlow(factory, {
      name,
      projectId,
      graph: graph ?? {
        flowInput: flowInput("work"),
        blocks: [agentBlock("work", "Work", coder.id)],
        connections: [toEnding("work", "done", "done")],
        finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
      },
    });
  const placing = (name: string, projectId: OwningProject, ...flowIds: (string | null)[]) =>
    savedFlow(factory, { name, projectId, graph: placingGraph(...flowIds) });
  const diamond = async (levels: number) => {
    const flows = [await endingFlow("Level 0", null)];
    for (let k = 1; k <= levels; k++)
      flows.push(await placing(`Level ${k}`, null, flows[k - 1]!.id, flows[k - 1]!.id));
    return flows;
  };
  assert(parent.readiness.ready, JSON.stringify(parent.readiness.issues));
  return { ...clones, coder, reviewer, child, parent, endingFlow, placing, diamond };
}

export const placedFlowIds = (blocks: readonly FlowGraphInput["blocks"][number][]) =>
  blocks.map((block) => (block.kind === "subflow" ? block.flowId : null));

export const sortedClosureDefinitions = <T extends { readonly kind: string; readonly id: string }>(
  entries: readonly T[],
) => [...entries].sort((a, b) => (`${a.kind}:${a.id}` < `${b.kind}:${b.id}` ? -1 : 1));

export async function projectComposition(context: TestContext) {
  const setup = await composition(context);
  const { factory, first, coder, endingFlow, placing } = setup;
  const releaser = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const shared = await endingFlow("Shared review", null);
  const leaf = await endingFlow("Project leaf", first.id, {
    flowInput: flowInput("work"),
    blocks: [
      agentBlock("work", "Work", coder.id),
      agentBlock("release", "Release", releaser.id, { x: 300, y: 0 }),
    ],
    connections: [connection("work", "done", "release"), toEnding("release", "done", "done")],
    finish: { position: { x: 600, y: 0 }, endings: [ending("done", "Done")] },
  });
  const middle = await placing("Project middle", first.id, leaf.id);
  const root = await placing("Project root", first.id, middle.id, shared.id);
  assertOk(await resave(factory, middle.id, placingGraph(leaf.id, root.id)));
  return { ...setup, releaser, shared, leaf, middle, root };
}
