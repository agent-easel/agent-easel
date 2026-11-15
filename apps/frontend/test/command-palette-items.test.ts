import { Play } from "lucide-react";
import { expect, it } from "vite-plus/test";
import type { AgentDefinition } from "@t3-factory/contracts";
import {
  paletteCatalog,
  paletteMatchesQuery,
  type PaletteItem,
} from "../src/command-palette-items.ts";

const run: PaletteItem = {
  id: "run",
  kind: "run",
  number: 13,
  label: "Implement search",
  icon: Play,
  keywords: "run Project",
  run: () => undefined,
};

it("a bare Run number finds that Run", () => {
  // Arrange
  const query = "13";

  // Act
  const matches = paletteMatchesQuery(run, query);

  // Assert
  expect(matches).toBe(true);
});

it("a hash-prefixed Run number finds that Run", () => {
  // Arrange
  const query = "#13";

  // Act
  const matches = paletteMatchesQuery(run, query);

  // Assert
  expect(matches).toBe(true);
});

it("a bare number does not find Runs with that number as a prefix", () => {
  // Arrange
  const other = { ...run, number: 130 };

  // Act
  const matches = paletteMatchesQuery(other, "13");

  // Assert
  expect(matches).toBe(false);
});

it("a hash-prefixed number does not find Runs with that number as a prefix", () => {
  // Arrange
  const other = { ...run, number: 130 };

  // Act
  const matches = paletteMatchesQuery(other, "#13");

  // Assert
  expect(matches).toBe(false);
});

it("a number query still finds matching title text on a different Run", () => {
  // Arrange
  const other = { ...run, number: 31, label: "Fix issue 13" };

  // Act
  const matches = paletteMatchesQuery(other, "13");

  // Assert
  expect(matches).toBe(true);
});

it("an absent Run number does not become searchable as null", () => {
  // Arrange
  const older = { ...run, number: null };

  // Act
  const matches = paletteMatchesQuery(older, "null");

  // Assert
  expect(matches).toBe(false);
});

it("a Studio scope that is resynchronizing keeps its cached items and is shown as updating", () => {
  // Arrange
  const agent = { id: "agent", name: "Reviewer" } as AgentDefinition;
  const navigation = { value: [], synchronized: true, error: null };
  const studio = { value: { agents: [agent], flows: [] }, synchronized: false, error: null };

  // Act
  const catalog = paletteCatalog(navigation, studio);

  // Assert
  expect(catalog.synchronizing).toStrictEqual(["Flows", "Agents"]);
  expect(catalog.loading).toStrictEqual([]);
  expect(catalog.agents).toStrictEqual([agent]);
});
