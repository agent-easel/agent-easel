import { expect, it, vi } from "vite-plus/test";
import type { DefinitionExport } from "@t3-factory/contracts";
import { createDefinitionExport } from "../src/definition-export.ts";

const exported: DefinitionExport = {
  document: {
    format: "t3-factory/definitions",
    formatVersion: 5,
    kind: "agent",
    factoryVersion: "source",
    exportedAt: "2026-11-14T10:00:00.000Z",
    agents: [
      {
        key: "agent-1",
        name: "Code reviewer",
        prompt: "Review the change.",
        model: null,
        exits: [],
      },
    ],
  },
  driverKindOmitted: [],
};

function definitionExport() {
  const read = vi.fn(() => Promise.resolve(exported));
  const save = vi.fn<(name: string, text: string) => void>();
  return { model: createDefinitionExport(read, save), read, save };
}

it("a dirty editor asks before exporting and reads nothing until confirmed", async () => {
  // Arrange
  const { model, read, save } = definitionExport();

  // Act
  await model.request(true);

  // Assert
  expect(model.getSnapshot()).toMatchObject({ confirming: true, exporting: false });
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("Export saved revision downloads the saved revision as a named JSON file", async () => {
  // Arrange
  const { model, save } = definitionExport();
  await model.request(true);

  // Act
  await model.confirm();

  // Assert
  expect(model.getSnapshot()).toMatchObject({ confirming: false, exporting: false, error: "" });
  expect(save).toHaveBeenCalledWith(
    "code-reviewer.agent.json",
    `${JSON.stringify(exported.document, null, 2)}\n`,
  );
});

it("Keep editing closes the question without exporting", async () => {
  // Arrange
  const { model, read } = definitionExport();
  await model.request(true);

  // Act
  model.keepEditing();

  // Assert
  expect(model.getSnapshot().confirming).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
