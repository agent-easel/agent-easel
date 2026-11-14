import { expect, it, vi } from "vite-plus/test";
import type { CommitImportInput, ImportResult, ImportReview } from "@t3-factory/contracts";
import { createDefinitionImport } from "../src/definition-import.ts";
import { OfflineError } from "../src/transport.ts";
import { capabilities } from "./support/agent-draft.ts";

const document = {
  format: "t3-factory/definitions",
  formatVersion: 1,
  kind: "agent",
  factoryVersion: "0.6.0",
  exportedAt: "2026-11-14T10:00:00.000Z",
  agents: [
    {
      key: "agent-1",
      name: "Code reviewer",
      prompt: "Review the change.",
      model: { providerInstanceId: "elsewhere", modelId: "first", modelOptions: [] },
      exits: [],
    },
  ],
};
const file = { name: "code-reviewer.agent.json", text: JSON.stringify(document) };
const reviewed: ImportReview = {
  kind: "agent",
  agents: [
    {
      key: "agent-1",
      name: "Code reviewer",
      promptLength: 18,
      exitCount: 0,
      hint: document.agents[0]!.model,
      proposed: null,
    },
  ],
  capabilities,
};

async function reviewedImport() {
  const operations = {
    reviewImport: vi.fn(() => Promise.resolve(reviewed)),
    commitImport: vi.fn<(input: CommitImportInput) => Promise<ImportResult>>(() =>
      Promise.resolve({ agents: [{ key: "agent-1", id: "imported" }] }),
    ),
  };
  const model = createDefinitionImport(operations, () => "request-1");
  await model.choose(file);
  return { model, operations };
}

it("picking a catalog model for a row selects it in the connected environment with its default options", async () => {
  // Arrange
  const { model } = await reviewedImport();

  // Act
  model.select("agent-1", { providerInstanceId: "primary", modelId: "first" });

  // Assert
  expect(model.getSnapshot().review?.rows[0]?.selection).toStrictEqual({
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "first",
    modelOptions: [
      { id: "effort", value: "low" },
      { id: "old", value: true },
    ],
  });
});

it("Confirm commits every row as reviewed even when every Agent needs a model", async () => {
  // Arrange
  const { model, operations } = await reviewedImport();

  // Act
  const result = await model.confirm();

  // Assert
  expect(result).toStrictEqual({ agents: [{ key: "agent-1", id: "imported" }] });
  expect(operations.commitImport).toHaveBeenCalledWith({
    requestId: "request-1",
    document,
    selections: { "agent-1": null },
  });
  expect(model.getSnapshot().file).toBeNull();
});

it("Confirm after an uncertain commit retries with the same request id", async () => {
  // Arrange
  const { model, operations } = await reviewedImport();
  operations.commitImport.mockRejectedValueOnce(new OfflineError());
  await model.confirm();

  // Act
  await model.confirm();

  // Assert
  expect(operations.commitImport.mock.calls.map(([input]) => input.requestId)).toStrictEqual([
    "request-1",
    "request-1",
  ]);
});
