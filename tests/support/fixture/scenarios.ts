import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  blockExit,
  flowInput,
  controlledExecution,
  agentBlock,
  resultHeld,
  resultReported,
  resultReleasedToSecondWorker,
  resultReleasedToTwoWorkers,
  resultReleasedToWait,
  connection,
  waitBlock,
  workingReported,
  report,
  workingReport,
  replyTurnObserved,
  settled,
  workerAtWork,
  workerHandle,
  generatedTitleApplied,
} from "../../../apps/backend/test/support/scenarios.ts";
import type { RunDetail } from "../../../packages/contracts/src/index.ts";
import { effectiveExits } from "../../../packages/domain-validation/src/index.ts";
import { seedScenarios, settlementUnresolved } from "../../../scripts/dev/seed.ts";
import { requireSuccess, demoStart, type SeedContext } from "../../../scripts/dev/seed-support.ts";
import type { PersistentT3 } from "../../../scripts/dev/persistent-t3.ts";
import type { Host } from "./host.ts";

type Context = SeedContext;

const workerOf = (context: Context, run: RunDetail) => workerHandle(context, run, "worker");
const exitOf = (run: RunDetail) => {
  const block = run.definitions.flow.graph.blocks.find((item) => item.id === "worker");
  assert(block);
  const exits = effectiveExits(block, run.definitions.agents);
  assert.equal(exits.length, 1, "Journey worker must have one exit");
  return exits[0]!.id;
};

/** Only the named module states current journeys use are exposed. */
function runTransitions(context: Context) {
  // Named, so fallow resolves the held-Stop calls below to PersistentT3's members.
  const t3: PersistentT3 = context.t3;
  return {
    "result held": (run: RunDetail, message?: string) =>
      resultHeld(context, workerOf(context, run), {
        exit: exitOf(run),
        ...(message === undefined ? {} : { message }),
      }),
    "result reported": (run: RunDetail, message?: string) =>
      resultReported(context, workerOf(context, run), {
        exit: exitOf(run),
        ...(message === undefined ? {} : { message }),
      }),
    "result released to a second worker": (run: RunDetail) =>
      resultReleasedToSecondWorker(context, workerOf(context, run)),
    "result released to two workers": (run: RunDetail) =>
      resultReleasedToTwoWorkers(context, workerOf(context, run)),
    "late working report": (run: RunDetail, message?: string) =>
      report(context, workerOf(context, run), workingReport(message)),
    "result released to a Wait": (run: RunDetail) =>
      resultReleasedToWait(context, workerOf(context, run)),
    "working reported": (run: RunDetail, message?: string) =>
      workingReported(context, workerOf(context, run), message),
    "reply turn observed": (run: RunDetail) =>
      replyTurnObserved(context, workerOf(context, run), "ui-worker-reply"),
    settled: (run: RunDetail) => settled(context, workerOf(context, run)),
    "settlement unresolved": (run: RunDetail) =>
      settlementUnresolved(context, workerOf(context, run)),
    "generated title applied": (run: RunDetail, title?: string) => {
      assert(title, "The generated title is required");
      return generatedTitleApplied(context, run.id, title);
    },
    "Stop taken while the turn continues": (run: RunDetail) =>
      t3.holdStops(run.threadBindings.map((binding) => binding.threadId)),
    "stopped turns ended": (run: RunDetail) =>
      t3.finishHeldStops(run.threadBindings.map((binding) => binding.threadId)),
  };
}

/** A Run state a journey applies to an existing Run. */
export type FixtureState = keyof ReturnType<typeof runTransitions>;

/** Flows, Agents, repositories and provider models only UI journeys use. */
async function createFixtureDefinitions({ factory, t3, home, server }: Host) {
  // A one-minute Wait lets the Wait journey observe a real forwarding without a long Run.
  const engineer = requireSuccess(await factory.listAgents()).find(
    (agent) => agent.name === "Demo · Product engineer",
  )!;
  const pauseFlow = requireSuccess(await factory.createFlow({ name: "UI wait · Pause a minute" }));
  requireSuccess(
    await factory.updateFlow(pauseFlow.id, {
      name: pauseFlow.name,
      expectedRevision: pauseFlow.revision,
      workspace: { mode: "checkout" },
      graph: {
        flowInput: flowInput("worker"),
        blocks: [
          agentBlock("worker", "Implement change", engineer.id, { x: 320, y: 180 }, [], []),
          waitBlock("pause", "Pause a minute", { amount: 1, unit: "minutes" }, { x: 700, y: 180 }),
        ],
        connections: [connection("worker", "review", "pause")],
      },
    }),
  );

  // Exercise published defaults and mixed value domains through the Agent editor.
  t3.controlledProviders[0] = {
    ...t3.controlledProviders[0]!,
    models: [
      {
        ...t3.controlledProviders[0]!.models[0]!,
        options: [
          {
            id: "reasoning",
            label: "Reasoning effort",
            type: "select",
            choices: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
            default: "high",
          },
          {
            id: "mixed",
            label: "Mixed mode",
            type: "select",
            values: [false, "auto"],
            default: "auto",
          },
          { id: "fast", label: "Fast mode", type: "boolean", values: [true, false], default: true },
        ],
      },
    ],
  };
  // A second discovered model gives Studio settings a real choice of models.
  t3.controlledProviders[0] = {
    ...t3.controlledProviders[0],
    models: [
      ...t3.controlledProviders[0].models,
      {
        ...t3.controlledProviders[0].models[0],
        id: "gpt-6-astra",
        label: "GPT 6 Astra",
      },
    ],
  };
  const response = await fetch(`http://127.0.0.1:${server.address.port}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: JSON.stringify({
      name: "Sample worker",
      prompt: "Improve the empty search state",
      execution: controlledExecution(t3.environmentId, { modelOptions: [] }),
      exits: [
        blockExit("finish", "finish", "", false),
        blockExit("ok", "ok", "The work passes review.", false),
        blockExit("fail", "fail", "Corrections are needed.", true),
      ],
    }),
  });
  if (!response.ok) throw new Error("Could not seed saved Agent definition");
  // Runtime UI uses only this disposable repository and controlled engine.
  const neutral = join(home, "neutral-repository");
  await mkdir(join(neutral, ".codex"), { recursive: true });
  await promisify(execFile)("git", ["init", neutral], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
  });
  await writeFile(
    join(neutral, ".codex/config.toml"),
    '# preserved runtime fixture\nmodel = "existing"\n',
  );
  const runtimeProject = await factory.addRepository({ path: neutral });
  const doneExit = blockExit("done", "Done", "Complete", false);
  const agent = await factory.createAgent({
    name: "Runtime worker",
    prompt: "Neutral integration fixture",
    execution: controlledExecution(t3.environmentId, { modelOptions: [] }),
    exits: [doneExit],
  });
  if (!runtimeProject.ok || !agent.ok) throw Error("Could not seed runtime fixture");
  // Exercise repository favicons through the actual public binary endpoint.
  await writeFile(
    join(neutral, "project-icon.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNITvv4H4QZYAwAXVgK5Y3ks1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  t3.projects = t3.projects.map((entry) =>
    entry.projectId === runtimeProject.value.projectId
      ? { ...entry, faviconPath: "project-icon.png" }
      : entry,
  );
  if (!(await factory.recheckProjects()).ok) throw Error("Could not seed project favicon");
  // Separate launch fixture so runtime-setup tests retain their unvalidated selection.
  const launchRoot = join(home, "neutral-launch");
  await mkdir(launchRoot);
  await promisify(execFile)("git", ["init", launchRoot], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
  });
  const launchProject = await factory.addRepository({ path: launchRoot });
  if (!launchProject.ok) throw Error("Launch project unavailable");
  const launchAgent = await factory.createAgent({
    name: "Launch worker",
    prompt: "Neutral launch work",
    execution: controlledExecution(t3.environmentId, { modelOptions: [] }),
    exits: [doneExit],
  });
  if (!launchAgent.ok) throw Error("Launch Agent unavailable");
  await factory.createFlow({ name: "Launch blocked draft" });
  const launchFlow = await factory.createFlow({ name: "Launch ready Flow" });
  if (!launchFlow.ok) throw Error("Launch Flow unavailable");
  await factory.updateFlow(launchFlow.value.id, {
    name: launchFlow.value.name,
    expectedRevision: 1,
    workspace: { mode: "checkout" },
    graph: {
      flowInput: flowInput("worker"),
      blocks: [agentBlock("worker", "Entry worker", launchAgent.value.id, { x: 0, y: 0 }, [], [])],
      connections: [],
    },
  });
  if (!(await factory.createFlow({ name: "Shared remote plan" })).ok)
    throw new Error("Could not seed the shared Flow");
}

/** Seeded scenario Runs, keyed journey Runs and the Run states journeys apply to them. */
export async function scenariosFixture(host: Host) {
  const { factory, context } = host;
  await createFixtureDefinitions(host);
  const flows = requireSuccess(await factory.listFlows());
  const transitions = runTransitions(context);

  /** Journey keys are scoped to this fixture; the Flow is fixed when the key is first used. */
  const journeyRuns = new Map<string, { id: string; flow: string }>();
  async function ensureRun(
    key: string,
    flowName: string,
    title = `Demo · Live ${key} · Tidy the project picker`,
    prompt = "Tidy the spacing of the Atlas project picker.",
  ) {
    const known = journeyRuns.get(key);
    if (known) {
      assert.equal(known.flow, flowName, `Journey ${key} already uses another Flow`);
      return known.id;
    }
    const flow = requireSuccess(await factory.listFlows()).find((item) => item.name === flowName);
    assert(flow, `Unknown journey Flow ${flowName}`);
    const worker = await workerAtWork(
      context,
      await demoStart(context, flow.id, key, title, prompt, undefined, {
        titlePrefix: "",
        keyNamespace: "ui-live:",
      }),
    );
    journeyRuns.set(key, { id: worker.runId, flow: flowName });
    return worker.runId;
  }

  const review = flows.find((f) => f.name === "Demo · Build, review and decide")!;
  let workerRuns: Promise<Map<string, string>> | undefined;
  async function prepareWorkerRuns() {
    // Authorization journeys retire earlier contexts; this suite owns a fresh scenario copy.
    const flow = (name: string) => flows.find((item) => item.name === name)!.id;
    const runs = await seedScenarios(
      context,
      {
        simple: flow("Demo · Focused change"),
        review: review.id,
        parallel: flow("Demo · Parallel review"),
        parallelStart: flow("Demo · Parallel review from one prompt"),
        worktree: flow("Demo · Build and review in a worktree"),
        wait: flow("Demo · Build, cool down and review"),
        parallelWait: flow("Demo · Parallel review held for the sync"),
        continuation: flow("Demo · Grill, spec and tickets"),
        humanWait: flow("Demo · Approve, then hold for release"),
      },
      { titlePrefix: "UI worker · ", keyNamespace: "ui-worker:development-v1:" },
    );
    runs.set(
      "report-release",
      await ensureRun(
        "report-release",
        review.name,
        "UI worker · UI worker report release",
        "Implement the project picker change.",
      ),
    );
    return runs;
  }

  return {
    actions: {
      async prepare() {
        return Object.fromEntries(await (workerRuns ??= prepareWorkerRuns()));
      },
      /** Starts `key` once, in the named Flow and current authorization context. */
      async ensure({ key, flow }: { key: string; flow: string }) {
        return { id: await ensureRun(key, flow) };
      },
      /** Applies exactly the named Run state to the Run `id` or journey `key`. */
      async transition(
        input: { state: FixtureState; message?: string } & ({ id: string } | { key: string }),
      ) {
        assert(Object.hasOwn(transitions, input.state), `Unknown Run state ${input.state}`);
        const id = "id" in input ? input.id : journeyRuns.get(input.key)?.id;
        assert(id, "An existing Run id or journey key is required");
        const run = requireSuccess(await factory.getRun(id));
        const outcome = await transitions[input.state](run, input.message);
        return { outcome };
      },
    },
    reset() {},
    /** Starts one Run of the named seeded Flow and waits until its worker is at work. */
    async startRun(flowName: string, key: string, title: string) {
      const flow = flows.find((item) => item.name === flowName)!;
      return workerAtWork(
        context,
        await demoStart(
          context,
          flow.id,
          key,
          title,
          "Tidy the spacing of the Atlas project picker.",
          undefined,
          {
            titlePrefix: "",
            keyNamespace: "ui-live:",
          },
        ),
      );
    },
  };
}
