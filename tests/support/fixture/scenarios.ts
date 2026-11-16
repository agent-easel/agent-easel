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
  observeFor,
} from "../../../apps/backend/test/support/scenarios.ts";
import type { RunDetail } from "../../../packages/contracts/src/index.ts";
import { effectiveExits } from "../../../packages/domain-validation/src/index.ts";
import { seedScenario, settlementUnresolved } from "../../../scripts/dev/seed.ts";
import { saveFlow } from "../../../scripts/dev/seed-flows.ts";
import { seedScenarioList, type DemoFlows } from "../../../scripts/dev/seed-scenarios.ts";
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

/**
 * From the worker at work on a Flow whose one Condition returns its selections to the worker: the
 * worker reports `Pass N.` as the Condition's next arrival, and is back at work on its next turn,
 * until the Condition has numbered `through` arrivals. The last of them may select an output that
 * does not return to the worker.
 */
async function conditionArrivalsThrough(context: Context, id: string, through: number) {
  let run = requireSuccess(await context.factory.getRun(id));
  const conditions = run.definitions.flow.graph.blocks.filter(
    (block) => block.kind === "condition",
  );
  assert.equal(conditions.length, 1, "The journey Flow must have one Condition");
  const condition = conditions[0]!.id;
  const numbered = (detail: RunDetail) =>
    detail.conditions.find((summary) => summary.blockId === condition)?.arrivals ?? 0;
  const returnsToWorker = (detail: RunDetail) => {
    const latest = detail.conditions.find((summary) => summary.blockId === condition)?.latest;
    return detail.definitions.flow.graph.connections.some(
      (wire) =>
        wire.sourceBlockId === condition &&
        wire.exitId === latest?.outputId &&
        wire.targetBlockId === "worker",
    );
  };
  while (numbered(run) < through) {
    const arrival = numbered(run) + 1;
    const worker = workerOf(context, run);
    await resultReported(context, worker, { exit: exitOf(run), message: `Pass ${arrival}.` });
    run = await observeFor(`number arrival ${arrival}`, context, id, (detail) => {
      if (numbered(detail) !== arrival) return false;
      if (arrival === through && !returnsToWorker(detail)) return true;
      const block = detail.blocks.find((item) => item.blockId === "worker");
      return (
        block?.executionId !== worker.executionId &&
        block?.state === "working" &&
        block.freshness === "fresh"
      );
    });
  }
  assert.equal(numbered(run), through, `The Condition already numbered past ${through}`);
}

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

/**
 * The fixture scenario set: Flows, Agents, repositories and provider models only UI journeys use,
 * built like the development seed's. Answers its ready Flows by key.
 */
async function createFixtureScenarioSet({ factory, t3, home, world }: Host) {
  // A one-minute Wait lets the Wait journey observe a real forwarding without a long Run.
  const pause = await saveFlow(factory, "UI wait · Pause a minute", {
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Implement change", world.agents.worker, { x: 320, y: 180 }, [], []),
      waitBlock("pause", "Pause a minute", { amount: 1, unit: "minutes" }, { x: 700, y: 180 }),
    ],
    connections: [connection("worker", "review", "pause")],
  });

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
  const unselectedModelOptions = controlledExecution(t3.environmentId, { modelOptions: [] });
  requireSuccess(
    await factory.createAgent({
      name: "Sample worker",
      prompt: "Improve the empty search state",
      execution: unselectedModelOptions,
      exits: [
        blockExit("finish", "finish", "", false),
        blockExit("ok", "ok", "The work passes review.", false),
        blockExit("fail", "fail", "Corrections are needed.", true),
      ],
    }),
  );
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
  const runtimeProject = requireSuccess(await factory.addRepository({ path: neutral }));
  const doneExit = blockExit("done", "Done", "Complete", false);
  requireSuccess(
    await factory.createAgent({
      name: "Runtime worker",
      prompt: "Neutral integration fixture",
      execution: unselectedModelOptions,
      exits: [doneExit],
    }),
  );
  // Exercise repository favicons through the actual public binary endpoint.
  await writeFile(
    join(neutral, "project-icon.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNITvv4H4QZYAwAXVgK5Y3ks1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  t3.projects = t3.projects.map((entry) =>
    entry.projectId === runtimeProject.projectId
      ? { ...entry, faviconPath: "project-icon.png" }
      : entry,
  );
  requireSuccess(await factory.recheckProjects());
  // Separate launch fixture so runtime-setup tests retain their unvalidated selection.
  const launchRoot = join(home, "neutral-launch");
  await mkdir(launchRoot);
  await promisify(execFile)("git", ["init", launchRoot], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
  });
  requireSuccess(await factory.addRepository({ path: launchRoot }));
  const launchAgent = requireSuccess(
    await factory.createAgent({
      name: "Launch worker",
      prompt: "Neutral launch work",
      execution: unselectedModelOptions,
      exits: [doneExit],
    }),
  );
  requireSuccess(await factory.createFlow({ name: "Launch blocked draft" }));
  const launch = await saveFlow(factory, "Launch ready Flow", {
    flowInput: flowInput("worker"),
    blocks: [agentBlock("worker", "Entry worker", launchAgent.id, { x: 0, y: 0 }, [], [])],
    connections: [],
  });
  requireSuccess(await factory.createFlow({ name: "Shared remote plan" }));
  return { pause, launch };
}

type FixtureFlows = Awaited<ReturnType<typeof createFixtureScenarioSet>>;

/** A Flow journey Runs start in: a seeded or fixture scenario Flow by key, or one the journey saved. */
export type ScenarioFlow = keyof DemoFlows | keyof FixtureFlows | { id: string };

/** A scenario Run and how it looked when the fixture last handed it to a journey. */
interface ScenarioRun {
  id: string;
  seen: string;
}

/**
 * Seeded scenario Runs, keyed journey Runs and the Run states journeys apply to them. Both belong
 * to the authorization context and journey attempt that started them: authorization journeys
 * retire contexts, and journeys change Runs. A later attempt gets fresh Runs and the earlier ones
 * are archived, so journeys that find a Run by title find the fresh one.
 */
export async function scenariosFixture(host: Host) {
  const { factory, context, world } = host;
  const flows: Record<keyof DemoFlows | keyof FixtureFlows, string> = {
    ...world.flows,
    ...(await createFixtureScenarioSet(host)),
  };
  const transitions = runTransitions(context);
  /** Advances before every journey attempt; Start keys include it. */
  let attempt = 0;

  async function currentContext() {
    const { authorizationContext } = requireSuccess(await factory.getConnection());
    assert(authorizationContext, "Run scenarios need an authorized T3 connection");
    return authorizationContext.id;
  }

  async function retire(id: string) {
    if (requireSuccess(await factory.getRun(id)).lifecycle !== "archived")
      requireSuccess(await factory.archiveRun(id));
  }

  /**
   * Reads what journeys change on scenario Runs, through the UI or Run states: navigation and
   * presentation, lifecycle, recorded work and requests. Archived Runs have no navigation entry.
   */
  async function observeRuns() {
    const navigation = new Map(
      requireSuccess(await factory.listRunNavigation()).map((entry) => [entry.id, entry]),
    );
    return async (id: string) => {
      const run = requireSuccess(await factory.getRun(id));
      return JSON.stringify([
        navigation.get(id) ?? null,
        run.lifecycle,
        run.events.length,
        run.intents.length,
        run.recoveries.length,
      ]);
    };
  }

  async function startWorker(
    flowId: string,
    key: string,
    title: string,
    prompt: string,
    keyNamespace: string,
  ) {
    return workerAtWork(
      context,
      await demoStart(context, flowId, key, title, prompt, undefined, {
        titlePrefix: "",
        keyNamespace,
      }),
    );
  }

  /** Every journey key's latest Run, with the context and attempt it belongs to. */
  const journeyRuns = new Map<
    string,
    { id: string; flowId: string; context: string; attempt: number }
  >();
  async function ensureRun(
    key: string,
    flow: ScenarioFlow,
    title = `Demo · Live ${key} · Tidy the project picker`,
  ) {
    const flowId = typeof flow === "string" ? flows[flow] : flow.id;
    const runContext = await currentContext();
    const known = journeyRuns.get(key);
    if (known?.attempt === attempt && known.context === runContext) {
      assert.equal(known.flowId, flowId, `Journey ${key} already uses another Flow`);
      return known.id;
    }
    if (known) await retire(known.id);
    const worker = await startWorker(
      flowId,
      key,
      title,
      "Tidy the spacing of the Atlas project picker.",
      `ui-live:${runContext}:${attempt}:`,
    );
    journeyRuns.set(key, { id: worker.runId, flowId, context: runContext, attempt });
    return worker.runId;
  }

  async function observed(runs: ReadonlyMap<string, string>) {
    const observe = await observeRuns();
    const result = new Map<string, ScenarioRun>();
    for (const [key, id] of runs) result.set(key, { id, seen: await observe(id) });
    return result;
  }

  /**
   * One copy of the seed scenario Runs, titled with `titlePrefix`, plus `extra` Runs. A refresh
   * replaces the Runs journeys changed since the previous refresh, or all of them when the
   * authorization context changed, and archives the replaced Runs.
   */
  function scenarioCopy(
    titlePrefix: string,
    keyPrefix: string,
    extra: readonly (readonly [string, (keyNamespace: string) => Promise<string>])[],
    seeded?: { context: string; runs: Map<string, ScenarioRun> },
  ) {
    let copy = seeded;
    return async (runContext: string) => {
      const observe = await observeRuns();
      const earlier = copy?.context === runContext ? copy.runs : new Map<string, ScenarioRun>();
      const stale = async (key: string) => {
        const run = earlier.get(key);
        return !run || (await observe(run.id)) !== run.seen;
      };
      const keyNamespace = `${keyPrefix}:${runContext}:${attempt}:`;
      const namespace = { titlePrefix, keyNamespace };
      const starts = [
        ...seedScenarioList.map(
          (scenario) =>
            [
              scenario.key,
              () => seedScenario(context, world.flows[scenario.flow], scenario, namespace),
            ] as const,
        ),
        ...extra.map(([key, start]) => [key, () => start(keyNamespace)] as const),
      ];
      const runs = new Map<string, string>();
      for (const [key, start] of starts) {
        if (!(await stale(key))) continue;
        const replaced = copy?.runs.get(key);
        if (replaced) await retire(replaced.id);
        runs.set(key, await start());
      }
      const next = new Map([...earlier, ...(await observed(runs))]);
      copy = { context: runContext, runs: next };
      return next;
    };
  }

  /** The development seed's own Runs, which journeys find by their Demo titles. */
  const refreshSeeded = scenarioCopy("Demo · ", "ui-demo", [], {
    context: await currentContext(),
    runs: await observed(world.runs),
  });
  /** The fixture's scenario copy, prepared on a journey's first request. */
  const refreshPrepared = scenarioCopy("UI worker · ", "ui-worker", [
    [
      "report-release",
      async (keyNamespace) =>
        (
          await startWorker(
            world.flows.review,
            "report-release",
            "UI worker · UI worker report release",
            "Implement the project picker change.",
            keyNamespace,
          )
        ).runId,
    ],
  ]);
  let prepared:
    | { attempt: number; context: string; runs: Promise<Map<string, ScenarioRun>> }
    | undefined;

  return {
    actions: {
      /** This attempt's scenario Runs by scenario key, in the current authorization context. */
      async prepare() {
        const runContext = await currentContext();
        if (prepared?.attempt !== attempt || prepared.context !== runContext)
          prepared = { attempt, context: runContext, runs: refreshPrepared(runContext) };
        return Object.fromEntries([...(await prepared.runs)].map(([key, run]) => [key, run.id]));
      },
      /** Starts `key` once per journey attempt, in `flow` and the current authorization context. */
      async ensure({ key, flow }: { key: string; flow: ScenarioFlow }) {
        return { id: await ensureRun(key, flow) };
      },
      /** Applies exactly the named Run state to the Run `id` or this attempt's journey `key`. */
      async transition(
        input: { state: FixtureState; message?: string } & ({ id: string } | { key: string }),
      ) {
        assert(Object.hasOwn(transitions, input.state), `Unknown Run state ${input.state}`);
        const journey = "key" in input ? journeyRuns.get(input.key) : undefined;
        const id = "id" in input ? input.id : journey?.attempt === attempt ? journey.id : undefined;
        assert(id, "An existing Run id or this journey's key is required");
        const run = requireSuccess(await factory.getRun(id));
        const outcome = await transitions[input.state](run, input.message);
        return { outcome };
      },
      /** The worker of Run `id` reports results until its Flow's Condition numbered `through`. */
      async arriveAtCondition({ id, through }: { id: string; through: number }) {
        await conditionArrivalsThrough(context, id, through);
      },
    },
    async reset() {
      attempt += 1;
      await refreshSeeded(await currentContext());
    },
    ensureRun,
  };
}
