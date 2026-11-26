import { assert, expect, it } from "@effect/vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiagnosticAttemptPage, T3ConnectionRecovery } from "@agent-easel/contracts";
import { validateDiagnosticEntry } from "@agent-easel/domain-validation";
import { remoteServer } from "./support/remote-clients.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import {
  diagnosticHome,
  recordingHome,
  runtimeFile,
  throwingRecorder,
} from "./support/diagnostic-log.ts";
import { shiftedClock } from "./support/seed-clock.ts";

it("a failed connection recheck returns its attempt and exports the reason without the endpoint", async (c) => {
  // Arrange
  const t3 = new ControlledT3();
  const server = await remoteServer(c, { t3 });
  const client = await server.approved("Laptop");
  const endpoint = "https://private-device.example/mcp";
  t3.connection.available = false;
  assert((await server.factory.configureConnection({ endpoint })).ok);
  assert((await server.factory.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const recheck = await server.host<T3ConnectionRecovery>("POST", "/api/connection/recheck");

  // Assert
  expect(recheck.body).toMatchObject({
    ok: true,
    value: { state: "unavailable", diagnosticAttemptIds: [expect.any(String)] },
  });
  assert(recheck.body.ok);
  const ids = recheck.body.value.diagnosticAttemptIds?.join(",");
  assert(ids);
  const filtered = await server.host<DiagnosticAttemptPage>(
    "GET",
    `/api/settings/diagnostics/attempts?cursor=&limit=20&ids=${encodeURIComponent(ids)}`,
  );
  expect(filtered.body).toMatchObject({
    ok: true,
    value: { attempts: [{ id: ids, operation: "t3_connection" }] },
  });
  const reply = await client.sendBytes("GET", "/api/settings/diagnostics/export");
  const exported = reply.data.toString("utf8");
  expect(exported).toContain("Check T3 Code connection");
  expect(exported).toContain("non-loopback");
  expect(exported).toContain("t3_unavailable");
  expect(exported).not.toContain("private-device.example");
  expect(exported).not.toContain("External failure containing secret material");
});

it("an unexpected inspection exception leaves the connection unavailable and exports only its step", async (c) => {
  // Arrange
  const t3 = new ControlledT3();
  const server = await remoteServer(c, { t3 });
  assert((await server.factory.configureConnection({ endpoint: "http://127.0.0.1:0/mcp" })).ok);
  assert((await server.factory.setDiagnosticRecording({ enabled: true })).ok);
  t3.contract.beforeInspection = () => {
    throw new Error("private inspection exception");
  };

  // Act
  const recheck = await server.factory.recheckConnection();

  // Assert
  expect(recheck).toMatchObject({ ok: true, value: { state: "unavailable" } });
  const exported = await server.factory.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toContain("Unexpected error during T3 Code connection check");
  expect(exported.value).toContain("unexpected_error");
  expect(exported.value).not.toContain("private inspection exception");
});

it("a diagnostic entry carrying a field outside its allowlist is refused", () => {
  // Arrange
  const entry = {
    type: "t3_detection",
    outcome: "ok",
    reason: "runtime_file_found",
    file: "<T3_STATE>/server-runtime.json",
    host: "loopback",
    t3Version: "0.1.11",
    origin: "http://127.0.0.1:3773",
  };

  // Act
  const result = validateDiagnosticEntry(entry);

  // Assert
  assert(!result.ok);
  expect(result.error.message).toBe("A t3_detection entry has no origin field.");
});

it("nothing is recorded while recording is off", async (c) => {
  // Arrange
  const factory = await (await diagnosticHome(c)).open();

  // Act
  const setup = await factory.getFirstRunSetup("");

  // Assert
  assert(setup.ok);
  expect(await factory.getDiagnosticLog()).toStrictEqual({
    ok: true,
    value: { enabled: false, until: null, hasEntries: false, dropped: 0 },
  });
});

it("while recording, T3 Code detection is recorded as a redacted attempt with its environment", async (c) => {
  // Arrange
  const { factory } = await recordingHome(c);

  // Act
  const setup = await factory.getFirstRunSetup("");

  // Assert
  assert(setup.ok);
  const page = await factory.listDiagnosticAttempts("", "", "");
  assert(page.ok);
  expect(page.value.attempts).toMatchObject([
    {
      operation: "t3_detection",
      outcome: "ok",
      truncated: false,
      environment: { applicationVersion: "source", mode: "source", installation: /^[0-9a-f]{8}$/ },
      entries: [
        {
          entry: {
            type: "t3_detection",
            outcome: "ok",
            reason: "runtime_file_found",
            file: "<T3_STATE>/server-runtime.json",
            host: "loopback",
            t3Version: "0.1.11",
          },
        },
      ],
    },
  ]);
});

it("an unchanged First-run poll returns the setup status without adding another detection attempt", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const client = await server.approved("Laptop");
  assert((await server.factory.setDiagnosticRecording({ enabled: true })).ok);
  const first = await client.send("GET", "/api/setup?poll=1");
  expect(first.status).toBe(200);

  // Act
  const second = await client.send("GET", "/api/setup?poll=1");

  // Assert
  expect(second).toEqual(first);
  const page = await server.factory.listDiagnosticAttempts("", "", "");
  assert(page.ok);
  expect(page.value.attempts).toMatchObject([{ operation: "t3_detection" }]);
});

it("a First-run poll records the new result when T3 Code detection changes", async (c) => {
  // Arrange
  const { factory, state } = await recordingHome(c);
  assert((await factory.getFirstRunSetup("1")).ok);
  await writeFile(join(state, "server-runtime.json"), runtimeFile({ serverVersion: "0.1.12" }));

  // Act
  const status = await factory.getFirstRunSetup("1");

  // Assert
  assert(status.ok);
  expect(status.value.detectedT3?.serverVersion).toBe("0.1.12");
  const page = await factory.listDiagnosticAttempts("", "", "");
  assert(page.ok);
  expect(page.value.attempts).toMatchObject([
    { entries: [{ entry: { t3Version: "0.1.12" } }] },
    { entries: [{ entry: { t3Version: "0.1.11" } }] },
  ]);
});

it("a poll can record the same First-run detection again after the log is deleted", async (c) => {
  // Arrange
  const { factory } = await recordingHome(c);
  assert((await factory.getFirstRunSetup("1")).ok);
  assert((await factory.deleteDiagnosticLog()).ok);

  // Act
  await factory.getFirstRunSetup("1");

  // Assert
  const page = await factory.listDiagnosticAttempts("", "", "");
  assert(page.ok);
  expect(page.value.attempts).toMatchObject([{ operation: "t3_detection" }]);
});

it("an explicit First-run status check records a detection even when a previous poll saw it", async (c) => {
  // Arrange
  const { factory } = await recordingHome(c);
  assert((await factory.getFirstRunSetup("1")).ok);

  // Act
  const setup = await factory.getFirstRunSetup("");

  // Assert
  assert(setup.ok);
  const page = await factory.listDiagnosticAttempts("", "", "");
  assert(page.ok);
  expect(page.value.attempts).toMatchObject([
    { operation: "t3_detection" },
    { operation: "t3_detection" },
  ]);
});

it("the export of a refused runtime file names its reason but never its credentials, host or state path", async (c) => {
  // Arrange
  const { factory, state } = await recordingHome(
    c,
    runtimeFile({ origin: "https://owner-name:secret-canary@t3.example" }),
  );
  assert((await factory.getFirstRunSetup("")).ok);

  // Act
  const exported = await factory.exportDiagnosticLog();

  // Assert
  assert(exported.ok);
  expect(exported.value).toContain("runtime_origin_invalid");
  expect(exported.value).not.toContain("secret-canary");
  expect(exported.value).not.toContain("owner-name");
  expect(exported.value).not.toContain("t3.example");
  expect(exported.value).not.toContain(state);
});

it("recording turns itself off 24 hours after it was turned on, across a restart, and keeps what it recorded", async (c) => {
  // Arrange
  const home = await diagnosticHome(c);
  const first = await home.open();
  assert((await first.setDiagnosticRecording({ enabled: true })).ok);
  assert((await first.getFirstRunSetup("")).ok);
  await first.close();

  // Act
  const reopened = await home.open({ clock: shiftedClock(() => 25 * 60 * 60 * 1000) });

  // Assert
  expect(await reopened.getDiagnosticLog()).toStrictEqual({
    ok: true,
    value: { enabled: false, until: null, hasEntries: true, dropped: 0 },
  });
});

it("a recorder that fails during detection leaves the detection outcome unchanged and counts the drop", async (c) => {
  // Arrange
  const factory = await (await diagnosticHome(c)).open({ diagnosticRecorder: throwingRecorder });
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const setup = await factory.getFirstRunSetup("");

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
  const status = await factory.getDiagnosticLog();
  assert(status.ok);
  expect(status.value.dropped).toBeGreaterThan(0);
});

it("Delete clears the log at once while recording stays on", async (c) => {
  // Arrange
  const { factory } = await recordingHome(c);
  assert((await factory.getFirstRunSetup("")).ok);

  // Act
  const deleted = await factory.deleteDiagnosticLog();

  // Assert
  expect(deleted).toMatchObject({ ok: true, value: { enabled: true, hasEntries: false } });
  expect(await factory.listDiagnosticAttempts("", "", "")).toStrictEqual({
    ok: true,
    value: { attempts: [], nextCursor: null },
  });
});

it.for([
  ["status", "/api/settings/diagnostics"],
  ["attempts", "/api/settings/diagnostics/attempts?limit=5"],
] as const)(
  "an approved remote client reads the host's Diagnostic log %s, never cached",
  async ([, path], c) => {
    // Arrange
    const server = await remoteServer(c);
    const laptop = await server.approved("Laptop");

    // Act
    const reply = await laptop.send("GET", path);

    // Assert
    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(reply.headers["cache-control"]).toBe("no-store");
  },
);

it("an approved remote client exports the host's whole Diagnostic log as text", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const laptop = await server.approved("Laptop");

  // Act
  const reply = await laptop.sendBytes("GET", "/api/settings/diagnostics/export");

  // Assert
  expect(reply.status).toBe(200);
  expect(reply.data.toString("utf8")).toContain("## AgentEasel Diagnostic log");
});

it.for([
  ["turn recording on", "PUT", { enabled: true }],
  ["delete the log", "DELETE", undefined],
] as const)(
  "an approved remote client cannot %s: the host alone changes the Diagnostic log",
  async ([, method, body], c) => {
    // Arrange
    const server = await remoteServer(c);
    const laptop = await server.approved("Laptop");

    // Act
    const reply = await laptop.send(method, "/api/settings/diagnostics", body);

    // Assert
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ ok: false, error: { code: "host_only" } });
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(await server.factory.getDiagnosticLog()).toMatchObject({
      ok: true,
      value: { enabled: false },
    });
  },
);
