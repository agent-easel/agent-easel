import { expect, it } from "vite-plus/test";
import { agentRuntimeMeta, workerTrigger } from "../src/lib/agent-display.ts";
import { capabilities } from "./support/agent-draft.ts";

it("a Worker reads as its provider, model and reasoning effort by display name", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "first",
    modelOptions: [
      { id: "effort", value: "high" },
      { id: "old", value: true },
    ],
  };

  // Act
  const trigger = workerTrigger(execution, capabilities);

  // Assert
  expect(trigger).toStrictEqual({ state: "ok", label: "Primary · First model · High" });
});

it("a Worker without a model reads Needs a model", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "",
    modelOptions: [],
  };

  // Act
  const trigger = workerTrigger(execution, capabilities);

  // Assert
  expect(trigger).toStrictEqual({ state: "needs-model", label: "Needs a model" });
});

it("a Worker without a chosen effort reads the model's default effort, as its settings show", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "first",
    modelOptions: [],
  };

  // Act
  const trigger = workerTrigger(execution, capabilities);

  // Assert
  expect(trigger).toStrictEqual({ state: "ok", label: "Primary · First model · Low" });
});

it("a saved Worker never exposes its provider or model identifier before T3 Code supplies display names", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "private-instance-id",
    modelId: "private-model-id",
    modelOptions: [],
  };

  // Act
  const trigger = workerTrigger(execution, null);

  // Assert
  expect(trigger).toStrictEqual({ state: "unknown", label: "Worker details unavailable" });
});

it("a saved Worker whose model is gone has no runtime summary for Studio placement", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "removed-model",
    modelOptions: [],
  };

  // Act
  const summary = agentRuntimeMeta(execution, capabilities);

  // Assert
  expect(summary).toBe("");
});
