import { assert, expect, it } from "@effect/vitest";
import { dirname, join } from "node:path";
import { makeLiveT3, type T3Modules } from "../src/index.ts";
import { T3Failure } from "../src/t3/connection.ts";
import type { ControlledT3 } from "./support/controlled-t3.ts";
import { launchFixture } from "./support/launch-fixture.ts";
import { screenshots } from "./support/run-images.ts";
import { factoryHarness } from "./support/factory.ts";
import { prepared } from "./support/prepared-runner.ts";
import { oauthT3 } from "./support/oauth-t3.ts";
import {
  capturedWorker,
  repositoryWorker,
  settledAnswer,
  wireWorker,
} from "./support/worker-contract.ts";

/** The controlled T3 answers launch support from the live contract inspection at `endpoint`. */
async function answerLaunchSupportFrom(live: T3Modules, endpoint: string, t3: ControlledT3) {
  const { launch } = (await live.contract.inspect({ endpoint })).support;
  const inspect = t3.contract.inspect.bind(t3.contract);
  t3.contract.inspect = async (target) => {
    const inspection = await inspect(target);
    return { ...inspection, support: { ...inspection.support, launch } };
  };
}

it("a worker observation reads its branch independently of its explicitly linked PR", async (c) => {
  // Arrange
  const { threads, endpoint } = await repositoryWorker(c);

  // Act
  const observation = await threads.readExecution({ endpoint }, "thread-1");

  // Assert
  expect(observation.repository).toStrictEqual({
    branch: "feature/search",
    pullRequests: [
      {
        host: "github.com",
        repository: "example/search",
        number: 42,
        url: "https://github.com/example/search/pull/42",
        state: "open",
      },
    ],
  });
});

it("a worker PR cannot supply an executable link to Factory clients", async (c) => {
  // Arrange
  const { threads, endpoint } = await repositoryWorker(c, "javascript:alert(1)");

  // Act
  const observation = threads.readExecution({ endpoint }, "thread-1");

  // Assert
  await expect(observation).rejects.toThrow("Invalid worker pull request URL.");
});
import { allTurnsEnd, finishedReport, report, turnBegins } from "./support/scenarios.ts";

it("a captured checkout worker retains exact execution identity from its nested thread read", async (c) => {
  // Arrange
  const { threads, endpoint } = await capturedWorker(c);

  // Act
  const observation = await threads.readExecution({ endpoint }, "thread-1");

  // Assert
  expect(observation).toMatchObject({
    threadId: "thread-1",
    projectId: "project-fixture",
    workspaceRoot: null,
    activeRunId: null,
    latestRunId: "execution-7",
    pendingRequestCount: 0,
    recentRuns: [
      {
        runId: "execution-7",
        ordinal: 7,
        status: "completed",
        sourceAt: "2026-11-07T16:12:35.082Z",
      },
      { runId: "execution-4", ordinal: 4, status: "completed" },
      { runId: "execution-2", ordinal: 2, status: "completed" },
    ],
  });
});

it("a worker resumed by a notification shows a missing report when T3 settles it from an earlier result run", async (c) => {
  // Arrange
  const f = await wireWorker(c, (runId) => ({
    ...settledAnswer(runId),
    resultRun: { runId: "execution-1", status: "completed" },
  }));
  turnBegins(f.world, f.worker, "notification-execution");
  allTurnsEnd(f.world, f.worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.blocks[0]).toMatchObject({ state: "error", problem: "missing-report" });
  expect(run.value.attention.filter((a) => !a.settledAt)).toMatchObject([
    { kind: "missing-report", executionId: "notification-execution" },
  ]);
});

it("a reported worker's result stays held while T3's delegated wait times out", async (c) => {
  // Arrange
  const f = await wireWorker(c, (runId) => ({ ...settledAnswer(runId), timedOut: true }));
  assert((await report(f.world, f.worker, finishedReport())) === "ACCEPTED");
  allTurnsEnd(f.world, f.worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.reports[0]?.completionEligibleAt).toBeNull();
  expect(run.value.blocks[0]?.state).toBe("working");
  expect(f.t3.threads.launches.size).toBe(1);
});

it("a delegated wait answered for another run keeps a reported result held", async (c) => {
  // Arrange
  const f = await wireWorker(c, () => settledAnswer("another-run"));
  assert((await report(f.world, f.worker, finishedReport())) === "ACCEPTED");
  allTurnsEnd(f.world, f.worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.reports[0]?.completionEligibleAt).toBeNull();
  expect(f.t3.threads.launches.size).toBe(1);
});

it("a reported worker's result is released when the live thread read and delegated wait show it finished", async (c) => {
  // Arrange
  const f = await wireWorker(c, settledAnswer);
  assert((await report(f.world, f.worker, finishedReport())) === "ACCEPTED");
  allTurnsEnd(f.world, f.worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.reports[0]?.completionEligibleAt).toEqual(expect.any(String));
  expect(f.t3.threads.launches.size).toBe(2);
});

it("an image upload posts its exact bytes to T3's signed upload address without the OAuth bearer", async (c) => {
  // Arrange
  const { threads, external } = await launchFixture(c);
  const upload = { name: "image-1-screenshot.png", mimeType: "image/png", sizeBytes: 0 };
  const data = screenshots.red.data;

  // Act
  const attachmentId = await threads.uploadAttachment(
    { endpoint: external.endpoint },
    { ...upload, sizeBytes: data.byteLength },
    data,
  );

  // Assert
  expect(external.uploads).toHaveLength(1);
  const received = external.uploads[0]!;
  expect(received.attachmentId).toBe(attachmentId);
  expect(received.upload).toStrictEqual({ type: "image", ...upload, sizeBytes: data.byteLength });
  expect(received.bytes.equals(Buffer.from(data))).toBe(true);
  expect(received.authorization).toBeUndefined();
});

it("a malformed upload address from T3 is an invalid answer that never reveals the address", async (c) => {
  // Arrange
  const { threads, external } = await launchFixture(c);
  external.malformUploadAddresses();
  const data = screenshots.red.data;
  const upload = {
    name: "image-1-screenshot.png",
    mimeType: "image/png",
    sizeBytes: data.byteLength,
  };

  // Act
  const uploaded = threads.uploadAttachment({ endpoint: external.endpoint }, upload, data);

  // Assert
  await expect(uploaded).rejects.toStrictEqual(
    new T3Failure("invalid-response", "T3 returned an invalid upload address."),
  );
  expect(external.uploads).toStrictEqual([]);
});

it("a launch sends its uploaded attachments with the first message", async (c) => {
  // Arrange
  const { threads, external, payload, seen } = await launchFixture(c);
  const attachments = [
    {
      type: "image" as const,
      id: "pending-1",
      name: "image-1-screenshot.png",
      mimeType: "image/png",
      sizeBytes: 120,
    },
  ];

  // Act
  await threads.launchThread({ endpoint: external.endpoint }, { ...payload, attachments });

  // Assert
  expect(seen).toStrictEqual([{ ...payload, attachments }]);
});

it("Start rejects worktree support that cannot express whether T3 fetches origin", async (c) => {
  // Arrange
  const { live, external, schema } = await launchFixture(c);
  const strategy = (
    schema.properties as { workspaceStrategy: { properties: Record<string, unknown> } }
  ).workspaceStrategy;
  delete strategy.properties.startFromOrigin;
  const { f, t3, input } = await prepared(c, {
    workspace: { mode: "worktree", base: { kind: "default" } },
  });
  await answerLaunchSupportFrom(live, external.endpoint, t3);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toMatchObject([
    { code: "launch_unsupported", path: "connection.contract" },
  ]);
  expect(await f.listRuns(input.projectId)).toStrictEqual({ ok: true, value: [] });
  expect(t3.threads.launches.size).toBe(0);
});

it("Start rejects a schema requiring runtime mode before accepting work", async (c) => {
  // Arrange
  const { live, external, schema } = await launchFixture(c);
  schema.required = ["runtimeMode"];
  const { f, t3, input } = await prepared(c);
  await answerLaunchSupportFrom(live, external.endpoint, t3);

  // Act
  const blocked = await f.startRun(input);

  // Assert
  assert(!blocked.ok);
  expect(blocked.error.issues).toContainEqual(
    expect.objectContaining({
      code: "launch_unsupported",
      message: expect.stringMatching(/omit/),
    }),
  );
  expect(await f.listRuns(input.projectId)).toStrictEqual({ ok: true, value: [] });
  expect(await f.listTasks(input.projectId)).toStrictEqual({ ok: true, value: [] });
});

it("SDK launch without an exact execution reference remains uncertain", async (c) => {
  // Arrange
  const fixture = await launchFixture(c);
  fixture.malformed();

  // Act
  const result = fixture.threads.launchThread(
    { endpoint: fixture.external.endpoint },
    fixture.payload,
  );

  // Assert
  await expect(result).rejects.toThrow(/uncertain/);
});

it("execution observation preserves native requests and renewed work references", async (c) => {
  // Arrange
  const { threads, external } = await launchFixture(c);

  // Act
  const observation = await threads.readExecution({ endpoint: external.endpoint }, "thread");

  // Assert
  expect(observation.recentRuns[0]?.runId).toBe("exact");
  expect(observation.pendingRequestCount).toBe(1);
  expect(observation.latestRunId).toBe("newer-direct-activity");
  expect(observation.recentRuns[1]?.ordinal).toBe(2);
  expect(observation.recentRuns[0]?.sourceAt).toBe("2026-11-01T08:01:00.000Z");
});

it("a worktree thread read exposes the worktree path and branch T3 bound", async (c) => {
  // Arrange
  const fixture = await launchFixture(c);
  fixture.attachWorktree();

  // Act
  const observation = await fixture.threads.readExecution(
    { endpoint: fixture.external.endpoint },
    "thread",
  );

  // Assert
  expect(observation).toMatchObject({
    workspaceRoot: "/worktrees/factory-run-1",
    repository: { branch: "factory/run-1" },
  });
});

it("sendMessage returns the exact queued run reference from the live SDK", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const seen: unknown[] = [];
  const external = await oauthT3({
    sendSchema: {
      type: "object",
      properties: {
        ...Object.fromEntries(
          ["environmentId", "threadId", "clientRequestId", "message"].map((f) => [
            f,
            { type: "string" },
          ]),
        ),
        mode: { type: "string", enum: ["auto", "queue", "steer"] },
      },
    },
    send: (args) => {
      seen.push(args);
      return {
        threadId: "thread",
        messageId: "message",
        runId: "queued-exact",
        status: "queued",
        delivery: "queued",
      };
    },
  });
  c.onTestFinished(() => external.close());
  let approval = "";
  const live = makeLiveT3({
    credentialsDirectory: join(dirname(h.databasePath), "credentials"),
    callbackPort: 0,
    openBrowser: async (url) => {
      approval = url;
    },
  });
  const f = await h.open({ t3: live });
  await f.configureConnection({ endpoint: external.endpoint });
  await f.authorizeConnection();
  expect((await fetch(external.approvalUrl(approval))).status).toBe(200);
  await f.recheckConnection();
  const payload = {
    environmentId: "fixture-environment",
    threadId: "thread",
    mode: "queue" as const,
    clientRequestId: "a".repeat(64),
    message: "Independent feedback",
  };

  // Act
  const sent = await live.threads.sendMessage({ endpoint: external.endpoint }, payload);

  // Assert
  expect(sent.runId).toBe("queued-exact");
  expect(seen).toStrictEqual([payload]);
});

it("sendMessage rejects malformed live responses as uncertain", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const external = await oauthT3({
    send: () => ({ threadId: "thread", runId: null, status: "queued" }),
  });
  c.onTestFinished(() => external.close());
  let approval = "";
  const live = makeLiveT3({
    credentialsDirectory: join(dirname(h.databasePath), "credentials"),
    callbackPort: 0,
    openBrowser: async (url) => {
      approval = url;
    },
  });
  const f = await h.open({ t3: live });
  await f.configureConnection({ endpoint: external.endpoint });
  await f.authorizeConnection();
  expect((await fetch(external.approvalUrl(approval))).status).toBe(200);
  await f.recheckConnection();
  const payload = {
    environmentId: "fixture-environment",
    threadId: "thread",
    mode: "queue" as const,
    clientRequestId: "a".repeat(64),
    message: "Independent feedback",
  };

  // Act
  const rejection = live.threads.sendMessage({ endpoint: external.endpoint }, payload);

  // Assert
  await expect(rejection).rejects.toThrow(/uncertain/);
});

it("a thread read without a pending native request count is rejected rather than read as none", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const external = await oauthT3({
    runtimeActivity: () => ({
      thread: {
        threadId: "thread",
        projectId: "neutral",
        activeRunId: null,
        latestRunId: "exact",
        link: null,
        worktreePath: null,
        pendingRequestCount: undefined,
      },
      recentRuns: [{ runId: "exact", status: "completed", ordinal: 1 }],
    }),
  });
  c.onTestFinished(() => external.close());
  let approval = "";
  const live = makeLiveT3({
    credentialsDirectory: join(dirname(h.databasePath), "credentials"),
    callbackPort: 0,
    openBrowser: async (url) => {
      approval = url;
    },
  });
  const f = await h.open({ t3: live });
  await f.configureConnection({ endpoint: external.endpoint });
  await f.authorizeConnection();
  expect((await fetch(external.approvalUrl(approval))).status).toBe(200);
  await f.recheckConnection();

  // Act
  const rejection = live.threads.readExecution({ endpoint: external.endpoint }, "thread");

  // Assert
  await expect(rejection).rejects.toThrow(/Invalid thread observation/);
});
