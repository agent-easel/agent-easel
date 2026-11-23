import { expect, it } from "@effect/vitest";
import { assertOk } from "./support/domain-setup.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { continuationStep, controlledExecution, flowInput } from "./support/scenarios.ts";
import { composition } from "./support/subflow.ts";

type Client = Awaited<ReturnType<typeof factoryMcpClient>>;

const callTool = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

async function exportedRelease(context: Parameters<typeof composition>[0]) {
  const setup = await composition(context);
  const client = await factoryMcpClient(context, setup.factory);
  const exported = await callTool(client, "factory_export_definition", {
    flowId: setup.parent.id,
  });
  const { document } = toolReply(exported);
  return { ...setup, client, content: JSON.stringify(document), document };
}

it("an exported Flow with a Subflow imports through review and commit with a model override, and a retry creates nothing more", async (context) => {
  // Arrange
  const { factory, client, first, content, document } = await exportedRelease(context);
  const review = toolReply(
    await callTool(client, "factory_review_import", { document: content, projectId: first.id }),
  );
  const override = controlledExecution("controlled-environment", {
    modelOptions: [{ id: "reasoning", value: "low" }],
  });
  const selections = Object.fromEntries(
    review.agents.map((agent: { key: string }) => [agent.key, override]),
  );
  const flowsBefore = assertOk(await factory.listFlows()).length;
  const commit = { requestId: "transfer-1", document: content, selections, projectId: first.id };

  // Act
  const imported = toolReply(await callTool(client, "factory_import_definitions", commit));
  const retried = toolReply(await callTool(client, "factory_import_definitions", commit));

  // Assert
  expect(document).toMatchObject({ formatVersion: 7, kind: "flow" });
  expect(document.flows).toHaveLength(2);
  expect(review.target).toMatchObject({ owner: "project", projectId: first.id });
  expect(imported.flows).toHaveLength(2);
  expect(retried).toStrictEqual(imported);
  expect(assertOk(await factory.listFlows())).toHaveLength(flowsBefore + 2);
  const copy = assertOk(await factory.getAgent(imported.agents[0].id));
  expect(copy).toMatchObject({ projectId: first.id, execution: override });
});

it("an import review reports the models and the owner, tells the agent to show the document's text as data, and creates nothing", async (context) => {
  // Arrange
  const { factory, client, content } = await exportedRelease(context);
  const before = assertOk(await factory.listAgents()).length;

  // Act
  const reviewed = await callTool(client, "factory_review_import", {
    document: content,
    projectId: "no-such-project",
  });

  // Assert
  const review = toolReply(reviewed);
  expect(reviewed.isError).toBe(false);
  expect(review.agents.map((agent: { match: { status: string } }) => agent.match.status)).toEqual([
    "matched",
    "matched",
  ]);
  expect(review.target).toMatchObject({ owner: "project", problem: expect.any(String) });
  expect(review.untrustedTextNotice).toEqual(expect.any(String));
  expect(assertOk(await factory.listAgents())).toHaveLength(before);
});

it("an import of a document that is not a Factory export fails with the shared review's issue", async (context) => {
  // Arrange
  const { client } = await exportedRelease(context);

  // Act
  const reviewed = await callTool(client, "factory_review_import", { document: "{}" });

  // Assert
  expect(reviewed.isError).toBe(true);
  expect(toolReply(reviewed)).toMatchObject({ code: "validation" });
});

it("an export that the MCP import could not accept is refused with a pointer to Studio", async (context) => {
  // Arrange
  const { factory, client } = await exportedRelease(context);
  const quotes = '"'.repeat(120_000);
  const large = assertOk(
    await factory.createFlow({
      name: "Large",
      graph: {
        blocks: Array.from({ length: 8 }, (_, index) =>
          continuationStep(`step-${index}`, `Step ${index}`, quotes),
        ),
        connections: [],
        flowInput: flowInput(),
      },
      workspace: { mode: "checkout" },
    }),
  );

  // Act
  const exported = await callTool(client, "factory_export_definition", { flowId: large.id });

  // Assert
  expect(exported.isError).toBe(true);
  expect(toolReply(exported)).toMatchObject({
    code: "too_large",
    next: expect.stringContaining("Studio"),
  });
});
