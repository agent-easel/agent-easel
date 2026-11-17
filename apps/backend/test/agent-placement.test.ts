import { expect, it } from "@effect/vitest";
import { mayPlaceAgent } from "@t3-factory/domain-validation";

it("a global Flow may place a global Agent", () => {
  // Act
  const allowed = mayPlaceAgent(null, null);

  // Assert
  expect(allowed).toBe(true);
});

it("a Project Flow may place a global Agent", () => {
  // Act
  const allowed = mayPlaceAgent("project-one", null);

  // Assert
  expect(allowed).toBe(true);
});

it("a Project Flow may place an Agent of its own Project", () => {
  // Act
  const allowed = mayPlaceAgent("project-one", "project-one");

  // Assert
  expect(allowed).toBe(true);
});

it("a Project Flow may not place an Agent of another Project", () => {
  // Act
  const allowed = mayPlaceAgent("project-one", "project-two");

  // Assert
  expect(allowed).toBe(false);
});

it("a global Flow may not place a Project Agent", () => {
  // Act
  const allowed = mayPlaceAgent(null, "project-one");

  // Assert
  expect(allowed).toBe(false);
});
