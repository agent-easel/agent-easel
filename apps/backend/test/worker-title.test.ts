import { expect, it } from "@effect/vitest";
import { workerThreadTitle } from "../src/runner/worker-title.ts";

const run = { number: 42, title: "Ship search" };

function agent(id: string, name: string) {
  return { id, name, kind: "agent" as const };
}

it("a numberless Run with one blank Agent label keeps the separator before its title", () => {
  // Arrange
  const blocks = [agent("worker", "\t\u0085 "), { id: "pause", name: "", kind: "wait" as const }];

  // Act
  const title = workerThreadTitle({ number: null, title: run.title }, blocks, "worker");

  // Assert
  expect(title).toBe("F · Ship search");
});

it("blank Agent labels receive ordinals in the captured Flow order", () => {
  // Arrange
  const blocks = [agent("first", ""), agent("second", "\u2003")];

  // Act
  const title = workerThreadTitle(run, blocks, "second");

  // Assert
  expect(title).toBe("F#42 (2) · Ship search");
});

it("numberless Runs with named Agent Blocks preserve Markdown and collapse Unicode whitespace", () => {
  // Arrange
  const blocks = [agent("worker", "  Review\u2028\n\t**diff**  ")];

  // Act
  const title = workerThreadTitle(
    { number: null, title: ' repo#42:\u0085\u00a0  **Repair** "search" ' },
    blocks,
    "worker",
  );

  // Assert
  expect(title).toBe('F Review **diff** · repo#42: **Repair** "search"');
});

it("Block label clipping leaves a combining sequence intact and only adds an ellipsis when shortened", () => {
  // Arrange
  const blocks = [agent("worker", "abcdefghijklmnopqrstu" + "e\u0301" + "XY")];

  // Act
  const title = workerThreadTitle(run, blocks, "worker");

  // Assert
  expect(title).toBe("F#42 abcdefghijklmnopqrstue\u0301… · Ship search");
});

it("a Block label that fits exactly keeps its final non-BMP character without an ellipsis", () => {
  // Arrange
  const blocks = [agent("worker", "abcdefghijklmnopqrstuvw🐈")];

  // Act
  const title = workerThreadTitle(run, blocks, "worker");

  // Assert
  expect(title).toBe("F#42 abcdefghijklmnopqrstuvw🐈 · Ship search");
});

it("the 200-code-point title cap leaves no fragment of a joined emoji", () => {
  // Arrange
  const title = "x".repeat(188) + "👩‍💻 tail";
  const blocks = [agent("worker", "A")];

  // Act
  const rendered = workerThreadTitle({ ...run, title }, blocks, "worker");

  // Assert
  expect(rendered).toBe(`F#42 A · ${"x".repeat(188)}…`);
  expect(Array.from(rendered)).toHaveLength(198);
});

it("collision ordinals skip reserved literal suffixes even when spelled with leading zeros", () => {
  // Arrange
  const blocks = [
    agent("first", "Review"),
    agent("second", "Review"),
    agent("literal-one", "Review (1)"),
    agent("literal-two", "Review (02)"),
  ];

  // Act
  const title = workerThreadTitle(run, blocks, "first");

  // Assert
  expect(title).toBe("F#42 Review (3) · Ship search");
});

it("ordinals remain unique when distinct clipped labels become equal after making room for the ordinal", () => {
  // Arrange
  const shared = "abcdefghijklmnopqrst";
  const blocks = [
    agent("first", `${shared}ABC extra`),
    agent("second", `${shared}DEF extra`),
    agent("third", `${shared}ABC more`),
    agent("fourth", `${shared}DEF more`),
  ];

  // Act
  const title = workerThreadTitle(run, blocks, "fourth");

  // Assert
  expect(title).toBe("F#42 abcdefghijklmnopqrs… (4) · Ship search");
});

it("ordinals keep a literal separator in a Block name from disguising an older Run title", () => {
  // Arrange
  const blocks = [agent("short", "A"), agent("long", "A · A"), agent("literal", "A (1) · A")];

  // Act
  const title = workerThreadTitle({ ...run, title: "A · Ship search" }, blocks, "short");

  // Assert
  expect(title).toBe("F#42 A (2) · A · Ship search");
});
