import { assert, expect, it } from "@effect/vitest";
import { failure } from "../src/result.ts";
import { prepared } from "./support/prepared-runner.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { cheapTitleModel, controlledTitleModel, enableRunTitles } from "./support/scenarios.ts";

it("a session reads the enabled state, model and diagnostic of the title setting", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  await enableRunTitles(fixture.f);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await client.callTool({ name: "factory_get_run_title_setting", arguments: {} });

  // Assert
  expect(toolReply(result)).toMatchObject({
    enabled: true,
    model: controlledTitleModel,
    diagnostic: null,
  });
});

it("a session changes the title setting to a model T3 offers and the saved setting reads back", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const [provider] = fixture.t3.projects.controlledProviders;
  fixture.t3.projects.controlledProviders[0] = {
    ...provider!,
    models: [...provider!.models, { id: cheapTitleModel.modelId, label: "GPT 6.1 Luna" }],
  };
  await enableRunTitles(fixture.f);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const changed = await client.callTool({
    name: "factory_update_run_title_setting",
    arguments: { enabled: true, model: cheapTitleModel },
  });

  // Assert
  expect(changed.isError).toBe(false);
  expect(toolReply(changed)).toMatchObject({ enabled: true, model: cheapTitleModel });
  const saved = await fixture.f.getRunTitleSetting();
  assert(saved.ok);
  expect(saved.value).toMatchObject({ enabled: true, model: cheapTitleModel });
});

it("a session choice T3 does not offer returns the validation outcome and leaves the setting unchanged", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  await enableRunTitles(fixture.f);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await client.callTool({
    name: "factory_update_run_title_setting",
    arguments: {
      enabled: true,
      model: { ...cheapTitleModel, modelId: "gpt-9-unlisted" },
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  const reply = toolReply(result);
  expect(reply.code).toBe("validation");
  expect(reply.issues).toMatchObject([{ code: "model_unavailable", path: "model.modelId" }]);
  const saved = await fixture.f.getRunTitleSetting();
  assert(saved.ok);
  expect(saved.value.model).toStrictEqual(controlledTitleModel);
});

it("an update while T3's catalog cannot be read tells the session to retry once T3 is reachable", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, {
    ...fixture.f,
    updateRunTitleSetting: async () =>
      failure("validation", "Choose a provider instance and model T3 offers.", [
        { code: "capabilities_unavailable", path: "model", message: "T3 is offline." },
      ]),
  });

  // Act
  const result = await client.callTool({
    name: "factory_update_run_title_setting",
    arguments: { enabled: true, model: controlledTitleModel },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result).next).toContain("once T3 is reachable");
});

it("the update tool schema accepts a null model so a session can turn titles off without one", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const { tools } = await client.listTools();

  // Assert
  const update = tools.find((tool) => tool.name === "factory_update_run_title_setting");
  expect(update?.inputSchema.properties?.model).toMatchObject({ type: ["object", "null"] });
});
