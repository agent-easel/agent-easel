import { expect, it } from "vite-plus/test";
import { createCanvasGeometry } from "../src/flow-geometry.ts";
import { EXECUTION_DIMENSIONS } from "../src/components/canvas-dimensions.ts";
import { exitWires } from "../src/components/flow-wires.tsx";
import {
  AUTHORING_DIMENSIONS,
  buildElkGraph,
  createFlowLayoutDimensions,
} from "@t3-factory/flow-layout";
import {
  geometryGraph,
  joinGraph,
  sizeLimitConditionGraph,
  wiringGraph,
} from "./support/geometry.ts";

it("authoring graph bounds enclose the Flow input at its drawn height and incoming growth", () => {
  // Arrange
  const geometry = createCanvasGeometry(geometryGraph(), AUTHORING_DIMENSIONS);

  // Act
  const bounds = geometry.bounds();

  // Assert
  expect(geometry.flowInputBox).toStrictEqual({ x: -100, y: 0, width: 200, height: 76 });
  expect(bounds).toStrictEqual({ minX: -100, minY: 0, width: 740, height: 425 });
});

it("a Join gives each source block one input port on its own row, below which its output sits, as the layout does", () => {
  // Arrange
  const graph = joinGraph();
  const join = graph.blocks.find((block) => block.id === "join")!;
  const geometry = createCanvasGeometry(graph, AUTHORING_DIMENSIONS);
  const source = (sourceBlockId: string, exitId: string) =>
    ({ kind: "exit", sourceBlockId, exitId }) as const;

  // Act
  const elkJoin = buildElkGraph(
    graph,
    createFlowLayoutDimensions(graph, AUTHORING_DIMENSIONS),
  ).children?.find((node) => node.id === "block:join");

  // Assert
  expect(geometry.incomingPorts(join).map((port) => port.y)).toStrictEqual([192, 216]);
  expect([
    geometry.incomingPortIndex("join", source("code", "approve")),
    geometry.incomingPortIndex("join", source("code", "request-changes")),
    geometry.incomingPortIndex("join", source("security", "approve")),
    geometry.incomingPortIndex("join", source("security", "request-changes")),
  ]).toStrictEqual([0, 0, 1, 1]);
  expect(geometry.exitPoint(join, "output")).toStrictEqual({ x: 640, y: 251 });
  expect(elkJoin?.height).toBe(geometry.blockHeight(join));
  expect(elkJoin?.ports?.map((port) => port.y)).toStrictEqual([92, 116, 151]);
});

it("execution graph bounds enclose the status footers a block draws", () => {
  // Arrange
  const geometry = createCanvasGeometry(geometryGraph(), EXECUTION_DIMENSIONS, {
    footerCount: () => 2,
  });

  // Act
  const bounds = geometry.bounds();

  // Assert
  expect(bounds).toStrictEqual({ minX: -100, minY: 0, width: 740, height: 456.5 });
});

it("the execution Finish block reserves no activity line, and its ending ports agree with the layout", () => {
  // Arrange
  const ending = (id: string) =>
    ({ id, name: id, description: "", output: "none", outputDescription: "" }) as const;
  const graph = {
    ...geometryGraph(),
    finish: { position: { x: 800, y: 0 }, endings: [ending("delivered"), ending("blocked")] },
  };
  const geometry = createCanvasGeometry(graph, EXECUTION_DIMENSIONS);

  // Act
  const finishPorts = buildElkGraph(
    graph,
    createFlowLayoutDimensions(graph, EXECUTION_DIMENSIONS),
  ).children?.find((node) => node.id === "finish")?.ports;

  // Assert
  expect(geometry.finishBox).toStrictEqual({ x: 800, y: 0, width: 240, height: 123 });
  expect([geometry.endingPoint(0), geometry.endingPoint(1)]).toStrictEqual([
    { x: 800, y: 83.5 },
    { x: 800, y: 105.5 },
  ]);
  expect(finishPorts?.map((port) => port.y)).toStrictEqual([83.5, 105.5]);
});

it("incoming ports keep Flow input first, then connections in graph order, 18 px apart", () => {
  // Arrange
  const graph = geometryGraph();
  const geometry = createCanvasGeometry(graph, AUTHORING_DIMENSIONS);

  // Act
  const ports = geometry.incomingPorts(graph.blocks[0]!);

  // Assert
  expect(ports[0]).toStrictEqual({ source: { kind: "flow-input" }, x: 400, y: 251 });
  expect(ports[1]).toStrictEqual({
    source: { kind: "exit", sourceBlockId: "source-0", exitId: "done" },
    x: 400,
    y: 269,
  });
  expect(ports[9]).toStrictEqual({
    source: { kind: "exit", sourceBlockId: "source-8", exitId: "done" },
    x: 400,
    y: 413,
  });
});

it("the laid-out wires to an ordinary Block and an ending keep separate routes", () => {
  // Arrange
  const base = geometryGraph();
  const graph = {
    ...base,
    blocks: [{ ...base.blocks[0]!, id: "finish:done", name: "Review" }, base.blocks[1]!],
    flowInput: { ...base.flowInput, targetBlockIds: [] },
    connections: [
      { sourceBlockId: "source-0", exitId: "done", targetBlockId: "finish:done" },
      {
        sourceBlockId: "source-0",
        exitId: "done",
        targetBlockId: "finish",
        targetEndingId: "done",
      },
    ],
    finish: {
      position: { x: 800, y: 0 },
      endings: [
        { id: "done", name: "Delivered", output: "none", description: "", outputDescription: "" },
      ],
    },
  } as const;
  const layout = buildElkGraph(graph, createFlowLayoutDimensions(graph, AUTHORING_DIMENSIONS));
  const geometry = createCanvasGeometry(graph, AUTHORING_DIMENSIONS);

  // Act
  const [review, delivered] = exitWires(graph, "orthogonal", geometry, undefined, true);

  // Assert
  expect(review?.key).not.toBe(delivered?.key);
  expect([review?.target, delivered?.target]).toStrictEqual(["Review", "Finish · Delivered"]);
  expect(layout.edges).toMatchObject([
    { id: review?.key, targets: ["in:finish:done:0"] },
    { id: delivered?.key, targets: ["ending:0"] },
  ]);
});

it("a block grows to hold its last incoming port", () => {
  // Arrange
  const graph = geometryGraph();
  const geometry = createCanvasGeometry(graph, AUTHORING_DIMENSIONS);

  // Act
  const height = geometry.blockHeight(graph.blocks[0]!);

  // Assert
  expect(height).toBe(225);
});

it.each([0, 1, 2])(
  "local arrangement reserves at least the drawn height with %i status footers",
  (footers) => {
    // Arrange
    const graph = geometryGraph();
    const geometry = createCanvasGeometry(graph, EXECUTION_DIMENSIONS, {
      footerCount: () => footers,
      reservedFooterCount: 2,
    });

    // Act
    const reserved = geometry.reservedHeight(graph.blocks[0]!);

    // Assert
    expect(reserved).toBe(256.5);
    expect(reserved).toBeGreaterThanOrEqual(geometry.blockHeight(graph.blocks[0]!));
  },
);

it("focus bounds cover only the target blocks", () => {
  // Arrange
  const geometry = createCanvasGeometry(geometryGraph(), EXECUTION_DIMENSIONS, {
    footerCount: () => 2,
  });

  // Act
  const bounds = geometry.focusBounds(["target"]);

  // Assert
  expect(bounds).toStrictEqual({ minX: 400, minY: 200, width: 240, height: 256.5 });
});

it("focus bounds without targets cover the whole graph", () => {
  // Arrange
  const geometry = createCanvasGeometry(geometryGraph(), EXECUTION_DIMENSIONS, {
    footerCount: () => 2,
  });

  // Act
  const bounds = geometry.focusBounds([]);

  // Assert
  expect(bounds).toStrictEqual({ minX: -100, minY: 0, width: 740, height: 456.5 });
});

it("each wire keeps graph order, its source's first input port and its exit's name", () => {
  // Arrange
  const graph = wiringGraph();
  const geometry = createCanvasGeometry(graph, AUTHORING_DIMENSIONS);

  // Act
  const wires = exitWires(graph, "curved", geometry, undefined);

  // Assert: wire keys and ELK ids are internal; these are the rendered results.
  expect(wires).toMatchObject([
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "a:b",
          exitId: "c",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M240,92 C420,92 420,369 600,369",
        label: {
          x: 420,
          y: 230.5,
        },
      },
      exit: "Exit c",
      source: "Agent a:b",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "a",
          exitId: "b:c",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M540,92 C580,92 560,387 600,387",
        label: {
          x: 570,
          y: 239.5,
        },
      },
      exit: "Exit b:c",
      source: "Agent a",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "a:b",
          exitId: "c",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M240,92 C420,92 420,369 600,369",
        label: {
          x: 420,
          y: 230.5,
        },
      },
      exit: "Exit c",
      source: "Agent a:b",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "relay",
          exitId: "output",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M1140,92 H1160 V22 H524 V423 H600",
        label: {
          x: 870,
          y: 22,
        },
      },
      exit: null,
      source: "Unnamed block",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "gate",
          exitId: "otherwise",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M540,716 C580,716 560,441 600,441",
        label: {
          x: 570,
          y: 578.5,
        },
      },
      exit: "Otherwise",
      source: "Gate",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "a",
          exitId: "gone",
        },
        targetBlockId: "target",
      },
      path: {
        d: "M540,116 C580,116 560,459 600,459",
        label: {
          x: 570,
          y: 287.5,
        },
      },
      exit: "gone",
      source: "Agent a",
      target: "Target",
    },
    {
      wire: {
        source: {
          kind: "exit",
          sourceBlockId: "gate",
          exitId: "early",
        },
        targetBlockId: "a",
      },
      path: {
        d: "M540,692 H560 V8 H266 V69 H300",
        label: {
          x: 420,
          y: 8,
        },
      },
      exit: "Early",
      source: "Gate",
      target: "Agent a",
    },
  ]);
});

it("the arranged graph gives each wire its source's first input port and labels it by exit and target", () => {
  // Arrange
  const graph = wiringGraph();
  const dimensions = createFlowLayoutDimensions(graph, AUTHORING_DIMENSIONS);

  // Act
  const elk = buildElkGraph(graph, dimensions);

  // Assert
  expect(elk.edges).toMatchObject([
    {
      targets: ["in:target:0"],
    },
    {
      targets: ["in:target:0"],
    },
    {
      targets: ["in:a:0"],
    },
    {
      targets: ["in:target:1"],
      labels: [
        {
          text: "Exit c → Target",
          width: 129,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:target:2"],
      labels: [
        {
          text: "Exit b:c → Target",
          width: 143,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:target:1"],
      labels: [
        {
          text: "Exit c → Target",
          width: 129,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:target:4"],
      labels: [],
    },
    {
      targets: ["in:target:5"],
      labels: [
        {
          text: "Otherwise → Target",
          width: 150,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:target:6"],
      labels: [
        {
          text: "gone → Target",
          width: 115,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:a:1"],
      labels: [
        {
          text: "Early → Agent a",
          width: 129,
          height: 22,
        },
      ],
    },
    {
      targets: ["in:missing:0"],
      labels: [
        {
          text: "Exit c → Unnamed block",
          width: 178,
          height: 22,
        },
      ],
    },
  ]);
});

it("a Condition at the definition size limit draws all 5,000 wires with distinct target ports", () => {
  // Arrange
  const graph = sizeLimitConditionGraph();

  // Act
  const wires = exitWires(
    graph,
    "orthogonal",
    createCanvasGeometry(graph, EXECUTION_DIMENSIONS),
    undefined,
  );

  // Assert
  expect(wires).toHaveLength(5_000);
  const endpoints = wires.map(({ path }) => path.d.slice(path.d.lastIndexOf(" ") + 1));
  expect(new Set(endpoints).size).toBe(5_000);
  expect(wires[1]).toMatchObject({
    wire: {
      source: {
        kind: "exit",
        sourceBlockId: "escalate",
        exitId: "otherwise",
      },
      targetBlockId: "review",
    },
    path: {
      d: "M625,110120.5 L666,110120.5 Q670,110120.5 670,110116.5 L670,82.5 Q670,78.5 674,78.5 L715,78.5",
      label: null,
    },
    exit: "Otherwise",
    source: "Escalate",
    target: "Review",
  });
  expect(wires.at(-1)).toMatchObject({
    wire: {
      source: {
        kind: "exit",
        sourceBlockId: "escalate",
        exitId: "rule-0000000000000000000000000004997",
      },
      targetBlockId: "review",
    },
    path: {
      d: "M625,110098.5 L666,110098.5 Q670,110098.5 670,110094.5 L670,90046.5 Q670,90042.5 674,90042.5 L715,90042.5",
      label: null,
    },
    exit: "Route 4998",
    source: "Escalate",
    target: "Review",
  });
});
