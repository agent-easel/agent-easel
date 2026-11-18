import { expect, it } from "vite-plus/test";
import { workerTrigger } from "../src/lib/agent-display.ts";
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
  expect(trigger).toStrictEqual({ state: "ok", label: "Primary · first · High" });
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
  expect(trigger).toStrictEqual({ state: "ok", label: "Primary · first · Low" });
});
