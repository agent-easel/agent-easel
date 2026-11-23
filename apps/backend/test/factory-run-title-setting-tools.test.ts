import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { cheapTitleModel, controlledTitleModel, enableRunTitles } from "./support/scenarios.ts";

it("a session reads the current title setting and changes it to a model T3 offers, and Settings and later Starts see the saved value", async (c) => {
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
  const before = await client.callTool({ name: "factory_get_run_title_setting", arguments: {} });
  const changed = await client.callTool({
    name: "factory_update_run_title_setting",
    arguments: { enabled: true, model: cheapTitleModel },
  });

  // Assert
  expect(toolReply(before)).toMatchObject({
    enabled: true,
    model: controlledTitleModel,
    diagnostic: null,
  });
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
