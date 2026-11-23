import { expect, it } from "vite-plus/test";
import { connectionLabel } from "../src/connection-label.ts";

it.each([
  ["agent", "Ready for review"],
  ["human", "Approve"],
  ["ending", "Shipped"],
  ["condition", "More review"],
  ["condition", "Otherwise"],
] as const)("shows the named %s exit %s", (source, name) => {
  // Arrange
  const exit = { id: "exit", source, name };

  // Act
  const label = connectionLabel(exit);

  // Assert
  expect(label).toEqual({ text: name, struck: false });
});

it.each([
  ["wait", "", "after the wait"],
  ["join", "", "output"],
  ["continuation", "", "response"],
  ["agent", "", "Unnamed exit"],
  ["condition", "", "Unnamed output"],
] as const)("shows the %s output label %s as %s", (source, name, text) => {
  // Arrange
  const exit = { id: "output", source, name };

  // Act
  const label = connectionLabel(exit);

  // Assert
  expect(label).toEqual({ text, struck: false });
});

it.each([
  ["hidden", "Hidden review", "Hidden review"],
  ["removed", "", "stored-exit"],
] as const)("strikes through a %s exit", (unavailable, name, text) => {
  // Arrange
  const exit = { id: "stored-exit", source: "agent", name, unavailable } as const;

  // Act
  const label = connectionLabel(exit);

  // Assert
  expect(label).toEqual({ text, struck: true });
});

it.each(["Flow input", "Incoming message"])("omits the label for %s", () => {
  // Arrange
  const exit = null;

  // Act
  const label = connectionLabel(exit);

  // Assert
  expect(label).toBeNull();
});

it("labels fan-out to a block and to Finish with the same source name", () => {
  // Arrange
  const exit = { id: "ready", source: "agent", name: "Ready" } as const;
  const targets = ["review", "finish"];

  // Act
  const labels = targets.map(() => connectionLabel(exit));

  // Assert
  expect(labels).toEqual([
    { text: "Ready", struck: false },
    { text: "Ready", struck: false },
  ]);
});
