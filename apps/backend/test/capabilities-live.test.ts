import { assert, expect, it } from "@effect/vitest";
import { agentSettingsStatus } from "../src/agents.ts";
import { authorizedLiveOAuth } from "./support/boundaries-setup.ts";

const liveCatalog = {
  providers: [
    {
      providerInstanceId: "codex",
      driverKind: "codex",
      displayName: "Codex",
      models: [
        {
          id: "gpt-6.1-sol",
          options: [
            { id: "reasoningEffort", values: ["low", "medium", "high"], default: "low" },
            { id: "fastMode", values: [false], default: false },
            { id: "mixed", values: [false, "auto"], default: "auto" },
            { id: "legacy", type: "boolean", default: true },
          ],
        },
      ],
    },
  ],
};

it("orchestrator capability reads preserve live model option values and choices", async (c) => {
  // Arrange
  const { projects, endpoint } = await authorizedLiveOAuth(c, { capabilities: () => liveCatalog });

  // Act
  const providers = await projects.orchestratorCapabilities({ endpoint });

  // Assert
  expect(providers[0]!.models[0]!.options).toStrictEqual([
    {
      id: "reasoningEffort",
      label: "reasoningEffort",
      type: "select",
      values: ["low", "medium", "high"],
      default: "low",
      choices: [
        { id: "low", label: "low" },
        { id: "medium", label: "medium" },
        { id: "high", label: "high" },
      ],
    },
    { id: "fastMode", label: "fastMode", type: "boolean", values: [false], default: false },
    { id: "mixed", label: "mixed", type: "select", values: [false, "auto"], default: "auto" },
    { id: "legacy", label: "legacy", type: "boolean", default: true },
  ]);
});

it("the Agent catalog treats blank model names as absent", async (c) => {
  // Arrange
  const { factory } = await authorizedLiveOAuth(c, {
    capabilities: () => ({
      providers: [
        {
          ...liveCatalog.providers[0]!,
          models: [
            { id: "gpt-6.2-sol", label: "" },
            { id: "gpt-6.2-astra", label: " \t " },
            { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
          ],
        },
      ],
    }),
  });

  // Act
  const catalog = await factory.getAgentCapabilities();

  // Assert
  assert(catalog.ok);
  expect(catalog.value.providers[0]?.models).toStrictEqual([
    { id: "gpt-6.2-sol", label: null },
    { id: "gpt-6.2-astra", label: null },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
  ]);
});

it("settings status marks fastMode unavailable when the live catalog allows only false", async (c) => {
  // Arrange
  const { factory } = await authorizedLiveOAuth(c, { capabilities: () => liveCatalog });
  const execution = {
    environmentId: "fixture-environment",
    providerInstanceId: "codex",
    modelId: "gpt-6.1-sol",
    modelOptions: [{ id: "fastMode", value: true }],
  };
  const capabilities = await factory.getAgentCapabilities();
  assert(capabilities.ok);

  // Act
  const status = agentSettingsStatus(execution, capabilities.value);

  // Assert
  expect(status.options[0]?.state).toBe("unavailable");
});

it("settings status marks mixed values outside the live catalog as unavailable", async (c) => {
  // Arrange
  const { factory } = await authorizedLiveOAuth(c, { capabilities: () => liveCatalog });
  const execution = {
    environmentId: "fixture-environment",
    providerInstanceId: "codex",
    modelId: "gpt-6.1-sol",
    modelOptions: [{ id: "mixed", value: true }],
  };
  const capabilities = await factory.getAgentCapabilities();
  assert(capabilities.ok);

  // Act
  const status = agentSettingsStatus(execution, capabilities.value);

  // Assert
  expect(status.options[0]?.state).toBe("unavailable");
});
