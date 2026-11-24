import {
  blockExit,
  agentBlock,
  flowInput,
  humanStep,
  connection,
  waitBlock,
  WAIT_OUTPUT,
  continuationStep,
  conditionBlock,
  conditionRule,
  OTHERWISE,
  joinBlock,
  JOIN_OUTPUT,
} from "../../apps/backend/test/support/scenarios.ts";
import { FINISH_BLOCK_ID } from "../../packages/contracts/src/index.ts";
import type { AgentEasel } from "../../apps/backend/src/index.ts";
import type { FlowGraphInput, FlowWorkspace } from "../../packages/contracts/src/index.ts";
import { requireSuccess } from "./seed-support.ts";
import type { DemoAgents, DemoFlows } from "./seed-scenarios.ts";

/** Creates the named Flow with `graph` and requires it to be ready to start. */
export async function saveFlow(
  factory: AgentEasel,
  name: string,
  graph: FlowGraphInput,
  workspace: FlowWorkspace = { mode: "checkout" },
) {
  const flow = requireSuccess(await factory.createFlow({ name }));
  const saved = requireSuccess(
    await factory.updateFlow(flow.id, {
      name,
      expectedRevision: flow.revision,
      expectedProjectId: flow.projectId,
      workspace,
      graph,
    }),
  );
  if (!saved.readiness.ready) throw Error(`Development Flow ${name} is not ready.`);
  return saved.id;
}

const accessibilityReview = (agentId: string, x: number) =>
  agentBlock("accessibility", "Accessibility review", agentId, { x, y: 320 });

/** The incomplete Flow the seed leaves as a draft; the error Trigger starts in it. */
export const draftFlowName = "Demo · Release checklist (draft)";

export async function createDemoFlows(factory: AgentEasel, agents: DemoAgents): Promise<DemoFlows> {
  requireSuccess(await factory.createFlow({ name: draftFlowName }));
  const worker = agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 });
  const simple = await saveFlow(factory, "Demo · Focused change", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock(
        "worker",
        "Implement change",
        agents.worker,
        { x: 320, y: 180 },
        ["review"],
        [blockExit("done", "Done", "Done")],
      ),
    ],
    connections: [],
  });
  const review = await saveFlow(factory, "Demo · Build, review and decide", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      worker,
      agentBlock(
        "reviewer",
        "Review implementation",
        agents.reviewer,
        { x: 700, y: 180 },
        ["approved"],
        [blockExit("decision", "Ready for your decision", "Ready for your decision")],
        "This is a return after corrections. Verify each requested fix and the scope it newly affects instead of repeating the full review. Keep the dispositions of earlier findings unless the new changes reopen them. If your earlier baseline, coverage or findings are not available from this thread or your previous result, do the full review.",
      ),
      humanStep("decision", "Your review", { x: 1080, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "reviewer"),
      connection("reviewer", "decision", "decision"),
      connection("decision", "request-changes", "worker"),
    ],
  });
  const parallel = await saveFlow(factory, "Demo · Parallel review", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      worker,
      agentBlock("reviewer", "Code review", agents.reviewer, { x: 720, y: 40 }),
      accessibilityReview(agents.accessibility, 720),
    ],
    connections: [
      connection("worker", "review", "reviewer"),
      connection("worker", "review", "accessibility"),
    ],
  });
  const parallelStart = await saveFlow(factory, "Demo · Parallel review from one prompt", {
    flowInput: flowInput(["reviewer", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Code review", agents.reviewer, { x: 320, y: 40 }),
      accessibilityReview(agents.accessibility, 320),
    ],
    connections: [],
  });
  const worktree = await saveFlow(
    factory,
    "Demo · Build and review in a worktree",
    {
      flowInput: flowInput(["worker"], { x: 40, y: 180 }),
      blocks: [
        worker,
        agentBlock("reviewer", "Review implementation", agents.reviewer, { x: 700, y: 180 }),
      ],
      connections: [connection("worker", "review", "reviewer")],
    },
    { mode: "worktree", base: { kind: "default" } },
  );
  const continuation = await saveFlow(factory, "Demo · Grill, spec and tickets", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Grill the change", agents.worker, { x: 320, y: 180 }),
      humanStep("scope", "Approve scope", { x: 700, y: 180 }),
      continuationStep(
        "spec",
        "Spec",
        "Using everything we agreed in this conversation, write the implementation spec as Markdown. List open questions last.",
        { x: 1080, y: 180 },
      ),
      continuationStep(
        "tickets",
        "Tickets",
        "Split the spec into small tickets, each with acceptance checks.",
        { x: 1460, y: 180 },
      ),
    ],
    connections: [
      connection("worker", "review", "scope"),
      connection("scope", "approve", "spec"),
      connection("spec", "output", "tickets"),
    ],
  });
  await createExitReadinessScenarios(factory, agents.reviewer, agents.worker);
  const subflowReview = await createSubflowCompositionFlows(factory, agents);
  return {
    simple,
    review,
    parallel,
    parallelStart,
    subflowReview,
    worktree,
    continuation,
    ...(await createWaitFlows(factory, agents)),
    ...(await createConditionFlows(factory, agents)),
    endings: await createEndingsFlow(factory, agents),
    approvedEnding: await createApprovedEndingFlow(factory, agents),
    joinReview: await createJoinFlow(factory, agents),
  };
}

async function createJoinFlow(factory: AgentEasel, agents: DemoAgents) {
  const changes = [blockExit("changes", "Changes requested", "List each requested change.")];
  return saveFlow(factory, "Demo · Parallel review joined for your decision", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      agentBlock("reviewer", "Code review", agents.reviewer, { x: 700, y: 40 }, [], changes),
      agentBlock(
        "accessibility",
        "Accessibility review",
        agents.accessibility,
        { x: 700, y: 320 },
        [],
        changes,
      ),
      joinBlock("results", "Review results", { x: 1080, y: 180 }),
      humanStep("decision", "Your decision", { x: 1460, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "reviewer"),
      connection("worker", "review", "accessibility"),
      connection("reviewer", "approved", "results"),
      connection("reviewer", "changes", "results"),
      connection("accessibility", "approved", "results"),
      connection("accessibility", "changes", "results"),
      connection("results", JOIN_OUTPUT, "decision"),
      connection("decision", "request-changes", "worker"),
    ],
  });
}

function createApprovedEndingFlow(factory: AgentEasel, agents: DemoAgents) {
  return saveFlow(factory, "Demo · Approve and ship", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      humanStep("approval", "Approve release", { x: 700, y: 180 }),
      conditionBlock("gate", "Release gate", [], { x: 1080, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "approval"),
      connection("approval", "approve", "gate"),
      {
        sourceBlockId: "gate",
        exitId: OTHERWISE,
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "approved",
      },
    ],
    finish: {
      position: { x: 1460, y: 180 },
      endings: [
        {
          id: "approved",
          name: "Approved",
          description: "You approved the release.",
          output: "required",
          outputDescription: "The release notes link.",
        },
      ],
    },
  });
}

function createEndingsFlow(factory: AgentEasel, agents: DemoAgents) {
  const done = [blockExit("done", "Done", "Done")];
  return saveFlow(factory, "Demo · Ship or drop", {
    flowInput: flowInput(["worker", "reviewer"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Ship the fix", agents.worker, { x: 320, y: 40 }, [], done),
      agentBlock(
        "reviewer",
        "Explore an alternative",
        agents.reviewer,
        { x: 320, y: 320 },
        [],
        done,
      ),
    ],
    connections: [
      {
        sourceBlockId: "worker",
        exitId: "done",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "shipped",
      },
      {
        sourceBlockId: "reviewer",
        exitId: "done",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "dropped",
      },
    ],
    finish: {
      position: { x: 700, y: 180 },
      endings: [
        {
          id: "shipped",
          name: "Shipped",
          description: "The fix is in a pull request.",
          output: "required",
          outputDescription: "URL of the pull request.",
        },
        {
          id: "dropped",
          name: "Dropped",
          description: "The alternative was abandoned.",
          output: "none",
          outputDescription: "",
        },
      ],
    },
  });
}

/** Review rounds that return changes to the worker until arrival 3 escalates to you, parallel
 * approvals where only the first reaches your decision and later ones go into the release notes,
 * and a saved Condition draft whose rules block Start. */
async function createConditionFlows(factory: AgentEasel, agents: DemoAgents) {
  const graph = (rules: Parameters<typeof conditionBlock>[2]) => ({
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      agentBlock(
        "reviewer",
        "Review implementation",
        agents.reviewer,
        { x: 700, y: 180 },
        [],
        [
          blockExit(
            "changes",
            "Changes requested",
            "The change needs another pass. List each requested change.",
          ),
        ],
      ),
      conditionBlock("rounds", "Review rounds", rules, { x: 1080, y: 180 }),
      humanStep("escalation", "Your decision", { x: 1460, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "reviewer"),
      connection("reviewer", "changes", "rounds"),
      connection("rounds", "escalate", "escalation"),
      connection("rounds", OTHERWISE, "worker"),
      connection("escalation", "request-changes", "worker"),
    ],
  });
  const conditionRounds = await saveFlow(
    factory,
    "Demo · Review rounds, then escalate",
    graph([conditionRule("escalate", "Human escalation", 3)]),
  );
  const firstApproval = await saveFlow(factory, "Demo · First approval decides", {
    flowInput: flowInput(["reviewer", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Code review", agents.reviewer, { x: 320, y: 40 }),
      accessibilityReview(agents.accessibility, 320),
      conditionBlock("first", "First approval", [conditionRule("later", "Later approvals", 2)], {
        x: 700,
        y: 180,
      }),
      agentBlock("notes", "Note the extra approval", agents.releaseNotes, { x: 1080, y: 20 }),
      humanStep("decision", "Your decision", { x: 1080, y: 180 }),
    ],
    connections: [
      connection("reviewer", "approved", "first"),
      connection("accessibility", "approved", "first"),
      connection("first", "later", "notes"),
      connection("first", OTHERWISE, "decision"),
    ],
  });
  const draft = requireSuccess(
    await factory.createFlow({ name: "Demo · Condition needs thresholds (draft)" }),
  );
  requireSuccess(
    await factory.updateFlow(draft.id, {
      name: draft.name,
      expectedRevision: draft.revision,
      expectedProjectId: draft.projectId,
      workspace: { mode: "checkout" },
      graph: graph([
        conditionRule("escalate", "Human escalation", null),
        conditionRule("every", "Every arrival", 1),
      ]),
    }),
  );
  return { conditionRounds, firstApproval };
}

/** A Wait between implementation and review, Waits holding parallel reviews for a decision, an
 * approval held for the release window, and a saved Wait draft with no duration yet. */
async function createWaitFlows(factory: AgentEasel, agents: DemoAgents) {
  const review = agentBlock("reviewer", "Review implementation", agents.reviewer, {
    x: 1080,
    y: 180,
  });
  const coolDown = (duration: Parameters<typeof waitBlock>[2]) =>
    waitBlock("settle", "Let CI settle", duration, { x: 700, y: 180 });
  const graph = (duration: Parameters<typeof waitBlock>[2]) => ({
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      coolDown(duration),
      review,
    ],
    connections: [
      connection("worker", "review", "settle"),
      connection("settle", WAIT_OUTPUT, "reviewer"),
    ],
  });
  const wait = await saveFlow(
    factory,
    "Demo · Build, cool down and review",
    graph({ amount: 2, unit: "days" }),
  );
  const parallelWait = await saveFlow(factory, "Demo · Parallel review held for the sync", {
    flowInput: flowInput(["reviewer", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Code review", agents.reviewer, { x: 320, y: 40 }),
      accessibilityReview(agents.accessibility, 320),
      waitBlock(
        "hold",
        "Hold for the morning sync",
        { amount: 1, unit: "days" },
        { x: 700, y: 180 },
      ),
      humanStep("decision", "Your decision", { x: 1080, y: 180 }),
    ],
    connections: [
      connection("reviewer", "approved", "hold"),
      connection("accessibility", "approved", "hold"),
      connection("hold", WAIT_OUTPUT, "decision"),
    ],
  });
  const humanWait = await saveFlow(factory, "Demo · Approve, then hold for release", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      humanStep("approval", "Approve release", { x: 700, y: 180 }),
      waitBlock(
        "window",
        "Hold for the release window",
        { amount: 1, unit: "days" },
        { x: 1080, y: 180 },
      ),
      agentBlock("announce", "Announce release", agents.worker, { x: 1460, y: 180 }),
    ],
    connections: [
      connection("worker", "review", "approval"),
      connection("approval", "request-changes", "worker"),
      connection("approval", "approve", "window"),
      connection("window", WAIT_OUTPUT, "announce"),
    ],
  });
  const draft = requireSuccess(
    await factory.createFlow({ name: "Demo · Wait needs a duration (draft)" }),
  );
  requireSuccess(
    await factory.updateFlow(draft.id, {
      name: draft.name,
      expectedRevision: draft.revision,
      expectedProjectId: draft.projectId,
      workspace: { mode: "checkout" },
      graph: graph(null),
    }),
  );
  return { wait, parallelWait, humanWait };
}

/** Ready wiring followed by an Agent edit exposes saved, repairable exit-contract issues. */
async function createExitReadinessScenarios(
  factory: AgentEasel,
  reviewerId: string,
  workerId: string,
) {
  const template = requireSuccess(await factory.getAgent(reviewerId));
  const reviewer = requireSuccess(
    await factory.createAgent({
      name: "Demo · Exit contract reviewer",
      prompt: template.prompt,
      execution: template.execution,
      exits: [
        blockExit("pass", "pass", "pass"),
        { ...blockExit("fail", "fail", "fail"), messageRequired: true },
        blockExit("needs-human", "needs-human", "needs-human"),
      ],
    }),
  );
  const reviewBlock = agentBlock(
    "reviewer",
    "Exit contract review",
    reviewer.id,
    { x: 320, y: 120 },
    ["needs-human"],
    [
      {
        ...blockExit("github-url-local", "github-url", "github-url"),
        description: "A fix is ready. Include its GitHub URL in the message.",
        messageRequired: true,
      },
    ],
  );
  await saveFlow(factory, "Demo · Exit configuration needs repair", {
    flowInput: flowInput(["reviewer"], { x: 40, y: 180 }),
    blocks: [
      reviewBlock,
      agentBlock("worker", "Apply review changes", workerId, { x: 700, y: 120 }),
    ],
    connections: [
      connection("reviewer", "fail", "worker"),
      connection("reviewer", "github-url-local", "worker"),
    ],
  });
  requireSuccess(
    await factory.updateAgent(reviewer.id, {
      name: reviewer.name,
      prompt: reviewer.prompt,
      execution: reviewer.execution,
      expectedRevision: reviewer.revision,
      expectedProjectId: reviewer.projectId,
      projectOverrides: reviewer.projectOverrides,
      exits: [
        blockExit("pass", "pass", "pass"),
        blockExit("github-url-agent", "github-url", "github-url"),
        blockExit("needs-human", "needs-human", "needs-human"),
      ],
    }),
  );
  const hiddenFlowId = await saveFlow(factory, "Demo · Hidden exit connection", {
    flowInput: flowInput(["reviewer"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("reviewer", "Review implementation", reviewerId, { x: 320, y: 120 }),
      agentBlock("worker", "Apply review changes", workerId, { x: 700, y: 120 }),
    ],
    connections: [connection("reviewer", "approved", "worker")],
  });
  const hiddenFlow = requireSuccess(await factory.getFlow(hiddenFlowId));
  requireSuccess(
    await factory.updateFlow(hiddenFlowId, {
      name: hiddenFlow.name,
      expectedRevision: hiddenFlow.revision,
      expectedProjectId: hiddenFlow.projectId,
      graph: {
        ...hiddenFlow.graph,
        blocks: hiddenFlow.graph.blocks.map((block) =>
          block.kind === "agent" && block.id === "reviewer"
            ? { ...block, hiddenExitIds: ["approved"] }
            : block,
        ),
      },
    }),
  );
}

async function createSubflowCompositionFlows(factory: AgentEasel, agents: DemoAgents) {
  const reviewPanelId = await saveFlow(factory, "Demo · Review panel", {
    flowInput: flowInput(["security", "accessibility"], { x: 40, y: 180 }),
    blocks: [
      agentBlock(
        "security",
        "Code review",
        agents.reviewer,
        { x: 320, y: 40 },
        [],
        [blockExit("changes", "Changes requested", "Request changes before shipping.")],
      ),
      agentBlock(
        "accessibility",
        "Accessibility review",
        agents.accessibility,
        { x: 320, y: 320 },
        [],
        [blockExit("changes", "Changes requested", "Request accessibility fixes.")],
      ),
    ],
    connections: [
      {
        sourceBlockId: "security",
        exitId: "approved",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "approved",
      },
      {
        sourceBlockId: "accessibility",
        exitId: "approved",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "approved",
      },
      {
        sourceBlockId: "security",
        exitId: "changes",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "needs-changes",
      },
      {
        sourceBlockId: "accessibility",
        exitId: "changes",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "needs-changes",
      },
    ],
    finish: {
      position: { x: 700, y: 180 },
      endings: [
        {
          id: "approved",
          name: "Approved",
          description: "Reviewers approved the change.",
          output: "optional",
          outputDescription: "Summary of review checks.",
        },
        {
          id: "needs-changes",
          name: "Needs changes",
          description: "Reviewers requested follow-up changes.",
          output: "required",
          outputDescription: "List of requested fixes.",
        },
      ],
    },
  });
  return saveFlow(factory, "Demo · Release with review", {
    flowInput: flowInput(["worker"], { x: 40, y: 180 }),
    blocks: [
      agentBlock("worker", "Implement change", agents.worker, { x: 320, y: 180 }),
      {
        id: "review-panel",
        name: "Review panel",
        kind: "subflow",
        flowId: reviewPanelId,
        position: { x: 680, y: 40 },
      },
      agentBlock("notes", "Release notes", agents.releaseNotes, { x: 1620, y: 80 }),
    ],
    connections: [
      connection("worker", "review", "review-panel"),
      connection("review-panel", "approved", "notes"),
      {
        sourceBlockId: "review-panel",
        exitId: "needs-changes",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "returned",
      },
    ],
    finish: {
      position: { x: 1620, y: 360 },
      endings: [
        {
          id: "returned",
          name: "Returned",
          description: "The release returned for follow-up fixes.",
          output: "optional",
          outputDescription: "Review feedback summary.",
        },
      ],
    },
  });
}
