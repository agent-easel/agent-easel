import { expect, it } from "vite-plus/test";
import { FINISH_BLOCK_ID, type FlowDraft, type FlowGraph } from "@agent-easel/contracts";
import { subflowCyclePath } from "@agent-easel/domain-validation";
import { AUTHORING_DIMENSIONS, canvasGraph } from "@agent-easel/flow-layout";
import {
  blockedSubflowReasons,
  computeSubflowPreviews,
  previewBlockFrame,
} from "../src/subflow-preview.ts";
import { savedAgent } from "./support/agent-draft.ts";
import { savedFlow } from "./support/studio-definitions.ts";

function childReviewFlow(): FlowDraft {
  return savedFlow("Review panel", {
    id: "review-panel",
    graph: {
      flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["security"] },
      blocks: [
        {
          id: "security",
          name: "Security",
          kind: "agent",
          agentId: "agent",
          position: { x: 300, y: 0 },
          hiddenExitIds: [],
          localExits: [],
          revisitInstruction: "",
          revisitContext: "keep",
        },
      ],
      connections: [
        {
          sourceBlockId: "security",
          exitId: "done",
          targetBlockId: FINISH_BLOCK_ID,
          targetEndingId: "approved",
        },
      ],
      finish: {
        position: { x: 640, y: 0 },
        endings: [
          {
            id: "approved",
            name: "Approved",
            description: "",
            output: "optional",
            outputDescription: "",
          },
          {
            id: "changes",
            name: "Needs changes",
            description: "",
            output: "none",
            outputDescription: "",
          },
        ],
      },
    },
  });
}

function parentWithSubflow(childId: string | null): FlowGraph {
  return {
    flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["review"] },
    blocks: [
      {
        id: "review",
        name: "Review",
        kind: "subflow",
        flowId: childId,
        position: { x: 320, y: 40 },
      },
    ],
    connections: [
      {
        sourceBlockId: "review",
        exitId: "approved",
        targetBlockId: FINISH_BLOCK_ID,
        targetEndingId: "shipped",
      },
    ],
    finish: {
      position: { x: 1200, y: 40 },
      endings: [
        {
          id: "shipped",
          name: "Shipped",
          description: "",
          output: "optional",
          outputDescription: "",
        },
      ],
    },
  };
}

it("expanded Subflow previews compute container geometry, outer ports and drawn-only ending routes", () => {
  // Arrange
  const child = childReviewFlow();
  const flows = new Map<string, FlowDraft>([[child.id, child]]);
  const agents = [savedAgent()];
  const graph = canvasGraph(parentWithSubflow(child.id), agents, flows);

  // Act
  const previews = computeSubflowPreviews({
    rootFlowId: "parent",
    graph,
    flows,
    agents,
    dimensions: AUTHORING_DIMENSIONS,
    collapsed: new Set(),
    blocked: new Map(),
  });
  const preview = previews.get("review");
  const frame = previewBlockFrame(previews)(graph.blocks[0]!);

  // Assert
  expect(preview).toBeDefined();
  expect(preview?.width).toBeGreaterThan(AUTHORING_DIMENSIONS.block.width);
  expect(preview?.height).toBeGreaterThan(180);
  expect(preview?.endingRoutes.map((route) => route.endingId)).toStrictEqual([
    "approved",
    "changes",
  ]);
  expect(preview?.endingRoutes[0]?.to.x).toBe(preview?.width);
  expect(frame?.exitY("approved")).toBe(preview?.exitPositions.get("approved"));
  expect(frame?.inputY).toBe(preview?.inputY);
});

it("collapsed, cyclic, over-budget, missing and unset Subflows omit their expanded preview", () => {
  // Arrange
  const child = childReviewFlow();
  const flows = new Map<string, FlowDraft>([[child.id, child]]);
  const agents = [savedAgent()];
  const rawGraph: FlowGraph = {
    flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["ok"] },
    blocks: [
      { id: "ok", name: "Collapsed", kind: "subflow", flowId: child.id, position: { x: 0, y: 0 } },
      { id: "loop", name: "Loop", kind: "subflow", flowId: child.id, position: { x: 0, y: 200 } },
      { id: "gone", name: "Gone", kind: "subflow", flowId: "missing", position: { x: 0, y: 400 } },
      { id: "unset", name: "Unset", kind: "subflow", flowId: null, position: { x: 0, y: 600 } },
    ],
    connections: [],
    finish: { position: { x: 600, y: 0 }, endings: [] },
  };
  const readiness = {
    ready: false,
    issues: [{ code: "subflow_cycle", path: "graph.blocks.1", message: "Loop." }],
  };

  // Act
  const reasons = blockedSubflowReasons(rawGraph, readiness, flows);
  const previews = computeSubflowPreviews({
    rootFlowId: "parent",
    graph: canvasGraph(rawGraph, agents, flows),
    flows,
    agents,
    dimensions: AUTHORING_DIMENSIONS,
    collapsed: new Set(["ok"]),
    blocked: reasons,
  });

  // Assert
  expect([...reasons.entries()]).toStrictEqual([
    ["loop", "cycle"],
    ["gone", "missing"],
    ["unset", "unset"],
  ]);
  expect(previews.size).toBe(0);
});

it("over-budget readiness collapses all placed Subflows with the budget reason", () => {
  // Arrange
  const child = childReviewFlow();
  const flows = new Map<string, FlowDraft>([[child.id, child]]);
  const rawGraph = parentWithSubflow(child.id);
  const readiness = {
    ready: false,
    issues: [{ code: "subflow_expanded_blocks_exceeded", path: "graph", message: "Over limit." }],
  };

  // Act
  const reasons = blockedSubflowReasons(rawGraph, readiness, flows);

  // Assert
  expect(reasons.get("review")).toBe("budget");
});

it("subflowCyclePath detects direct and transitive cycles and allows acyclic candidates", () => {
  // Arrange
  const leaf = childReviewFlow();
  const middle = savedFlow("Middle", {
    id: "middle",
    graph: parentWithSubflow(leaf.id),
  });
  const outer = savedFlow("Outer", {
    id: "outer",
    graph: parentWithSubflow(middle.id),
  });
  const flows = new Map<string, FlowDraft>([
    [leaf.id, leaf],
    [middle.id, middle],
    [outer.id, outer],
  ]);

  // Act
  const selfCycle = subflowCyclePath(leaf.id, leaf.id, flows);
  const transitiveCycle = subflowCyclePath(leaf.id, outer.id, flows);
  const acyclic = subflowCyclePath(outer.id, leaf.id, flows);

  // Assert
  expect(selfCycle).toStrictEqual([leaf.id]);
  expect(transitiveCycle).toStrictEqual([outer.id, middle.id, leaf.id]);
  expect(acyclic).toBeNull();
});
