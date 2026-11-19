import { expect, it } from "vite-plus/test";
import { createCanvasGeometry } from "../src/flow-geometry.ts";
import { EXECUTION_DIMENSIONS } from "../src/components/canvas-dimensions.ts";
import { exitWires } from "../src/components/flow-wires.tsx";
import {
  AUTHORING_DIMENSIONS,
  buildElkGraph,
  createFlowLayoutDimensions,
} from "@t3-factory/flow-layout";
import { geometryGraph, sizeLimitConditionGraph, wiringGraph } from "./support/geometry.ts";

it("authoring graph bounds enclose the Flow input at its drawn height and incoming growth", () => {
  // Arrange
  const geometry = createCanvasGeometry(geometryGraph(), AUTHORING_DIMENSIONS);

  // Act
  const bounds = geometry.bounds();

  // Assert
  expect(geometry.flowInputBox).toStrictEqual({ x: -100, y: 0, width: 200, height: 76 });
  expect(bounds).toStrictEqual({ minX: -100, minY: 0, width: 740, height: 425 });
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

  // Assert
  expect(wires).toStrictEqual([
    {
      key: "a:b:c:target",
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
      key: "a:b:c:target",
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
      key: "a:b:c:target",
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
      key: "relay:output:target",
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
      key: "gate:otherwise:target",
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
      key: "a:gone:target",
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
      key: "gate:early:a",
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
  expect(elk.edges).toStrictEqual([
    {
      id: "flow-input:target",
      sources: ["out:flow-input"],
      targets: ["in:target:0"],
    },
    {
      id: "flow-input:target",
      sources: ["out:flow-input"],
      targets: ["in:target:0"],
    },
    {
      id: "flow-input:a",
      sources: ["out:flow-input"],
      targets: ["in:a:0"],
    },
    {
      id: "a:b:c:target",
      sources: ["out:a:b:c"],
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
      id: "a:b:c:target",
      sources: ["out:a:b:c"],
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
      id: "a:b:c:target",
      sources: ["out:a:b:c"],
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
      id: "relay:output:target",
      sources: ["out:relay:output"],
      targets: ["in:target:4"],
      labels: [],
    },
    {
      id: "gate:otherwise:target",
      sources: ["out:gate:otherwise"],
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
      id: "a:gone:target",
      sources: ["out:a:gone"],
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
      id: "gate:early:a",
      sources: ["out:gate:early"],
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
      id: "a:b:c:missing",
      sources: ["out:a:b:c"],
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

it("a Condition at the definition size limit draws its 5,000 wires, each on its own input port, within 100 ms", () => {
  // Arrange
  const graph = sizeLimitConditionGraph();
  const started = performance.now();

  // Act
  const wires = exitWires(
    graph,
    "orthogonal",
    createCanvasGeometry(graph, EXECUTION_DIMENSIONS),
    undefined,
  );
  const elapsed = performance.now() - started;

  // Assert
  expect(wires).toHaveLength(5_000);
  expect(wires[1]).toStrictEqual({
    key: "escalate:otherwise:review",
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
  expect(wires.at(-1)).toStrictEqual({
    key: "escalate:rule-0000000000000000000000000004997:review",
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
  expect(elapsed).toBeLessThan(100);
});
