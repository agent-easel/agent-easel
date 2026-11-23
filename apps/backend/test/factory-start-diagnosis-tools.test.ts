import { expect, it } from "@effect/vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FACTORY_BLOCK_SKILL } from "../src/factory-block-skill.ts";
import { prepared } from "./support/prepared-runner.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { assertOk } from "./support/domain-setup.ts";
import { projectWorkerFlow } from "./support/scenarios.ts";

const codexConfig = (fixture: Awaited<ReturnType<typeof prepared>>) =>
  join(fixture.h.processHome, "codex-home", "config.toml");

async function withoutReporting(c: Parameters<typeof prepared>[0]) {
  const fixture = await prepared(c);
  await writeFile(codexConfig(fixture), "");
  return { fixture, client: await factoryMcpClient(c, fixture.f) };
}

const checkStart = (
  client: Awaited<ReturnType<typeof factoryMcpClient>>,
  fixture: Awaited<ReturnType<typeof prepared>>,
) =>
  client.callTool({
    name: "factory_check_start",
    arguments: { projectId: fixture.project.id, flowId: fixture.flow.id },
  });

it("a preflight of a Flow whose harness lacks Factory reporting is blocked by the reporting installation and creates no Run", async (c) => {
  // Arrange
  const { fixture, client } = await withoutReporting(c);

  // Act
  const result = await checkStart(client, fixture);

  // Assert
  expect(result.isError).toBe(false);
  const reply = toolReply(result);
  expect(reply.status).toBe("blocked");
  expect(reply.blockers.map((blocker: { code: string }) => blocker.code)).toStrictEqual([
    "reporting_installation",
  ]);
  expect(reply.next).toMatch(/factory_list_reporting_installations/);
  expect(await fixture.f.listRuns(fixture.project.id)).toStrictEqual({ ok: true, value: [] });
});

it("a preflight of a ready Flow reports ready, creates no Run and says Start revalidates", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await checkStart(client, fixture);

  // Assert
  expect(result.isError).toBe(false);
  const reply = toolReply(result);
  expect(reply).toMatchObject({ status: "ready", blockers: [] });
  expect(reply.note).toMatch(/point-in-time/);
  expect(await fixture.f.listRuns(fixture.project.id)).toStrictEqual({ ok: true, value: [] });
});

it("a preflight while T3 is unreachable is blocked by the connection with the connection's state", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);
  fixture.t3.connection.available = false;

  // Act
  const result = await checkStart(client, fixture);

  // Assert
  const reply = toolReply(result);
  expect(reply.status).toBe("blocked");
  expect(reply.blockers.map((blocker: { code: string }) => blocker.code)).toStrictEqual([
    "project_connection",
  ]);
  expect(reply.connection.state).toBe("unavailable");
});

it("a preflight of a Flow another Project owns is blocked by ownership and creates no Run", async (c) => {
  // Arrange
  const fixture = await prepared(c, projectWorkerFlow);
  const other = assertOk(await fixture.f.addRepository({ path: "/repos/other" }));
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await client.callTool({
    name: "factory_check_start",
    arguments: { projectId: other.id, flowId: fixture.flow.id },
  });

  // Assert
  const reply = toolReply(result);
  expect(reply.status).toBe("blocked");
  expect(reply.blockers).toStrictEqual([
    { code: "flow_project_mismatch", path: "flowId", message: expect.any(String) },
  ]);
  expect(await fixture.f.listRuns(other.id)).toStrictEqual({ ok: true, value: [] });
});

it("a preflight without a Flow id is a validation error", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await client.callTool({
    name: "factory_check_start",
    arguments: { projectId: fixture.project.id },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    issues: [{ code: "invalid_argument", path: "flowId" }],
  });
});

it("the reporting listing names each target's status and the install action it offers", async (c) => {
  // Arrange
  const { fixture, client } = await withoutReporting(c);

  // Act
  const result = await client.callTool({
    name: "factory_list_reporting_installations",
    arguments: {},
  });

  // Assert
  expect(result.isError).toBe(false);
  const reply = toolReply(result);
  expect(reply.installations).toHaveLength(1);
  expect(reply.installations[0]).toMatchObject({
    provider: "codex",
    status: "not-installed",
    action: "install",
    path: expect.stringContaining("config.toml"),
  });
  expect(reply.installations[0].next).toMatch(/factory_install_reporting/);
  expect(await readFile(codexConfig(fixture), "utf8")).toBe("");
});

it("installing a listed target writes Factory MCP into its harness configuration and the next preflight is ready", async (c) => {
  // Arrange
  const { fixture, client } = await withoutReporting(c);
  const listed = toolReply(
    await client.callTool({ name: "factory_list_reporting_installations", arguments: {} }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_install_reporting",
    arguments: { targetId: listed.installations[0].id },
  });

  // Assert
  expect(result.isError).toBe(false);
  const reply = toolReply(result);
  expect(reply.installation).toMatchObject({ status: "installed", action: "none" });
  expect(reply.next).toMatch(/new agent session/i);
  expect(await readFile(codexConfig(fixture), "utf8")).toContain("[mcp_servers.factory-runtime]");
  expect(toolReply(await checkStart(client, fixture)).status).toBe("ready");
});

it("installing an unknown target id writes nothing", async (c) => {
  // Arrange
  const { fixture, client } = await withoutReporting(c);

  // Act
  const result = await client.callTool({
    name: "factory_install_reporting",
    arguments: { targetId: "not-a-listed-target" },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    message: "This target is not listed. Nothing was written.",
    issues: [{ path: "targetId" }],
  });
  expect(await readFile(codexConfig(fixture), "utf8")).toBe("");
});

it("installing an already installed target is refused and leaves its configuration untouched", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);
  const before = await readFile(codexConfig(fixture), "utf8");
  const listed = toolReply(
    await client.callTool({ name: "factory_list_reporting_installations", arguments: {} }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_install_reporting",
    arguments: { targetId: listed.installations[0].id },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    message: expect.stringContaining("Nothing to install or repair here."),
    issues: [{ path: "targetId" }],
  });
  expect(await readFile(codexConfig(fixture), "utf8")).toBe(before);
});

it("a connection recheck reports T3's current state", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);
  fixture.t3.connection.available = false;

  // Act
  const result = await client.callTool({
    name: "factory_get_t3_connection",
    arguments: { recheck: true },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toMatchObject({
    state: "unavailable",
    rechecked: true,
    endpoint: "http://127.0.0.1:3773/mcp",
  });
});

it("the connection read without a recheck keeps the connection as Factory last saw it", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);
  fixture.t3.connection.available = false;

  // Act
  const result = await client.callTool({ name: "factory_get_t3_connection", arguments: {} });

  // Assert
  expect(toolReply(result)).toMatchObject({ state: "ready", rechecked: false });
});

it("a connection that needs authorization is reported with the host's approval path and without its authorization context", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);
  fixture.t3.connection.authorized = false;

  // Act
  const result = await client.callTool({
    name: "factory_get_t3_connection",
    arguments: { recheck: true },
  });

  // Assert
  const reply = toolReply(result);
  expect(reply.state).toBe("authorization-required");
  expect(reply.next).toMatch(/approves T3 access on the Factory host/);
  expect(Object.keys(reply)).not.toContain("authorizationContext");
});

it("an outdated Factory skill is listed for repair, blocks the preflight and is restored by installing that target", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const skill = join(fixture.h.processHome, "codex-home", "skills", "factory-block", "SKILL.md");
  await writeFile(skill, "outdated");
  const client = await factoryMcpClient(c, fixture.f);
  const listed = toolReply(
    await client.callTool({ name: "factory_list_reporting_installations", arguments: {} }),
  );
  expect(listed.installations[0]).toMatchObject({ status: "needs-attention", action: "repair" });
  expect(toolReply(await checkStart(client, fixture)).status).toBe("blocked");

  // Act
  const result = await client.callTool({
    name: "factory_install_reporting",
    arguments: { targetId: listed.installations[0].id },
  });

  // Assert
  expect(toolReply(result).installation).toMatchObject({ status: "installed", action: "none" });
  expect(await readFile(skill, "utf8")).toBe(FACTORY_BLOCK_SKILL);
  expect(toolReply(await checkStart(client, fixture)).status).toBe("ready");
});
