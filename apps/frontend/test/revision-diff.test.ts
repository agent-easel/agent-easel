import { expect, it } from "vite-plus/test";
import type { FlowContent } from "../src/flow-draft.ts";
import { comparedFlowLines } from "../src/flow-revision-content.ts";

import { diffRevisionLines } from "../src/revision-diff.ts";

it("an inserted repeat is highlighted even when the prompt already contains the same instruction", () => {
  // Arrange
  const mine = ["First", "Check the change.", "Finish"];
  const theirs = ["First", "Check the change.", "Check the change.", "Finish"];

  // Act
  const diff = diffRevisionLines(mine, theirs);

  // Assert
  expect(diff.mineChanged).toStrictEqual([false, false, false]);
  expect(diff.theirsChanged).toStrictEqual([false, false, true, false]);
});

it("swapping two prompt lines is visible on both sides", () => {
  // Arrange
  const mine = ["First", "Build", "Review", "Finish"];
  const theirs = ["First", "Review", "Build", "Finish"];

  // Act
  const diff = diffRevisionLines(mine, theirs);

  // Assert
  expect(diff.mineChanged).toContain(true);
  expect(diff.theirsChanged).toContain(true);
  expect(diff.mineChanged.filter(Boolean)).toHaveLength(1);
  expect(diff.theirsChanged.filter(Boolean)).toHaveLength(1);
});

it("a new Flow revision exposes Wait, Continuation and Condition edits in the compared panes", () => {
  // Arrange
  const blocks = [
    { id: "wait", name: "Pause", position: { x: 0, y: 0 } },
    { id: "continuation", name: "Review again", position: { x: 300, y: 0 } },
    { id: "condition", name: "Route", position: { x: 600, y: 0 } },
  ] as const;
  const flow = (amount: number, prompt: string, fromArrival: number): FlowContent => ({
    name: "Review",
    workspace: { mode: "checkout" },
    graph: {
      flowInput: { position: { x: 0, y: 0 }, targetBlockIds: [] },
      connections: [],
      blocks: [
        { ...blocks[0], kind: "wait", duration: { amount, unit: "minutes" } },
        { ...blocks[1], kind: "continuation", prompt },
        {
          ...blocks[2],
          kind: "condition",
          rules: [{ id: "route", name: "Approve", fromArrival }],
          otherwise: { id: "otherwise" },
        },
      ],
    },
  });
  const mine = comparedFlowLines(flow(5, "Check the tests.", 2), []);
  const theirs = comparedFlowLines(flow(15, "Check the build.", 3), []);

  // Act
  const { theirsChanged } = diffRevisionLines(mine, theirs);

  // Assert
  expect(theirs.filter((_, index) => theirsChanged[index])).toStrictEqual([
    "    Wait for  15 minutes",
    "      Check the build.",
    expect.objectContaining({ text: "    Approve · From arrival 3 onward" }),
  ]);
});
