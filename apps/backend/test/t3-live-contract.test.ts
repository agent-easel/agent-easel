import { expect, it } from "@effect/vitest";
import { dirname, join } from "node:path";
import { makeLiveT3 } from "../src/index.ts";
import { T3Failure } from "../src/t3/connection.ts";
import { attachmentSupport, reportSupport } from "../src/t3/contract.ts";
import {
  authorizedLiveOAuth,
  malformedSendLiveT3,
  reportAdapter as adapter,
  reportPage as page,
  reportReadSchema,
  reportReadSchema as readSchema,
} from "./support/boundaries-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import { launchFixture } from "./support/launch-fixture.ts";
import { oauthT3 } from "./support/oauth-t3.ts";

it("launch support permits an absent runtime mode without inventing replay proof", async (c) => {
  // Arrange
  const { live, external } = await launchFixture(c);

  // Act
  const support = (await live.contract.inspect({ endpoint: external.endpoint })).support.launch
    .checkout;

  // Assert
  expect(support.supported).toBe(true);
  expect(support.retryScope).toBe(null);
});

it("a launch replay proof that cannot be established leaves only launch support unknown", async (c) => {
  // Arrange
  const { live, external, failProof } = await launchFixture(c);
  failProof();

  // Act
  const inspection = await live.contract.inspect({ endpoint: external.endpoint });

  // Assert
  expect(inspection.state).toBe("ready");
  expect(inspection.support.launch.checkout).toStrictEqual({
    supported: false,
    retryScope: null,
    explanation: null,
  });
  expect(inspection.support.launch.worktree.supported).toBe(false);
  expect(inspection.support.attachmentLimit).toBe(8);
});

it("a send replay proof that cannot be established leaves only send support unknown", async (c) => {
  // Arrange
  const fields = ["environmentId", "threadId", "clientRequestId", "message"];
  const sendSchema = {
    type: "object",
    properties: {
      ...Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
      mode: { type: "string", enum: ["queue"] },
    },
  };
  const { live, endpoint } = await authorizedLiveOAuth(
    c,
    { sendSchema, send: () => ({}), readSchema: reportReadSchema },
    {
      contract: {
        sendRecoveryScope: async () => {
          throw new Error("The replay proof could not be established.");
        },
      },
    },
  );

  // Act
  const inspection = await live.contract.inspect({ endpoint });

  // Assert
  expect(inspection.state).toBe("ready");
  expect(inspection.support.send).toStrictEqual({
    supported: false,
    retryScope: null,
    explanation: null,
  });
  expect(inspection.support.reportReads).toBe(true);
});

it("T3 advertising upload preparation and launch attachments supports image launches", async (c) => {
  // Arrange
  const { live, external } = await launchFixture(c);

  // Act
  const support = attachmentSupport(
    (await live.contract.inspect({ endpoint: external.endpoint })).support,
    8,
  );

  // Assert
  expect(support.supported).toBe(true);
});

it("a launch schema without attachments does not support image launches", async (c) => {
  // Arrange
  const { live, external, schema } = await launchFixture(c);
  delete (schema.properties as Record<string, unknown>).attachments;

  // Act
  const support = attachmentSupport(
    (await live.contract.inspect({ endpoint: external.endpoint })).support,
    1,
  );

  // Assert
  expect(support.supported).toBe(false);
});

it("T3's workspace strategy schema supports worktree launches", async (c) => {
  // Arrange
  const { live, external } = await launchFixture(c);

  // Act
  const support = (await live.contract.inspect({ endpoint: external.endpoint })).support.launch
    .worktree;

  // Assert
  expect(support.supported).toBe(true);
});

it("worktree launch support is refused when the strategy cannot name an existing worktree", async (c) => {
  // Arrange
  const { live, external, schema } = await launchFixture(c);
  Object.assign(schema.properties!, {
    workspaceStrategy: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["root", "worktree"] },
        baseRef: { type: "string" },
        branch: { type: "string" },
      },
    },
  });

  // Act
  const support = (await live.contract.inspect({ endpoint: external.endpoint })).support.launch
    .worktree;

  // Assert
  expect(support).toMatchObject({
    supported: false,
    explanation: expect.stringMatching(/worktree/),
  });
});

it("send replay proof stays independent from launch recovery scope", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  let proof: string | null = null;
  const sendSchema: Record<string, unknown> = {
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
  };
  const external = await oauthT3({ sendSchema, send: () => ({ threadId: "thread", runId: "x" }) });
  c.onTestFinished(() => external.close());
  let approval = "";
  const live = makeLiveT3({
    credentialsDirectory: join(dirname(h.databasePath), "credentials"),
    callbackPort: 0,
    openBrowser: async (url) => {
      approval = url;
    },
    launchRecoveryScope: async () => "launch-proof-is-not-send-proof",
    sendRecoveryScope: async () => proof,
  });
  const f = await h.open({ t3: live });
  await f.configureConnection({ endpoint: external.endpoint });
  await f.authorizeConnection();
  expect((await fetch(external.approvalUrl(approval))).status).toBe(200);
  await f.recheckConnection();
  expect(
    (await live.contract.inspect({ endpoint: external.endpoint })).support.send.supported,
  ).toBe(true);
  proof = "send-continuity-and-retention";

  // Act
  const support = (await live.contract.inspect({ endpoint: external.endpoint })).support.send;

  // Assert
  expect(support.retryScope).toBe(proof);
});

it("report support rejects a public schema whose read bounds cannot cover the requested page", async (c) => {
  // Arrange
  const { t3, endpoint } = await adapter(c, () => page([]), {
    ...readSchema,
    properties: { ...readSchema.properties, limit: { type: "integer", maximum: 10 } },
  });

  // Act
  const support = reportSupport((await t3.contract.inspect({ endpoint })).support, "codex");

  // Assert
  expect(support.supported).toBe(false);
});

it("a ready T3 advertising a malformed send schema is an invalid answer, not an unclassified error", async (c) => {
  // Arrange
  const { live, endpoint } = await malformedSendLiveT3(c);

  // Act
  const inspection = live.contract.inspect({ endpoint });

  // Assert
  await expect(inspection).rejects.toBeInstanceOf(T3Failure);
  await expect(inspection).rejects.toMatchObject({ kind: "invalid-response" });
});

it("a malformed send schema read after a recovered T3 server error is classified as unavailable", async (c) => {
  // Arrange
  const { live, external, endpoint } = await malformedSendLiveT3(c, {
    resourceMetadataUnavailable: true,
  });
  external.expireAccess();
  const refreshes = external.refreshes;

  // Act
  const inspection = live.contract.inspect({ endpoint });

  // Assert
  await expect(inspection).rejects.toMatchObject({ name: "T3Failure", kind: "unavailable" });
  expect(external.refreshes).toBe(refreshes + 1);
});

it("send contract advertises freshContextSend only when t3_thread_send exposes a boolean freshContext field", async (c) => {
  // Arrange
  const fields = ["environmentId", "threadId", "clientRequestId", "message"];
  const sendSchema = {
    type: "object",
    properties: {
      ...Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
      mode: { type: "string", enum: ["queue"] },
      freshContext: { type: "boolean" },
    },
  };
  const { live, endpoint } = await authorizedLiveOAuth(c, {
    sendSchema,
    send: () => ({}),
    readSchema: reportReadSchema,
  });

  // Act
  const inspection = await live.contract.inspect({ endpoint });

  // Assert
  expect(inspection.support.send.supported).toBe(true);
  expect(inspection.support.freshContextSend).toBe(true);
});
