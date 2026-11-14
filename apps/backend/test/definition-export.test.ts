import { assert, expect, it } from "@effect/vitest";
import { openFactoryWithApprovedT3, sampleAgentInput } from "./support/domain-setup.ts";

it("an exported Agent holds its latest saved revision and a model hint without environment, ids, revisions or timestamps", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent(sampleAgentInput("Coder"));
  assert(created.ok);
  const saved = await factory.updateAgent(created.value.id, {
    ...sampleAgentInput("Reviewer"),
    expectedRevision: created.value.revision,
  });
  assert(saved.ok);

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  expect(exported).toStrictEqual({
    ok: true,
    value: {
      document: {
        format: "t3-factory/definitions",
        formatVersion: 1,
        kind: "agent",
        factoryVersion: "source",
        exportedAt: expect.any(String),
        agents: [
          {
            key: "agent-1",
            name: "Reviewer",
            prompt: saved.value.prompt,
            model: {
              driverKind: "codex",
              providerInstanceId: "codex-main",
              modelId: "gpt-6.1-sol",
              modelOptions: [{ id: "reasoning", value: "high" }],
            },
            exits: saved.value.exits,
          },
        ],
      },
      driverKindOmitted: [],
    },
  });
});

it("an Agent without a model exports with no model hint", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent({ ...sampleAgentInput(), execution: null });
  assert(created.ok);

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  assert(exported.ok);
  expect(exported.value.document.agents[0].model).toBeNull();
  expect(exported.value.driverKindOmitted).toStrictEqual([]);
});

it("an export without T3 capabilities keeps the model hint, omits only its driver kind and names the Agent", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent(sampleAgentInput("Coder"));
  assert(created.ok);
  t3.capabilitiesAvailable = false;

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  assert(exported.ok);
  expect(exported.value.document.agents[0].model).toStrictEqual({
    providerInstanceId: "codex-main",
    modelId: "gpt-6.1-sol",
    modelOptions: [{ id: "reasoning", value: "high" }],
  });
  expect(exported.value.driverKindOmitted).toStrictEqual([{ key: "agent-1", name: "Coder" }]);
});
