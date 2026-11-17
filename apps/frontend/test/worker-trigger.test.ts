import { expect, it } from "vite-plus/test";
import { workerTrigger } from "../src/lib/agent-display.ts";
import { capabilities } from "./support/agent-draft.ts";

it("an available Worker reads as its provider glyph, model and reasoning effort", () => {
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
  expect(trigger).toStrictEqual({
    state: "ok",
    glyph: "P",
    model: "first",
    effort: "high",
    label: "first · high",
    reason: null,
  });
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
  expect(trigger).toStrictEqual({
    state: "needs-model",
    glyph: "",
    model: "",
    effort: "",
    label: "Needs a model",
    reason: null,
  });
});

it("a saved Worker reads Unknown with T3's explanation while capabilities are unavailable", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "first",
    modelOptions: [{ id: "effort", value: "high" }],
  };
  const offline = {
    state: "unavailable" as const,
    explanation: "T3 is not connected.",
    checkedAt: null,
    environments: [],
    providers: [],
  };

  // Act
  const trigger = workerTrigger(execution, offline);

  // Assert
  expect(trigger).toStrictEqual({
    state: "unknown",
    glyph: "P",
    model: "first",
    effort: "high",
    label: "first · high · Unknown",
    reason: "T3 is not connected.",
  });
});

it("a saved model T3 no longer offers reads Unavailable and names the model", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "retired",
    modelOptions: [{ id: "effort", value: "high" }],
  };

  // Act
  const trigger = workerTrigger(execution, capabilities);

  // Assert
  expect(trigger).toStrictEqual({
    state: "unavailable",
    glyph: "P",
    model: "retired",
    effort: "high",
    label: "retired · high · Unavailable",
    reason: "Saved model retired is unavailable in T3.",
  });
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
  expect(trigger).toMatchObject({ state: "ok", effort: "low", label: "first · low" });
});
