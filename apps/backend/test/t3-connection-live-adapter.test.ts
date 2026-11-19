import { expect, it } from "@effect/vitest";
import type { T3Modules } from "../src/index.ts";
import {
  authorizedLiveOAuth,
  connectedLiveT3,
  observedThread,
  sendReference,
} from "./support/boundaries-setup.ts";
import { oauthT3 } from "./support/oauth-t3.ts";

const queuedSend = {
  environmentId: "fixture-environment",
  threadId: "thread-1",
  mode: "queue" as const,
  clientRequestId: "a".repeat(64),
  message: "Continue",
};

/** The MCP session that served the latest thread read. */
const threadReadSession = (requests: readonly { session: string; tool?: string }[]) =>
  requests.findLast((request) => request.tool === "t3_thread_read")?.session;

it("inspections and concurrent T3 calls on one endpoint share one MCP connection", async (context) => {
  // Arrange
  let readReached!: () => void;
  const readStarted = new Promise<void>((resolve) => (readReached = resolve));
  const { live, adapter, external, endpoint } = await authorizedLiveOAuth(context, {
    projects: true,
    runtimeActivity: () => {
      readReached();
      return observedThread;
    },
    sendSchema: { type: "object" },
    // The send answers only once the read has reached T3, so serialized calls would never finish.
    send: async () => {
      await readStarted;
      return sendReference;
    },
  });

  // Act
  const answers = await Promise.all([
    live.contract.inspect({ endpoint }),
    adapter.sendMessage({ endpoint }, queuedSend),
    adapter.readExecution({ endpoint }, "thread-1"),
    adapter.listProjects({ endpoint, environmentId: "fixture-environment" }),
  ]);

  // Assert
  expect(answers).toMatchObject([
    { state: "ready" },
    { runId: "run-2" },
    { threadId: "thread-1" },
    [],
  ]);
  expect(external.openedSessions).toBe(1);
});

it("after T3 forgets its sessions, the next call succeeds on a new connection", async (context) => {
  // Arrange
  const { adapter, external, endpoint } = await connectedLiveT3(context);
  external.dropSessions();

  // Act
  const observation = await adapter.readExecution({ endpoint }, "thread-1");

  // Assert
  expect(observation.threadId).toBe("thread-1");
  expect(external.openedSessions).toBe(2);
});

it("after T3 changes a tool's output schema, the shared connection checks the new schema", async (context) => {
  // Arrange
  let environmentId = "fixture-environment";
  const { live, external, endpoint } = await authorizedLiveOAuth(context, {
    environmentOutputSchema: () => ({
      $id: "https://fixture.example/environment.json",
      type: "object",
      properties: { environmentId: { const: environmentId } },
      required: ["environmentId"],
    }),
  });
  expect(await live.contract.inspect({ endpoint })).toMatchObject({ state: "ready" });
  environmentId = "another-environment";

  // Act
  const inspection = await live.contract.inspect({ endpoint });

  // Assert
  expect(inspection).toMatchObject({ state: "incompatible" });
  expect(external.openedSessions).toBe(1);
});

it("a send whose request may have reached T3 is not resent and reports T3 unavailable", async (context) => {
  // Arrange
  const sends: unknown[] = [];
  const { adapter, external, endpoint } = await connectedLiveT3(context, {
    send: (args) => {
      sends.push(args);
      external.dropSessions();
      throw new Error("T3 restarts before answering.");
    },
  });

  // Act
  const sent = adapter.sendMessage({ endpoint }, queuedSend);

  // Assert
  await expect(sent).rejects.toMatchObject({ kind: "unavailable" });
  expect(sends).toStrictEqual([queuedSend]);
});

it("a reply lost after T3's 200 headers reports T3 unavailable, not an invalid answer", async (context) => {
  // Arrange
  const { adapter, external, endpoint } = await connectedLiveT3(context);
  external.cutNextToolReply();

  // Act
  const sent = adapter.sendMessage({ endpoint }, queuedSend);

  // Assert
  await expect(sent).rejects.toMatchObject({ kind: "unavailable" });
});

it("after re-authorization, calls use a new connection and never the previous grant's", async (context) => {
  // Arrange
  const { factory, adapter, external, endpoint, authorizationUrl } = await connectedLiveT3(context);
  await adapter.readExecution({ endpoint }, "thread-1");
  const previous = threadReadSession(external.sessionRequests);
  await factory.authorizeConnection();
  expect((await fetch(external.approvalUrl(authorizationUrl()))).status).toBe(200);

  // Act
  const observation = await adapter.readExecution({ endpoint }, "thread-1");

  // Assert
  expect(observation.threadId).toBe("thread-1");
  expect(threadReadSession(external.sessionRequests)).not.toBe(previous);
  expect(external.openedSessions).toBe(2);
});

it.for([
  [
    "resumed authorization",
    async (live: T3Modules, endpoint: string) => {
      await live.connection.resumeAuthorization({ endpoint });
    },
  ],
  [
    "an endpoint change",
    async (live: T3Modules, _endpoint: string, other: string) => {
      await live.contract.inspect({ endpoint: other });
    },
  ],
  ["closing T3", (live: T3Modules) => live.close()],
] as const)("after %s, the next call opens a new connection", async ([, change], context) => {
  // Arrange
  const { live, adapter, external, endpoint } = await connectedLiveT3(context);
  const other = await oauthT3();
  context.onTestFinished(() => other.close());
  await adapter.readExecution({ endpoint }, "thread-1");
  const previous = threadReadSession(external.sessionRequests);
  await change(live, endpoint, other.endpoint);

  // Act
  const observation = await adapter.readExecution({ endpoint }, "thread-1");

  // Assert
  expect(observation.threadId).toBe("thread-1");
  expect(threadReadSession(external.sessionRequests)).not.toBe(previous);
  expect(external.openedSessions).toBe(2);
});
