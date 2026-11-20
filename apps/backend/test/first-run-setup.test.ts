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

it("a running T3's runtime file proposes its MCP address and version, and unknown fields do not matter", async (c) => {
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
])("%s means no running T3 was found", async ([_name, contents], c) => {
  // Arrange
  const { open } = await freshHome(c, contents);
  const factory = await open();

  // Act
  const setup = await factory.getFirstRunSetup();

  // Assert
  expect(setup).toStrictEqual({ ok: true, value: { completed: false, detectedT3: null } });
});

it("a runtime file in the overridden T3 state directory is the one detection reads", async (c) => {
  // Arrange
  const { harness, state } = await freshHome(c, runtimeFile({ origin: "http://127.0.0.1:4000" }));
  const other = join(harness.processHome, "other-state");
  await mkdir(other);
  await writeFile(
    join(other, "server-runtime.json"),
    runtimeFile({ origin: "http://127.0.0.1:5000" }),
  );

  // Act
  const factory = await harness.open({
    reportingStateDirectory: other,
    t3: new ControlledT3(),
    connectionRetryMs: 60_000,
  });
  const setup = await factory.getFirstRunSetup();

  // Assert
  assert(setup.ok);
  expect(state).not.toBe(other);
  expect(setup.value.detectedT3?.endpoint).toBe("http://127.0.0.1:5000/mcp");
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
    value: { completed: true, detectedT3: null },
  });
  expect(harness.databasePath).toContain("factory.sqlite");
});

it("an approved client reads the setup status but cannot record completion", async (c) => {
  // Arrange
  const server = await remoteServer(c, { t3: new ControlledT3(), git: new ControlledGit() });
  const laptop = await server.approved("Laptop");

  // Act
  const read = await laptop.send("GET", "/api/setup");
  const complete = await laptop.send("POST", "/api/setup/complete");

  // Assert
  assert(read.body.ok);
  expect(read.body.value).toMatchObject({ completed: false });
  expect(complete.status).toBe(403);
  assert(!complete.body.ok);
  expect(complete.body.error.code).toBe("host_only");
  const after = await server.factory.getFirstRunSetup();
  assert(after.ok);
  expect(after.value.completed).toBe(false);
});
