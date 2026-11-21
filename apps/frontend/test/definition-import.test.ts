import { expect, it, vi } from "vite-plus/test";
import type { CommitImportInput, ImportResult, ImportReview } from "@t3-factory/contracts";
import { ApiError } from "../src/api.ts";
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
      model: {
        providerInstanceId: "elsewhere",
        modelId: "first",
        modelOptions: [
          { id: "effort", value: "high" },
          { id: "old", value: false },
        ],
      },
      exits: [],
    },
  ],
};
const file = {
  name: "code-reviewer.agent.json",
  data: new Blob([JSON.stringify(document)], { type: "application/json" }),
};
const reviewed: ImportReview = {
  kind: "agent",
  flows: [],
  agents: [
    {
      key: "agent-1",
      name: "Code reviewer",
      promptLength: 18,
      exitCount: 0,
      hint: document.agents[0]!.model,
      match: { status: "unmatched" },
      proposed: null,
      droppedOptions: [],
    },
  ],
  capabilities,
};

async function reviewedImport() {
  const operations = {
    reviewImport: vi.fn(() => Promise.resolve(reviewed)),
    commitImport: vi.fn<(input: CommitImportInput) => Promise<ImportResult>>(() =>
      Promise.resolve({ agents: [{ key: "agent-1", id: "imported" }], flowId: null }),
    ),
  };
  const model = createDefinitionImport(operations, () => "request-1");
  await model.choose(file);
  return { model, operations };
}

it("changing a row's model keeps the hint options it accepts and recomputes the dropped ones", async () => {
  // Arrange
  const { model } = await reviewedImport();
  model.select("agent-1", { providerInstanceId: "primary", modelId: "first" });

  // Act
  model.select("agent-1", { providerInstanceId: "primary", modelId: "second" });

  // Assert
  expect(model.getSnapshot().review?.rows[0]).toMatchObject({
    selection: {
      environmentId: "local",
      providerInstanceId: "primary",
      modelId: "second",
      modelOptions: [
        { id: "effort", value: "high" },
        { id: "new", value: false },
      ],
    },
    droppedOptions: [{ id: "old", value: false }],
  });
});

it("Confirm commits every row as reviewed into Global by default, even when every Agent needs a model", async () => {
  // Arrange
  const { model, operations } = await reviewedImport();

  // Act
  const result = await model.confirm();

  // Assert
  expect(result).toStrictEqual({ agents: [{ key: "agent-1", id: "imported" }], flowId: null });
  expect(operations.commitImport).toHaveBeenCalledWith({
    requestId: "request-1",
    document,
    selections: { "agent-1": null },
    projectId: null,
  });
  expect(model.getSnapshot().file).toBeNull();
});

it("Confirm creates the imported definitions in the chosen target Project", async () => {
  // Arrange
  const { model, operations } = await reviewedImport();
  model.setTarget("northwind");

  // Act
  await model.confirm();

  // Assert
  expect(operations.commitImport).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request-1", projectId: "northwind" }),
  );
});

it("a review rejected for one field lists that field's path under the matching headline", async () => {
  // Arrange
  const message = 'Agent "Reviewer": Use a description up to 4000 characters.';
  const model = createDefinitionImport(
    {
      reviewImport: vi.fn(() =>
        Promise.reject(
          new ApiError({
            code: "validation",
            message,
            issues: [{ code: "invalid_exit", path: "agents.0.exits.0.description", message }],
          }),
        ),
      ),
      commitImport: vi.fn(),
    },
    () => "request-1",
  );

  // Act
  await model.choose(file);

  // Assert
  expect(model.getSnapshot()).toMatchObject({
    error: message,
    issues: [`agents.0.exits.0.description: ${message}`],
  });
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
