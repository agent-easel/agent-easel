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
  blockWorkerLaunched,
  conditionBlock,
  conditionRule,
  connection,
  continuationStep,
  OTHERWISE,
  waitBlock,
  WAIT_OUTPUT,
  workingReported,
  workingReportedIdle,
  report,
  workingReport,
  replyTurnObserved,
  settled,
  workerAtWork,
  workerHandle,
  generatedTitleApplied,
  humanStep,
  observeFor,
  twoWorkersStarted,
} from "../../../apps/backend/test/support/scenarios.ts";
import { promptAnswered, promptSent } from "../../../apps/backend/test/support/continuation.ts";
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
    "working reported and idle": (run: RunDetail, message?: string) =>
      workingReportedIdle(context, workerOf(context, run), message),
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
      t3.threads.holdStops(run.threadBindings.map((binding) => binding.threadId)),
    "stopped turns ended": (run: RunDetail) =>
      t3.threads.finishHeldStops(run.threadBindings.map((binding) => binding.threadId)),
  };
}

/** A Run state a journey applies to an existing Run. */
export type FixtureState = keyof ReturnType<typeof runTransitions>;

/**
 * The fixture scenario set: Flows, Agents, repositories and provider models only UI journeys use,
 * built like the development seed's. Answers its ready Flows by key.
 */
async function createFixtureScenarioSet(host: Host) {
  const { factory, t3, home, world } = host;
  // A one-minute Wait lets the Wait journey observe a real forwarding without a long Run.
  const pause = await saveFlow(factory, "UI wait · Pause a minute", {
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Implement change", world.agents.worker, { x: 320, y: 180 }, [], []),
      waitBlock("pause", "Pause a minute", { amount: 1, unit: "minutes" }, { x: 700, y: 180 }),
    ],
    connections: [connection("worker", "review", "pause")],
  });
  // A person's answer that a Wait passes on to a second Human step keeps the person as its author.
  const answerRelay = await saveFlow(factory, "UI wait · Answer held for sign-off", {
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Implement change", world.agents.worker, { x: 320, y: 180 }, [], []),
      humanStep("review", "First review", { x: 700, y: 180 }),
      waitBlock("hold", "Hold for sign-off", { amount: 1, unit: "days" }, { x: 1080, y: 180 }),
      humanStep("signoff", "Final sign-off", { x: 1460, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "review"),
      connection("review", "approve", "hold"),
      connection("hold", WAIT_OUTPUT, "signoff"),
    ],
  });
  // An answer First review sends through the Condition Route the answer to Final sign-off.
  const routedAnswer = (connections: readonly ReturnType<typeof connection>[]) => ({
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Implement change", world.agents.worker, { x: 320, y: 180 }, [], []),
      humanStep("review", "First review", { x: 700, y: 40 }),
      conditionBlock("route", "Route the answer", [conditionRule("later", "Later answers", 2)], {
        x: 1080,
        y: 180,
      }),
      humanStep("signoff", "Final sign-off", { x: 1460, y: 180 }),
    ],
    connections: [
      ...connections,
      connection("review", "approve", "route"),
      connection("route", "later", "signoff"),
      connection("route", OTHERWISE, "signoff"),
    ],
  });
  // The same answer selected by a Condition keeps the person as its author too.
  const answerCondition = await saveFlow(
    factory,
    "UI condition · Answer routed to sign-off",
    routedAnswer([connection("worker", "review", "review")]),
  );
  // The result reaches the Condition beside the review, so the answer is its second arrival with
  // the same worker provenance; each sign-off keeps its own author.
  const answerBesideResult = await saveFlow(
    factory,
    "UI condition · Result and answer routed",
    routedAnswer([
      connection("worker", "review", "review"),
      connection("worker", "review", "route"),
    ]),
  );
  // A Continuation whose prompt already answered passes a later review through to sign-off.
  const continuationRelay = await saveFlow(factory, "UI continuation · Review passed through", {
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Implement change", world.agents.worker, { x: 320, y: 180 }, [], []),
      agentBlock("reviewer", "Code review", world.agents.reviewer, { x: 700, y: 40 }, [], []),
      continuationStep("spec", "Write the spec", "Write the spec from the change.", {
        x: 1080,
        y: 180,
      }),
      humanStep("signoff", "Final sign-off", { x: 1460, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "spec"),
      connection("worker", "review", "reviewer"),
      connection("reviewer", "approved", "spec"),
      connection("spec", "output", "signoff"),
    ],
  });
  // Two reviews of one change reach the same Human step as parallel occurrences (Figma RD50).
  const parallelDecision = await saveFlow(factory, "UI decision · Two reviews, one decision", {
    flowInput: flowInput(["reviewer", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Code review", world.agents.reviewer, { x: 320, y: 40 }),
      agentBlock("accessibility", "Accessibility review", world.agents.accessibility, {
        x: 320,
        y: 320,
      }),
      humanStep("decision", "Your decision", { x: 700, y: 180 }),
    ],
    connections: [
      connection("reviewer", "approved", "decision"),
      connection("accessibility", "approved", "decision"),
    ],
  });

  // Both reviews reach one Human step through one Condition, so each occurrence's message is a
  // Condition selection whose author only its worker provenance tells apart.
  const conditionReviews = await saveFlow(factory, "UI condition · Two reviews routed", {
    flowInput: flowInput(["reviewer", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Code review", world.agents.reviewer, { x: 320, y: 40 }),
      agentBlock("accessibility", "Accessibility review", world.agents.accessibility, {
        x: 320,
        y: 320,
      }),
      conditionBlock("route", "Route the reviews", [conditionRule("later", "Later reviews", 2)], {
        x: 700,
        y: 180,
      }),
      humanStep("decision", "Your decision", { x: 1080, y: 180 }),
    ],
    connections: [
      connection("reviewer", "approved", "route"),
      connection("accessibility", "approved", "route"),
      connection("route", "later", "decision"),
      connection("route", OTHERWISE, "decision"),
    ],
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
  const unselectedModelOptions = controlledExecution(t3.connection.environmentId, {
    modelOptions: [],
  });
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
  await createOwnershipSet(host, unselectedModelOptions);
  return {
    pause,
    answerRelay,
    answerCondition,
    answerBesideResult,
    continuationRelay,
    conditionReviews,
    launch,
    parallelDecision,
  };
}

/** Each parallel review, long enough for its Human occurrence to preview it. */
const parallelReviews = [
  [
    "## Code review",
    "",
    "The filters panel code is ready to ship.",
    "",
    "- Filter state lives in one reducer.",
    "- `clearFilters` keeps the query.",
    "- Errors from the count request show inline.",
    "",
    "### Nits",
    "",
    "One naming nit is noted inline; it does not block the release.",
    "Rename `countQuery` to `resultCountQuery` when convenient.",
  ].join("\n"),
  [
    "## Accessibility review",
    "",
    "Keyboard navigation works across the filters panel.",
    "",
    "- Focus returns to the filter button after closing.",
    "- Every checkbox has a visible label.",
    "- The result count is announced politely.",
    "",
    "### Checked",
    "",
    "Screen reader output was checked with the panel open and closed.",
    "Zoom at 200% keeps every filter reachable without horizontal scrolling.",
  ].join("\n"),
] as const;

/** One long review both reviewers of the identical-reviews Run report word for word. */
const identicalReview = [
  "## Shared review",
  "",
  "The filters panel is ready to ship.",
  "",
  "- Filter state lives in one reducer.",
  "- Focus returns to the filter button after closing.",
  "- The result count is announced politely.",
  "",
  "### Checked",
  "",
  "Both themes and the narrow window were checked by hand.",
  "Nothing else blocks the release.",
].join("\n");

/**
 * Project-owned definitions for Studio's owner grouping: Northwind stays available, while Docs
 * site has left T3's project list, so its Flow is kept and editable but cannot start.
 */
async function createOwnershipSet(
  { factory, t3, home }: Host,
  execution: ReturnType<typeof controlledExecution>,
) {
  async function repository(name: string, title: string) {
    const root = join(home, name);
    await mkdir(root);
    await promisify(execFile)("git", ["init", root], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
    });
    const added = requireSuccess(await factory.addRepository({ path: root }));
    t3.projects = t3.projects.map((entry) =>
      entry.projectId === added.projectId ? { ...entry, title } : entry,
    );
    requireSuccess(await factory.recheckProjects());
    return added;
  }
  async function projectFlow(name: string, projectId: string, agentId: string) {
    const flow = requireSuccess(await factory.createFlow({ name, projectId }));
    requireSuccess(
      await factory.updateFlow(flow.id, {
        name,
        expectedRevision: flow.revision,
        expectedProjectId: projectId,
        workspace: { mode: "checkout" },
        graph: {
          flowInput: flowInput("worker"),
          blocks: [agentBlock("worker", "Owned worker", agentId, { x: 320, y: 180 }, [], [])],
          connections: [],
        },
      }),
    );
  }
  const done = [blockExit("done", "Done", "Complete", false)];
  const northwind = await repository("northwind", "Northwind");
  const qa = requireSuccess(
    await factory.createAgent({
      name: "Northwind QA",
      prompt: "Check the Northwind release.",
      execution,
      exits: done,
      projectId: northwind.id,
    }),
  );
  await projectFlow("Northwind release", northwind.id, qa.id);
  const docs = await repository("docs-site", "Docs site");
  const writer = requireSuccess(
    await factory.createAgent({
      name: "Docs writer",
      prompt: "Refresh the docs site.",
      execution,
      exits: done,
      projectId: docs.id,
    }),
  );
  await projectFlow("Docs refresh", docs.id, writer.id);
  t3.projects = t3.projects.filter((entry) => entry.projectId !== docs.projectId);
  requireSuccess(await factory.recheckProjects());
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
      "parallel-decision",
      async (keyNamespace) => {
        const [first, second] = await twoWorkersStarted(
          context,
          await demoStart(
            context,
            flows.parallelDecision,
            "parallel-decision",
            "UI worker · Two reviews wait for your decision",
            "Review the Atlas filters panel for code quality and keyboard accessibility.",
            undefined,
            { titlePrefix: "", keyNamespace },
          ),
        );
        await resultReported(context, first, { exit: "Approved", message: parallelReviews[0] });
        await resultReported(context, second, { exit: "Approved", message: parallelReviews[1] });
        await observeFor(
          "observe both decisions",
          context,
          first.runId,
          (run) => run.humanOccurrences.filter((item) => item.state === "pending").length === 2,
        );
        return first.runId;
      },
    ],
    [
      "condition-identical-reviews",
      async (keyNamespace) => {
        const [first, second] = await twoWorkersStarted(
          context,
          await demoStart(
            context,
            flows.conditionReviews,
            "condition-identical-reviews",
            "UI worker · Two identical reviews routed to your decision",
            "Review the Atlas filters panel for code quality and keyboard accessibility.",
            undefined,
            { titlePrefix: "", keyNamespace },
          ),
        );
        await resultReported(context, first, { exit: "Approved", message: identicalReview });
        await resultReported(context, second, { exit: "Approved", message: identicalReview });
        await observeFor(
          "observe both routed reviews",
          context,
          first.runId,
          (run) => run.humanOccurrences.filter((item) => item.state === "pending").length === 2,
        );
        return first.runId;
      },
    ],
    [
      "continuation-relay",
      async (keyNamespace) => {
        const worker = await startWorker(
          flows.continuationRelay,
          "continuation-relay",
          "UI worker · Code review passed through the spec",
          "Tidy the filters panel and write its spec.",
          keyNamespace,
        );
        await resultReported(context, worker, {
          exit: "review",
          message: "The filters panel change is ready.",
        });
        const reviewer = await blockWorkerLaunched(context, worker.runId, "reviewer");
        await promptAnswered(
          context,
          worker,
          await promptSent(context, worker),
          "Spec written: docs/filters.md.",
        );
        await resultReported(context, reviewer, { exit: "Approved", message: parallelReviews[0] });
        await observeFor(
          "observe the review passed through to sign-off",
          context,
          worker.runId,
          (run) => run.humanOccurrences.filter((item) => item.state === "pending").length === 2,
        );
        return worker.runId;
      },
    ],
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
