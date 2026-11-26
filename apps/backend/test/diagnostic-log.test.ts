import { assert, expect, it } from "@effect/vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import type {
  DiagnosticAttemptPage,
  DiagnosticEntry,
  T3ConnectionRecovery,
} from "@agent-easel/contracts";
import { diagnosticPath, validateDiagnosticEntry } from "@agent-easel/domain-validation";
import { remoteServer } from "./support/remote-clients.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import {
  diagnosticHome,
  diagnosticPruneRefused,
  diagnosticStateMissing,
  diagnosticStore,
  entriesAtCapacity,
  projectStorageRefused,
  recordingConnection,
  recordingHome,
  runtimeFile,
  throwingRecorder,
} from "./support/diagnostic-log.ts";
import { shiftedClock } from "./support/seed-clock.ts";

const HOUR = 60 * 60 * 1000;
const installTarget: DiagnosticEntry = {
  type: "install_target",
  outcome: "ok",
  driver: "claudeAgent",
  reason: "target_found",
};
const deniedWrite: DiagnosticEntry = {
  type: "install_write",
  outcome: "failed",
  driver: "claudeAgent",
  write: "config",
  skill: null,
  reason: "permission_denied",
  file: "~/.claude.json",
};

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

it("an approved browser exports the host's whole Diagnostic log without application headers", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const laptop = await server.approved("Laptop", "browser");

  // Act
  const reply = await laptop.asset("/api/settings/diagnostics/export");

  // Assert
  expect(reply.status).toBe(200);
  expect(reply.contentType).toBe("text/plain; charset=utf-8");
  expect(reply.cacheControl).toBe("no-store");
  expect(reply.data.toString("utf8")).toContain("## AgentEasel Diagnostic log");
});

it("an unapproved browser cannot export the host's Diagnostic log", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const browser = server.client("browser");

  // Act
  const reply = await browser.asset("/api/settings/diagnostics/export");

  // Assert
  expect(reply.status).toBe(401);
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

it("a configured home's own folder names are recorded as redacted, keeping only known path labels", () => {
  // Arrange
  const roots = [{ root: "/Users/owner", placeholder: "~" as const }];

  // Act
  const recorded = diagnosticPath("/Users/owner/profiles/alice.smith/.claude.json", roots);

  // Assert
  expect(recorded).toBe("~/<REDACTED>/.claude.json");
});

it("a diagnostic entry whose path keeps an unrecognized folder name is refused", () => {
  // Arrange
  const entry = { ...deniedWrite, file: "~/profiles/alice.smith/.claude.json" };

  // Act
  const result = validateDiagnosticEntry(entry);

  // Assert
  assert(!result.ok);
  expect(result.error.message).toBe("A install_write entry needs a valid file.");
});

it.effect(
  "an attempt still running after its earlier steps were evicted records its later failure",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { open, sql } = yield* diagnosticStore(context);
      const log = yield* open;
      yield* log.setDiagnosticRecording({ enabled: true });
      const running = yield* log.attempt("reporting_install");
      assert(running.id !== null);
      yield* running.record(installTarget);
      yield* entriesAtCapacity(sql);
      const other = yield* log.attempt("t3_detection");
      yield* other.record(installTarget);

      // Act
      yield* running.record(deniedWrite);

      // Assert
      expect(yield* log.listDiagnosticAttempts("", "", running.id)).toMatchObject({
        ok: true,
        value: {
          attempts: [{ id: running.id, truncated: true, entries: [{ entry: deniedWrite }] }],
        },
      });
    }),
);

it.effect(
  "retention keeps the steps younger than seven days of an attempt that started earlier",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { open } = yield* diagnosticStore(context);
      const log = yield* open;
      yield* log.setDiagnosticRecording({ enabled: true });
      const attempt = yield* log.attempt("reporting_install");
      yield* attempt.record(installTarget);
      yield* TestClock.adjust(23 * HOUR);
      yield* attempt.record(deniedWrite);
      yield* attempt.finish("failed");

      // Act
      yield* TestClock.adjust(7 * 24 * HOUR - 22 * HOUR);

      // Assert
      expect(yield* log.listDiagnosticAttempts("", "", "")).toMatchObject({
        ok: true,
        value: {
          attempts: [{ id: attempt.id, truncated: true, entries: [{ entry: deniedWrite }] }],
        },
      });
    }),
);

it("AgentEasel starts when its Diagnostic log state cannot be read", async (c) => {
  // Arrange
  const home = await diagnosticHome(c);
  await (await home.open()).close();
  diagnosticStateMissing(home.harness.databasePath);

  // Act
  const factory = await home.open();

  // Assert
  expect(await factory.getFirstRunSetup("")).toMatchObject({ ok: true });
});

it("AgentEasel starts when its storage refuses to prune the Diagnostic log", async (c) => {
  // Arrange
  const home = await diagnosticHome(c);
  const first = await home.open();
  assert((await first.setDiagnosticRecording({ enabled: true })).ok);
  assert((await first.getFirstRunSetup("")).ok);
  await first.close();
  diagnosticPruneRefused(home.harness.databasePath);

  // Act
  const factory = await home.open();

  // Assert
  expect(await factory.getFirstRunSetup("")).toMatchObject({ ok: true });
});

it("a recorded startup that fails before the backend is ready records its unexpected error", async (c) => {
  // Arrange
  const home = await diagnosticHome(c);
  const t3 = new ControlledT3();
  t3.connection.authorized = true;
  t3.projects.catalog = [
    { projectId: "app", title: "App", workspaceRoot: "/tmp/app", available: true },
  ];
  const first = await home.open({ t3 });
  assert((await first.configureConnection({ endpoint: "http://127.0.0.1:3773/mcp" })).ok);
  assert((await first.recheckProjects()).ok);
  assert((await first.setDiagnosticRecording({ enabled: true })).ok);
  await first.close();
  const restore = projectStorageRefused(home.harness.databasePath);
  t3.projects.listProjects = () => Promise.reject(new Error("Project discovery failed."));

  // Act
  const failed = home.open({ t3 });

  // Assert
  await expect(failed).rejects.toBeDefined();
  restore();
  const reopened = await home.open({ t3 });
  const exported = await reopened.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toMatch(
    /### Start backend · .* UTC · failed[\s\S]*Unexpected error during backend start/,
  );
  expect(exported.value).not.toContain("storage refused");
});

it.effect(
  "a buffered connection observation keeps the timestamps of its start and steps",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { open } = yield* diagnosticStore(context);
      const log = yield* open;
      yield* log.setDiagnosticRecording({ enabled: true });
      const attempt = yield* log.changeAttempt("t3_connection");
      const step: DiagnosticEntry = {
        type: "t3_connection",
        outcome: "ok",
        host: "loopback",
        reason: "connected",
      };
      yield* TestClock.adjust(1000);
      yield* attempt.record(step);
      yield* TestClock.adjust(1000);

      // Act
      yield* attempt.finish("ok");

      // Assert
      expect(yield* log.listDiagnosticAttempts("", "", "")).toMatchObject({
        ok: true,
        value: {
          attempts: [
            {
              startedAt: "1970-01-01T00:00:00.000Z",
              entries: [{ at: "1970-01-01T00:00:01.000Z", entry: step }],
            },
          ],
        },
      });
    }),
);

it.effect(
  "a scheduled check of an unchanged connection adds no attempt to the startup check's",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { harness, t3 } = yield* Effect.promise(() => recordingConnection(context));
      const factory = yield* harness.service({ t3, connectionRetryMs: 1000 });

      // Act
      yield* TestClock.adjust(1000);

      // Assert
      expect(yield* factory.listDiagnosticAttempts("", "", "")).toMatchObject({
        ok: true,
        value: {
          attempts: [{ operation: "t3_connection", outcome: "ok" }, { operation: "backend_start" }],
        },
      });
    }),
);

it.effect(
  "a scheduled check records the connection when it changed since the startup check",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { harness, t3 } = yield* Effect.promise(() => recordingConnection(context));
      const factory = yield* harness.service({ t3, connectionRetryMs: 1000 });
      t3.connection.available = false;

      // Act
      yield* TestClock.adjust(1000);

      // Assert
      expect(yield* factory.listDiagnosticAttempts("", "", "")).toMatchObject({
        ok: true,
        value: {
          attempts: [
            { operation: "t3_connection", outcome: "failed" },
            { operation: "t3_connection", outcome: "ok" },
            { operation: "backend_start" },
          ],
        },
      });
    }),
);
