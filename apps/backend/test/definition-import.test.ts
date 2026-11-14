import { assert, expect, it } from "@effect/vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@t3-factory/contracts";
import { loadConfiguration } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import {
  agentFile,
  exportedAgent,
  factoryFailingImportReceipts,
  fileBody,
  reviewedCommit,
} from "./support/definition-import.ts";
import { assertOk, openFactoryWithApprovedT3 } from "./support/domain-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import { controlledExecution } from "./support/scenarios.ts";

it("a file that is not JSON is rejected as not JSON and nothing is created", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody('{"format": "t3-factory/definitions",'));

  // Assert
  assert(!review.ok);
  expect(review.error.code).toBe("validation");
  expect(review.error.issues).toStrictEqual([
    { code: "not_json", path: "document", message: expect.any(String) },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("JSON without the Factory marker is rejected as not a Factory export", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent(), { format: "x" })));

  // Assert
  assert(!review.ok);
  expect(review.error.issues.map((issue) => issue.code)).toStrictEqual(["not_factory_export"]);
});

it("a newer format version is rejected before its definitions are read and asks to update Factory", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(
    fileBody(agentFile({ unreadable: true }, { formatVersion: 2 })),
  );

  // Assert
  assert(!review.ok);
  expect(review.error.issues).toStrictEqual([
    {
      code: "unsupported_format_version",
      path: "formatVersion",
      message:
        "This file uses format version 2, which this Factory cannot read. Update Factory to import it.",
    },
  ]);
});

it("an invalid definition is rejected at its field, naming the Agent without echoing its prompt", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const prompt = "secret instructions ".repeat(6_001);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ prompt }))));

  // Assert
  assert(!review.ok);
  expect(review.error).toStrictEqual({
    code: "validation",
    message: 'Agent "Code reviewer": Enter a prompt up to 120,000 characters.',
    issues: [
      {
        code: "invalid_prompt",
        path: "agents.0.prompt",
        message: 'Agent "Code reviewer": Enter a prompt up to 120,000 characters.',
      },
    ],
  });
});

it("a file bundling more than 500 Agents is refused as over the limit", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const agents = Array.from({ length: 501 }, (_, index) => exportedAgent({ key: `a${index}` }));

  // Act
  const review = await factory.reviewImport(fileBody({ ...agentFile(), agents }));

  // Assert
  assert(!review.ok);
  expect(review.error.code).toBe("too_large");
  expect(review.error.issues.map((issue) => issue.code)).toStrictEqual(["too_many_agents"]);
});

it("an import request over 16 MiB is refused with HTTP 413", async (c) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), "t3-factory-server-"));
  c.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const config = await loadConfiguration({ FACTORY_HOME: directory, FACTORY_PORT: "0" });
  const server = await startServer(config, { uiDirectory: null });
  c.onTestFinished(() => server.close());

  // Act
  const response = await fetch(`http://127.0.0.1:${server.address.port}/api/imports/review`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: " ".repeat(16_777_217),
  });

  // Assert
  expect(response.status).toBe(413);
  const body = (await response.json()) as Result<unknown>;
  assert(!body.ok);
  expect(body.error.code).toBe("too_large");
});

it("reviewing a file shows its instruction inventory and hint with Needs a model and writes nothing", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile()));

  // Assert
  assert(review.ok);
  expect(review.value).toMatchObject({
    kind: "agent",
    agents: [
      {
        key: "agent-1",
        name: "Code reviewer",
        promptLength: exportedAgent().prompt.length,
        exitCount: 2,
        hint: exportedAgent().model,
        proposed: null,
      },
    ],
    capabilities: { state: "ready" },
  });
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("a commit creates a new Agent at revision 1 with its exact name and exactly the reviewed selection", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const execution = controlledExecution(undefined, {
    modelOptions: [{ id: "reasoning", value: "low" }],
  });

  // Act
  const committed = await factory.commitImport(reviewedCommit("import-1", execution));

  // Assert
  assert(committed.ok);
  const [created] = committed.value.agents;
  expect(created?.key).toBe("agent-1");
  expect(assertOk(await factory.getAgent(created!.id))).toMatchObject({
    name: "Code reviewer",
    prompt: exportedAgent().prompt,
    revision: 1,
    execution,
    exits: exportedAgent().exits,
  });
});

it("with T3 disconnected a commit still saves the reviewed selection", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const committed = await factory.commitImport(reviewedCommit());

  // Assert
  assert(committed.ok);
  expect(assertOk(await factory.getAgent(committed.value.agents[0]!.id)).execution).toStrictEqual(
    controlledExecution(),
  );
});

it("a selection whose provider has no Factory reporting rejects the whole commit and names the Agent", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  t3.controlledProviders.push({
    ...t3.controlledProviders[0]!,
    providerInstanceId: "future-main",
    driverKind: "future",
  });
  const execution = controlledExecution(undefined, { providerInstanceId: "future-main" });

  // Act
  const committed = await factory.commitImport(reviewedCommit("import-1", execution));

  // Assert
  assert(!committed.ok);
  expect(committed.error.issues).toStrictEqual([
    {
      code: "harness_unsupported",
      path: "selections.agent-1.providerInstanceId",
      message: expect.stringMatching(/^Agent "Code reviewer": /),
    },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("a commit that fails after creating its Agent rolls back and leaves no Agent", async (context) => {
  // Arrange
  const factory = await factoryFailingImportReceipts(context);

  // Act
  const committed = await factory.commitImport(reviewedCommit());

  // Assert
  assert(!committed.ok);
  expect(committed.error.code).toBe("internal");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("retrying a commit with the same request id and content returns the original result without a copy", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const first = assertOk(await factory.commitImport(reviewedCommit()));

  // Act
  const retried = await factory.commitImport(reviewedCommit());

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: first });
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("a commit reusing a request id with different selections conflicts and creates nothing", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  assertOk(await factory.commitImport(reviewedCommit()));

  // Act
  const changed = await factory.commitImport({
    ...reviewedCommit(),
    selections: { "agent-1": null },
  });

  // Assert
  assert(!changed.ok);
  expect(changed.error.code).toBe("conflict");
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("after restart and removal of the imported Agent a retried commit replays its receipt without T3 and recreates nothing", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const factory = await harness.open({ t3: new ControlledT3() });
  const first = assertOk(await factory.commitImport(reviewedCommit()));
  assertOk(await factory.removeAgent(first.agents[0]!.id));
  await factory.close();
  const reopened = await harness.open({ t3: new ControlledT3() });

  // Act
  const retried = await reopened.commitImport(reviewedCommit());

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: first });
  expect(await reopened.listAgents()).toStrictEqual({ ok: true, value: [] });
});
