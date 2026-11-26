import { assert, expect, it } from "@effect/vitest";
import type { TestContext } from "@effect/vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { factoryHarness } from "./support/factory.ts";
import { remoteServer } from "./support/remote-clients.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import { ControlledGit } from "./support/controlled-git.ts";

/** A fresh Factory home beside a disposable T3 state directory holding the given runtime file. */
async function freshHome(context: TestContext, runtimeFile?: string) {
  const harness = await factoryHarness(context);
  const state = join(harness.processHome, "t3-state");
  await mkdir(state);
  if (runtimeFile !== undefined) await writeFile(join(state, "server-runtime.json"), runtimeFile);
  const open = () =>
    harness.open({
      reportingStateDirectory: state,
      t3: new ControlledT3(),
      connectionRetryMs: 60_000,
    });
  return { harness, state, open };
}

const runtimeFile = (fields: Record<string, unknown>) =>
  JSON.stringify({
    version: 1,
    pid: 4242,
    host: "0.0.0.0",
    port: 3773,
    origin: "http://127.0.0.1:3773",
    startedAt: "2026-11-20T08:00:00.000Z",
    serverVersion: "0.1.11",
    ...fields,
  });

it("a running T3 Code's runtime file proposes its MCP address and version, and unknown fields do not matter", async (c) => {
  // Arrange
  const { open } = await freshHome(c, runtimeFile({ managedPolicy: null, extra: { nested: 1 } }));
  const factory = await open();

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  expect(setup).toStrictEqual({
    ok: true,
    value: {
      completed: false,
      detectedT3: { endpoint: "http://127.0.0.1:3773/mcp", serverVersion: "0.1.11" },
      harnessesOffInT3: [],
      reportingEligibility: expect.any(String),
    },
  });
});

it("a runtime file without a server version still proposes the address, with no version", async (c) => {
  // Arrange
  const { open } = await freshHome(c, runtimeFile({ serverVersion: undefined }));
  const factory = await open();

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  assert(setup.ok);
  expect(setup.value.detectedT3).toStrictEqual({
    endpoint: "http://127.0.0.1:3773/mcp",
    serverVersion: null,
  });
});

it.for([
  ["a missing file", undefined],
  ["a malformed file", "{not json"],
  ["a file of an unexpected shape", JSON.stringify(["http://127.0.0.1:3773"])],
  ["a file whose origin is not text", runtimeFile({ origin: 3773 })],
  ["a non-loopback HTTP origin", runtimeFile({ origin: "http://192.168.1.20:3773" })],
  ["an origin with credentials", runtimeFile({ origin: "https://user:secret@t3.example" })],
  ["an origin with a query", runtimeFile({ origin: "https://t3.example?token=secret" })],
  ["an origin with a path", runtimeFile({ origin: "http://127.0.0.1:3773/base" })],
  ["origin text the URL parser would repair", runtimeFile({ origin: "http://127.0.0.1:37\n73" })],
])("%s means no running T3 Code was found", async ([_name, contents], c) => {
  // Arrange
  const { open } = await freshHome(c, contents);
  const factory = await open();

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  expect(setup).toStrictEqual({
    ok: true,
    value: {
      completed: false,
      detectedT3: null,
      harnessesOffInT3: [],
      reportingEligibility: expect.any(String),
    },
  });
});

it("a runtime file in the overridden T3 Code state directory is the one detection reads", async (c) => {
  // Arrange
  const { harness, state } = await freshHome(c, runtimeFile({ origin: "http://127.0.0.1:4000" }));
  const other = join(harness.processHome, "other-state");
  await mkdir(other);
  await writeFile(
    join(other, "server-runtime.json"),
    runtimeFile({ origin: "http://127.0.0.1:5000" }),
  );
  const factory = await harness.open({
    reportingStateDirectory: other,
    t3: new ControlledT3(),
    connectionRetryMs: 60_000,
  });

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  assert(setup.ok);
  expect(state).not.toBe(other);
  expect(setup.value.detectedT3?.endpoint).toBe("http://127.0.0.1:5000/mcp");
});

it("installable harnesses T3 Code keeps off are named, by T3 Code's enablement rule", async (c) => {
  // Arrange
  const { state, open } = await freshHome(c);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: {
        claude: { driver: "claudeAgent", enabled: true, config: {} },
        cursor: { driver: "cursor", config: {} },
        grok: { driver: "grok", enabled: false, config: {} },
        "codex-work": { driver: "codex", enabled: false, config: {} },
        "codex-main": { driver: "codex", config: {} },
        pi: { driver: "pi", config: {} },
      },
    }),
  );
  const factory = await open();

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  assert(setup.ok);
  expect(setup.value.harnessesOffInT3).toStrictEqual(["cursor", "grok"]);
});

it("enabling and removing a project override for an omitted built-in driver changes reportingEligibility", async (c) => {
  // Arrange
  const { state, open } = await freshHome(c);
  await writeFile(join(state, "settings.json"), JSON.stringify({ providerInstances: {} }));
  const factory = await open();
  const initial = await factory.getFirstRunSetup();
  assert(initial.ok);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: {},
      projectSettingsOverrides: {
        "project-1": { providerInstances: { cursor: { enabled: true } } },
      },
    }),
  );

  // Act
  const overridden = await factory.getFirstRunSetup();

  // Assert
  assert(overridden.ok);
  expect(overridden.value.harnessesOffInT3).toStrictEqual([]);
  expect(overridden.value.reportingEligibility).not.toBe(initial.value.reportingEligibility);
});

it("recorded completion persists across a backend restart", async (c) => {
  // Arrange
  const { harness, open } = await freshHome(c);
  const first = await open();
  assert((await first.completeFirstRunSetup()).ok);
  await first.close();

  // Act
  const second = await open();

  // Assert
  expect(await second.getFirstRunSetup()).toStrictEqual({
    ok: true,
    value: {
      completed: true,
      detectedT3: null,
      harnessesOffInT3: [],
      reportingEligibility: expect.any(String),
    },
  });
  expect(harness.databasePath).toContain("factory.sqlite");
});

/** An approved client of a fresh host whose disposable T3 state directory holds a runtime file. */
async function approvedClientOfFreshHost(context: TestContext) {
  const { harness, state } = await freshHome(context, runtimeFile({}));
  const server = await remoteServer(context, {
    home: harness.processHome,
    t3: new ControlledT3(),
    git: new ControlledGit(),
    reportingStateDirectory: state,
  });
  return { server, laptop: await server.approved("Laptop") };
}

it("an approved client reads the host's setup status", async (c) => {
  // Arrange
  const { laptop } = await approvedClientOfFreshHost(c);

  // Act
  const read = await laptop.send("GET", "/api/setup");

  // Assert
  assert(read.body.ok);
  expect(read.body.value).toStrictEqual({
    completed: false,
    detectedT3: { endpoint: "http://127.0.0.1:3773/mcp", serverVersion: "0.1.11" },
    harnessesOffInT3: [],
    reportingEligibility: expect.any(String),
  });
});

it("an approved client cannot record completion, and setup stays incomplete", async (c) => {
  // Arrange
  const { server, laptop } = await approvedClientOfFreshHost(c);

  // Act
  const complete = await laptop.send("POST", "/api/setup/complete");

  // Assert
  expect(complete.status).toBe(403);
  assert(!complete.body.ok);
  expect(complete.body.error.code).toBe("host_only");
  const after = await server.factory.getFirstRunSetup();
  assert(after.ok);
  expect(after.value.completed).toBe(false);
});
