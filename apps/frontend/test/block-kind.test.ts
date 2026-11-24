import { expect, it } from "vite-plus/test";
import type { AgentDefinition, FlowBlock, FlowConnection, FlowGraph } from "@agent-easel/contracts";
import { effectiveExits } from "@agent-easel/domain-validation";
import { blockReference, isSingleOutput } from "../src/block-kind.ts";
import { savedAgent } from "./support/agent-draft.ts";

const position = { x: 0, y: 0 };

const agentBlock = (id: string, name: string, agentId: string | null): FlowBlock => ({
  id,
  name,
  position,
  kind: "agent",
  agentId,
  hiddenExitIds: [],
  localExits: [],
  revisitInstruction: "",
  revisitContext: "keep",
});

const waitBlock = (duration: Extract<FlowBlock, { kind: "wait" }>["duration"]): FlowBlock => ({
  id: "pause",
  name: "Pause",
  position,
  kind: "wait",
  duration,
});

const continuation: FlowBlock = {
  id: "follow-up",
  name: "Follow up",
  position,
  kind: "continuation",
  prompt: "Address the review.",
};

/** A Flow holding `blocks` and `connections`, with the saved Agents its canvas knows. */
const flowWith = (
  blocks: FlowBlock[],
  connections: FlowConnection[] = [],
  agents: AgentDefinition[] = [],
): { graph: FlowGraph; agents: AgentDefinition[] } => ({
  graph: {
    blocks,
    connections,
    flowInput: { position, targetBlockIds: [] },
  },
  agents,
});

it("an Agent block without a chosen Agent reads not chosen on every screen", () => {
  // Arrange
  const block = agentBlock("review", "Review", null);
  const flow = flowWith([block]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference).toStrictEqual({
    card: { label: "Agent", value: "not chosen", tone: "plain" },
    line: { text: "Agent · not chosen", tone: "plain" },
    header: "Agent · not chosen",
  });
});

it("an Agent block whose Agent is no longer available reads Unavailable Agent on every screen", () => {
  // Arrange
  const block = agentBlock("review", "Review", "removed-agent");
  const flow = flowWith([block]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference).toStrictEqual({
    card: { label: "Agent", value: "Unavailable Agent", tone: "plain" },
    line: { text: "Agent · Unavailable Agent", tone: "plain" },
    header: "Agent · Unavailable Agent",
  });
});

it("Run detail leaves out an Agent the block's name already says", () => {
  // Arrange
  const agent = savedAgent();
  const block = agentBlock("review", agent.name, agent.id);
  const flow = flowWith([block], [], [agent]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference.header).toBe("Agent");
  expect(reference.line.text).toBe(`Agent · ${agent.name}`);
});

it("a Wait of one unit names the unit in the singular", () => {
  // Arrange
  const block = waitBlock({ amount: 1, unit: "minutes" });
  const flow = flowWith([block]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference).toStrictEqual({
    card: { label: "Waits", value: "1 minute", tone: "plain" },
    line: { text: "Wait · waits 1 minute", tone: "plain" },
    header: "Wait · 1 minute",
  });
});

it("a Wait of several units names the unit in the plural", () => {
  // Arrange
  const block = waitBlock({ amount: 5, unit: "minutes" });
  const flow = flowWith([block]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference.card.value).toBe("5 minutes");
  expect(reference.line.text).toBe("Wait · waits 5 minutes");
  expect(reference.header).toBe("Wait · 5 minutes");
});

it("a draft Wait without a duration says it has none", () => {
  // Arrange
  const block = waitBlock(null);
  const flow = flowWith([block]);

  // Act
  const reference = blockReference(block, flow);

  // Assert
  expect(reference.card.value).toBe("no duration");
  expect(reference.header).toBe("Wait · no duration");
});

it("a Continuation names the thread of the Agent before it as continued", () => {
  // Arrange
  const review = agentBlock("review", "Review", null);
  const flow = flowWith(
    [review, continuation],
    [{ sourceBlockId: review.id, exitId: "done", targetBlockId: continuation.id }],
  );

  // Act
  const reference = blockReference(continuation, flow);

  // Assert
  expect(reference).toStrictEqual({
    card: { label: "continues", value: "Review's thread", tone: "continued" },
    line: { text: "continues Review's thread", tone: "continued" },
    header: "Continuation · continues Review's thread",
    inspector: { label: "Continues", value: "Review's thread", tone: "continued" },
  });
});

it("a Continuation without an Agent before it says so as absent", () => {
  // Arrange
  const flow = flowWith([continuation]);

  // Act
  const reference = blockReference(continuation, flow);

  // Assert
  expect(reference).toStrictEqual({
    card: { label: "", value: "no Agent before it", tone: "absent" },
    line: { text: "no Agent before it", tone: "absent" },
    header: "Continuation · no Agent before it",
    inspector: { label: "", value: "No Agent before it", tone: "absent" },
  });
});

it("only a Wait's and a Continuation's output are a single unnamed output", () => {
  // Arrange
  const agent = savedAgent();
  const review: FlowBlock = {
    id: "review",
    name: "Review",
    position,
    kind: "agent",
    agentId: agent.id,
    hiddenExitIds: [],
    localExits: [{ id: "blocked", name: "blocked", description: "", messageRequired: false }],
    revisitInstruction: "",
    revisitContext: "keep",
  };
  const approval: FlowBlock = { id: "approval", name: "Approval", position, kind: "human" };
  const exits = [review, approval, waitBlock(null), continuation].flatMap((block) =>
    effectiveExits(block, [agent]),
  );

  // Act
  const unnamed = exits.map((exit) => [exit.source, isSingleOutput(exit)]);

  // Assert
  expect(unnamed).toStrictEqual([
    ["agent", false],
    ["local", false],
    ["human", false],
    ["human", false],
    ["wait", true],
    ["continuation", true],
  ]);
});
