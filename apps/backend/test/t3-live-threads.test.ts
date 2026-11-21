import { assert, expect, it } from "@effect/vitest";
import { dirname, join } from "node:path";
import { makeLiveT3, type T3Modules } from "../src/index.ts";
import { T3Failure } from "../src/t3/connection.ts";
import { workerTitleRenameDisposition } from "../src/t3/rename-disposition.ts";
import type { ControlledT3 } from "./support/controlled-t3.ts";
import { authorizedLiveOAuth } from "./support/boundaries-setup.ts";
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
  expect(observation.recentRuns[0]).not.toHaveProperty("startedAt");
  expect(observation.recentRuns[2]?.startedAt).toBeNull();
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

const renameRequest = {
  threadId: "thread-1",
  title: "F#1 Entry worker · Polish search",
  clientRequestId: '["worker-title-rename","run","thread-1",1]',
};

const updateSchema = {
  type: "object",
  properties: {
    threadId: { type: "string" },
    action: { type: "string", enum: ["rename"] },
    title: { type: "string", minLength: 1, maxLength: 512 },
    clientRequestId: { type: "string", minLength: 1, maxLength: 256 },
  },
  required: ["threadId", "action", "title", "clientRequestId"],
};

it("a rename reply that echoes the sent title is acknowledged", async (c) => {
  // Arrange
  const { threads, endpoint, live } = await authorizedLiveOAuth(c, {
    updateSchema,
    update: () => ({
      isError: false,
      content: [],
      structuredContent: { threadId: "thread-1", action: "rename", title: renameRequest.title },
    }),
  });

  const { authorizationIdentity } = await live.contract.inspect({ endpoint });
  assert(authorizationIdentity);
  let calls = 0;
  let refusals = 0;
  const target = {
    endpoint,
    authorizationIdentity,
    refuseDispatch: async () => {
      refusals++;
    },
    authorizeDispatch: async () => ++calls === 1,
    signal: new AbortController().signal,
  };

  // Act
  const disposition = await threads.renameThread(target, renameRequest);

  // Assert
  expect([calls, refusals]).toStrictEqual([1, 0]);
  expect(disposition).toStrictEqual({
    kind: "acknowledged",
    threadId: "thread-1",
    title: renameRequest.title,
  });
});

it("an installed plain-text missing-thread error retires that rename as thread-not-found", async (c) => {
  // Arrange
  const { threads, endpoint, live } = await authorizedLiveOAuth(c, {
    updateSchema,
    update: () => ({
      isError: true,
      content: [{ type: "text", text: "Thread thread-1 was not found. Try another id." }],
    }),
  });

  const { authorizationIdentity } = await live.contract.inspect({ endpoint });
  assert(authorizationIdentity);
  const target = {
    endpoint,
    authorizationIdentity,
    refuseDispatch: async () => {},
    authorizeDispatch: async () => true,
    signal: new AbortController().signal,
  };

  // Act
  const disposition = await threads.renameThread(target, renameRequest);

  // Assert
  expect(disposition).toStrictEqual({ kind: "thread-not-found" });
});

it("installed plain-text errors identify a missing thread and a denied capability, and leave other refusals unclassified", () => {
  // Arrange
  const missing = `Thread ${renameRequest.threadId} was not found. It may have been deleted.`;
  const denied = "The saved grant is missing orchestration capability.";
  const other = "The title is too long.";

  // Act
  const notFound = workerTitleRenameDisposition(renameRequest, {
    isError: true,
    content: undefined,
    text: missing,
  });
  const capability = workerTitleRenameDisposition(renameRequest, {
    isError: true,
    content: undefined,
    text: denied,
  });
  const coded = workerTitleRenameDisposition(renameRequest, {
    isError: true,
    content: { _tag: "Error", code: "capability_denied", message: "read-only approval" },
  });
  const unclassified = workerTitleRenameDisposition(renameRequest, {
    isError: true,
    content: undefined,
    text: other,
  });

  // Assert
  expect(notFound).toStrictEqual({ kind: "thread-not-found" });
  expect(capability).toStrictEqual({ kind: "capability-denied" });
  expect(coded).toStrictEqual({ kind: "capability-denied" });
  expect(unclassified).toStrictEqual({ kind: "unclassified" });
});

it("a rename reply reports the different title returned by T3", () => {
  // Arrange
  const answer = {
    isError: false,
    content: { threadId: "thread-1", action: "rename", title: "F#1 Entry worker · Other" },
  };

  // Act
  const disposition = workerTitleRenameDisposition(renameRequest, answer);

  // Assert
  expect(disposition).toStrictEqual({
    kind: "different-title",
    threadId: "thread-1",
    title: "F#1 Entry worker · Other",
  });
});

it.for([
  { reason: "expired grant", identity: () => "previous", current: true },
  { reason: "cancelled claim", identity: (id: string) => id, current: false },
])("a rename with a $reason cannot reach the T3 wire", async ({ identity, current }, c) => {
  // Arrange
  const { live, threads, endpoint, external } = await authorizedLiveOAuth(c, { updateSchema });
  const { authorizationIdentity } = await live.contract.inspect({ endpoint });
  assert(authorizationIdentity);
  const target = {
    endpoint,
    authorizationIdentity: identity(authorizationIdentity),
    signal: new AbortController().signal,
    refuseDispatch: async () => {},
    authorizeDispatch: async () => current,
  };

  // Act
  await threads.renameThread(target, renameRequest);

  // Assert
  expect(
    external.sessionRequests.filter((request) => request.tool === "t3_thread_update"),
  ).toStrictEqual([]);
});

it.for([
  {
    scenario: "failed handshake",
    failHandshake: true,
    retry: true,
    sent: false,
    attempts: 1,
    sessions: 0,
  },
  {
    scenario: "fenced retry",
    failHandshake: false,
    retry: false,
    sent: false,
    attempts: 2,
    sessions: 1,
  },
  {
    scenario: "executed retry",
    failHandshake: false,
    retry: true,
    sent: true,
    attempts: 2,
    sessions: 1,
  },
])(
  "an expired MCP session records executable rename delivery after a $scenario",
  async (row, c) => {
    // Arrange
    const { threads, endpoint, external, live } = await authorizedLiveOAuth(c, {
      updateSchema,
      update: () => ({
        content: [],
        structuredContent: {
          threadId: renameRequest.threadId,
          action: "rename",
          title: renameRequest.title,
        },
      }),
    });
    const { authorizationIdentity } = await live.contract.inspect({ endpoint });
    assert(authorizationIdentity);
    const sessions = external.openedSessions;
    const handshakes = external.handshakeAttempts;
    external.dropSessions(row.failHandshake);
    let attempts = 0;
    let sent = false;
    const target = {
      endpoint,
      authorizationIdentity,
      signal: new AbortController().signal,
      authorizeDispatch: async () => {
        const authorized = ++attempts === 1 || row.retry;
        sent ||= authorized;
        return authorized;
      },
      refuseDispatch: async () => {
        sent = false;
      },
    };

    // Act
    const result = await threads.renameThread(target, renameRequest);

    // Assert
    expect(external.handshakeAttempts - handshakes).toBe(1);
    expect(sent).toBe(row.sent);
    expect(attempts).toBe(row.attempts);
    expect(external.openedSessions - sessions).toBe(row.sessions);
    expect(external.sessionRequests.filter((r) => r.tool === "t3_thread_update")).toHaveLength(
      Number(row.sent),
    );
    expect(result.kind === "acknowledged").toBe(row.sent);
  },
);

it("an interrupted HTTP reply keeps the rename dispatch uncertain without reconnecting", async (c) => {
  // Arrange
  const { threads, endpoint, external, live } = await authorizedLiveOAuth(c, { updateSchema });
  const { authorizationIdentity } = await live.contract.inspect({ endpoint });
  assert(authorizationIdentity);
  const sessions = external.openedSessions;
  external.cutNextToolReply();
  let sent = false;
  const target = {
    endpoint,
    authorizationIdentity,
    signal: new AbortController().signal,
    authorizeDispatch: async () => {
      sent = true;
      return true;
    },
    refuseDispatch: async () => {
      sent = false;
    },
  };

  // Act
  const disposition = await threads.renameThread(target, renameRequest);

  // Assert
  expect(disposition.kind).toBe("unavailable");
  expect(sent).toBe(true);
  expect(external.openedSessions).toBe(sessions);
  expect(
    external.sessionRequests.filter((request) => request.tool === "t3_thread_update"),
  ).toHaveLength(1);
});
