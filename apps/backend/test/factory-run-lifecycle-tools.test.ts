import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { startedRun } from "./support/chat-runs.ts";
import { woke, workerAtWork } from "./support/scenarios.ts";

type McpClient = Awaited<ReturnType<typeof factoryMcpClient>>;

const call = (client: McpClient, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

const readRun = (client: McpClient, run: string) => call(client, "factory_read_run", { run });

const listRuns = (client: McpClient, args: Record<string, unknown> = {}) =>
  call(client, "factory_list_runs", args);

const started = (fixture: Awaited<ReturnType<typeof prepared>>, requestId: string) =>
  startedRun(fixture, {
    requestId,
    title: requestId,
    createdAt: "2026-11-07T08:00:00.000Z",
  });

it("a session renames a Run by its number and later reads and lists show the new title", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "rename-me");
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await call(client, "factory_rename_run", {
    run: `#${run.number}`,
    title: "  Checkout fix  ",
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toMatchObject({
    run: { id: run.id, number: run.number, title: "Checkout fix", lifecycle: "active" },
    result: "renamed",
    untrustedTextNotice: expect.stringContaining("untrusted data"),
  });
  expect(toolReply(await readRun(client, run.id)).run.title).toBe("Checkout fix");
  expect(toolReply(await listRuns(client)).runs[0].title).toBe("Checkout fix");
});

it("a session snoozes a Run and restores it, and each reply states the resulting lifecycle", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "nap");
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const snoozed = await call(client, "factory_snooze_run", { run: run.id });
  const afterSnooze = toolReply(await readRun(client, run.id)).run.lifecycle;
  const restored = await call(client, "factory_restore_run", { run: run.id });

  // Assert
  expect(toolReply(snoozed)).toMatchObject({
    run: { lifecycle: "snoozed", woke: false },
    result: "snoozed",
  });
  expect(afterSnooze).toBe("snoozed");
  expect(toolReply(restored)).toMatchObject({
    run: { lifecycle: "active", woke: false },
    result: "restored",
  });
});

it("restoring a Woke Run that is not Snoozed reports unchanged and leaves its Woke mark", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const worker = await woke(fixture.world, await workerAtWork(fixture.world, fixture.input));
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await call(client, "factory_restore_run", { run: worker.runId });

  // Assert
  expect(toolReply(result)).toMatchObject({
    run: { lifecycle: "active", woke: true },
    result: "unchanged",
  });
  const navigation = await fixture.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]?.presentation).toStrictEqual({ snoozed: false, woke: true });
});

it("snoozing a Run that is already Snoozed reports unchanged", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "twice");
  const client = await factoryMcpClient(c, fixture.f);
  await call(client, "factory_snooze_run", { run: run.id });

  // Act
  const result = await call(client, "factory_snooze_run", { run: run.id });

  // Assert
  expect(toolReply(result)).toMatchObject({
    run: { lifecycle: "snoozed", woke: false },
    result: "unchanged",
  });
});

it("restoring a Run that is not Snoozed is reported as unchanged", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "awake");
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await call(client, "factory_restore_run", { run: run.id });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toMatchObject({
    run: { lifecycle: "active" },
    result: "unchanged",
  });
});

it("Settle asks for confirmation before sending any Stop, then stop-and-settle ends with the Run Settled", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const worker = await workerAtWork(fixture.world, fixture.input);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const first = await call(client, "factory_settle_run", { run: worker.runId });
  const stopsAfterFirst = fixture.t3.threads.threadStops.length;
  const second = await call(client, "factory_settle_run", {
    run: worker.runId,
    stopWorkers: true,
  });
  const whileStopping = toolReply(await readRun(client, worker.runId));
  fixture.t3.threads.stopsEndThreads();
  assert((await fixture.f.reconcileRuns()).ok);
  const settled = toolReply(await readRun(client, worker.runId));

  // Assert
  expect(first.isError).toBe(false);
  expect(toolReply(first)).toMatchObject({
    result: "confirmation-required",
    run: { lifecycle: "active", settlement: null },
    workers: [{ blockName: "Entry worker", state: "executing" }],
  });
  expect(toolReply(first).next).toContain("stopWorkers");
  expect(stopsAfterFirst).toBe(0);
  expect(toolReply(second)).toMatchObject({
    result: "stopping",
    run: { lifecycle: "active", settlement: "stopping" },
  });
  expect(toolReply(second).next).toContain("factory_read_run");
  expect(whileStopping.run.settlement).toBe("stopping");
  expect(settled.run).toMatchObject({ lifecycle: "settled", settlement: null });
});

it("Settle on a finished Run settles it, and a repeat says it was already Settled", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "finish");
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const first = await call(client, "factory_settle_run", { run: run.id });
  const repeat = await call(client, "factory_settle_run", { run: run.id });

  // Assert
  expect(toolReply(first)).toMatchObject({ result: "settled", run: { lifecycle: "settled" } });
  expect(toolReply(repeat)).toMatchObject({
    result: "already-settled",
    run: { lifecycle: "settled" },
  });
  expect(toolReply(repeat).message).toContain("already Settled");
});

it("Archive says what it did, and a repeat says the Run was already Archived but stays readable by number", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "archive-me");
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const first = await call(client, "factory_archive_run", { run: run.id });
  const repeat = await call(client, "factory_archive_run", { run: `#${run.number}` });

  // Assert
  expect(toolReply(first)).toMatchObject({
    result: "archived",
    run: { lifecycle: "archived" },
  });
  expect(toolReply(repeat)).toMatchObject({
    result: "already-archived",
    run: { lifecycle: "archived" },
  });
  expect(toolReply(repeat).message).toContain("already Archived");
  expect(toolReply(await readRun(client, `#${run.number}`)).run.lifecycle).toBe("archived");
});

it("Rename on an Archived Run is refused as a conflict with a next step", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "old");
  assert((await fixture.f.archiveRun(run.id)).ok);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await call(client, "factory_rename_run", { run: run.id, title: "New name" });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "conflict",
    message: "An Archived Run cannot be renamed.",
    next: expect.any(String),
  });
  expect(toolReply(await readRun(client, run.id)).run.title).toBe("old");
});

it.for([
  { tool: "factory_snooze_run", message: "Only Active Runs can be snoozed or restored." },
  { tool: "factory_restore_run", message: "Only Active Runs can be snoozed or restored." },
])("$tool on a Settled Run is refused with the existing conflict", async ({ tool, message }, c) => {
  // Arrange
  const fixture = await prepared(c);
  const run = await started(fixture, "done");
  assert((await fixture.f.settleRun(run.id, {})).ok);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const result = await call(client, tool, { run: run.id });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({ code: "conflict", message, next: expect.any(String) });
});

it.for(["factory_snooze_run", "factory_settle_run", "factory_restore_run"])(
  "%s on an Archived Run is refused as a conflict",
  async (tool, c) => {
    // Arrange
    const fixture = await prepared(c);
    const run = await started(fixture, "gone");
    assert((await fixture.f.archiveRun(run.id)).ok);
    const client = await factoryMcpClient(c, fixture.f);

    // Act
    const result = await call(client, tool, { run: run.id });

    // Assert
    expect(result.isError).toBe(true);
    expect(toolReply(result)).toMatchObject({ code: "conflict", next: expect.any(String) });
  },
);

it.for([
  { tool: "factory_rename_run", args: { run: "#9999", title: "Name" } },
  { tool: "factory_snooze_run", args: { run: "#9999" } },
  { tool: "factory_restore_run", args: { run: "#9999" } },
  { tool: "factory_settle_run", args: { run: "#9999" } },
  { tool: "factory_archive_run", args: { run: "#9999" } },
])(
  "$tool with an unknown Run points to factory_list_runs without echoing the reference",
  async ({ tool, args }, c) => {
    // Arrange
    const fixture = await prepared(c);
    const client = await factoryMcpClient(c, fixture.f);

    // Act
    const result = await call(client, tool, args);

    // Assert
    expect(result.isError).toBe(true);
    const reply = toolReply(result);
    expect(reply.code).toBe("not_found");
    expect(reply.next).toContain("factory_list_runs");
    expect(JSON.stringify(reply)).not.toContain("9999");
  },
);

it.for([
  {
    caseName: "a Rename without a title",
    tool: "factory_rename_run",
    args: { run: "1" },
    path: "title",
  },
  {
    caseName: "a Rename with a blank title",
    tool: "factory_rename_run",
    args: { run: "1", title: "   " },
    path: "title",
  },
  {
    caseName: "a blank run",
    tool: "factory_archive_run",
    args: { run: " " },
    path: "run",
  },
  {
    caseName: "a stopWorkers that is not a boolean",
    tool: "factory_settle_run",
    args: { run: "1", stopWorkers: "yes" },
    path: "stopWorkers",
  },
  {
    caseName: "an unsupported argument name",
    tool: "factory_snooze_run",
    args: { run: "1", PRIVATE_KEY: "PRIVATE_VALUE" },
    path: "arguments",
  },
])(
  "$caseName is refused as a validation error naming its path",
  async ({ tool, args, path }, c) => {
    // Arrange
    const fixture = await prepared(c);
    await started(fixture, "valid");
    const client = await factoryMcpClient(c, fixture.f);

    // Act
    const result = await call(client, tool, args);

    // Assert
    expect(result.isError).toBe(true);
    const reply = toolReply(result);
    expect(reply.code).toBe("validation");
    expect(reply.issues.map((issue: { path: string }) => issue.path)).toStrictEqual([path]);
    expect(reply.next).toContain(tool);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  },
);

it("the lifecycle tools follow the read tools in tools/list, and their descriptions state consequences", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const client = await factoryMcpClient(c, fixture.f);

  // Act
  const { tools } = await client.listTools();

  // Assert
  const names = tools.map((tool) => tool.name);
  expect(names.slice(names.indexOf("factory_read_run"))).toStrictEqual([
    "factory_read_run",
    "factory_rename_run",
    "factory_snooze_run",
    "factory_restore_run",
    "factory_settle_run",
    "factory_archive_run",
    ...names.slice(names.indexOf("factory_archive_run") + 1),
  ]);
  const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
  expect(description("factory_archive_run")).toContain("cannot be undone");
  expect(description("factory_archive_run")).toContain("decisive instruction");
  expect(description("factory_settle_run")).toContain("without stopWorkers first");
  expect(description("factory_settle_run")).toContain("decisive instruction");
  const lifecycle = [
    "factory_rename_run",
    "factory_snooze_run",
    "factory_restore_run",
    "factory_settle_run",
    "factory_archive_run",
  ].map(description);
  expect(lifecycle.join("\n")).not.toMatch(/inspect-only|changes nothing|while T3 Code is offline/);
});
