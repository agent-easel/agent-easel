import { runFactoryProcess } from "./support/factory-process.ts";
import { assert, expect, it } from "@effect/vitest";
import { readdir, stat, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeLiveT3 } from "../src/index.ts";
import { factoryHarness } from "./support/factory.ts";
import { oauthT3 } from "./support/oauth-t3.ts";
import {
  failedReopen,
  liveT3,
  openOAuthFactory,
  restartedOAuthFactory,
} from "./support/oauth-factory.ts";
import {
  authorizedLiveOAuth,
  readConnection,
  recheckConnection,
} from "./support/boundaries-setup.ts";

async function approvePendingOAuth(
  factory: Awaited<ReturnType<typeof openOAuthFactory>>["factory"],
  external: Awaited<ReturnType<typeof openOAuthFactory>>["external"],
  getAuthorizationUrl: () => string,
) {
  await factory.authorizeConnection();
  expect((await fetch(external.approvalUrl(getAuthorizationUrl()))).status).toBe(200);
  expect((await recheckConnection(factory)).state).toBe("ready");
}

it("OAuth callback rejects a mismatched state parameter", async (context) => {
  // Arrange
  const { factory, external, getAuthorizationUrl } = await openOAuthFactory(context);
  await factory.authorizeConnection();
  const wrong = new URL(external.approvalUrl(getAuthorizationUrl()));
  wrong.searchParams.set("state", "wrong-state");

  // Act
  const response = await fetch(wrong);

  // Assert
  expect(response.status).toBe(400);
});

it("OAuth approval completes after backend restart on the pending callback", async (context) => {
  // Arrange
  const { harness, external, factory, getAuthorizationUrl } = await openOAuthFactory(context);
  await factory.authorizeConnection();
  const callback = external.approvalUrl(getAuthorizationUrl());
  await factory.close();
  const reopened = await harness.open({
    t3: liveT3(join(dirname(harness.databasePath), "credentials"), () => {}),
  });
  expect((await readConnection(reopened)).explanation).toMatch(/Approve access in the browser/);

  // Act
  const approval = await fetch(callback);

  // Assert
  expect(approval.status).toBe(200);
  expect((await recheckConnection(reopened)).state).toBe("ready");
});

it("a failed reopen of the pending approval is still reported after a backend restart", async (context) => {
  // Arrange
  const opened = await failedReopen(context);
  await opened.factory.close();

  // Act
  const restarted = await opened.harness.open({
    t3: liveT3(opened.credentialsDirectory, () => {}),
  });

  // Assert
  const connection = await readConnection(restarted);
  expect(connection.authorizationPending).toBe(true);
  expect(connection.authorizationOpenFailed).toBe(true);
  expect(connection.explanation).toMatch(/could not open the backend-host browser/);
});

it("a reopen that opens the approval page after a failed one no longer reports the failure", async (context) => {
  // Arrange: a restart, so the reopen is not held back by the previous one's cooldown.
  const opened = await failedReopen(context);
  const restarted = await restartedOAuthFactory(opened);

  // Act
  const reopened = await restarted.openConnectionAuthorization();

  // Assert
  assert(reopened.ok);
  expect(reopened.value.authorizationPending).toBe(true);
  expect(reopened.value.authorizationOpenFailed).toBe(false);
  expect(reopened.value.explanation).toMatch(/Approve access in the browser/);
});

it("a new approval after a failed reopen starts with no failure reported", async (context) => {
  // Arrange
  const opened = await failedReopen(context);
  opened.hostBrowserOpens(true);

  // Act
  const started = await opened.factory.authorizeConnection();

  // Assert
  assert(started.ok);
  expect(started.value.authorizationPending).toBe(true);
  expect(started.value.authorizationOpenFailed).toBe(false);
});

it("OAuth credential files are stored with restrictive permissions and no pending verifier fields", async (context) => {
  // Arrange
  const { factory, external, credentialsDirectory, getAuthorizationUrl } =
    await openOAuthFactory(context);
  await approvePendingOAuth(factory, external, getAuthorizationUrl);

  // Act
  const ready = await recheckConnection(factory);

  // Assert
  const files = await readdir(credentialsDirectory);
  const stored = JSON.parse(await readFile(join(credentialsDirectory, files[0]!), "utf8"));
  expect((await stat(credentialsDirectory)).mode & 0o777).toBe(0o700);
  expect((await stat(join(credentialsDirectory, files[0]!))).mode & 0o777).toBe(0o600);
  expect(stored.discovery).toBeTruthy();
  expect(stored.tokens).toBeTruthy();
  expect(stored.pending).toBe(undefined);
  expect(stored.verifier).toBe(undefined);
  expect(stored.state).toBe(undefined);
  expect(JSON.stringify(ready).includes(stored.tokens.access_token)).toBeFalsy();
  expect(JSON.stringify(ready).includes(stored.tokens.refresh_token)).toBeFalsy();
});

it("expired access with unavailable refresh surfaces unavailable without logging private token errors", async (context) => {
  // Arrange
  const { harness, external, factory, getAuthorizationUrl } = await openOAuthFactory(context);
  await approvePendingOAuth(factory, external, getAuthorizationUrl);
  await factory.close();
  external.expireAccess();
  external.refreshUnavailable(true);

  // Act
  const outageChild = await runFactoryProcess(
    [
      fileURLToPath(new URL("./support/connection-process.ts", import.meta.url)),
      harness.databasePath,
    ],
    dirname(harness.databasePath),
  );

  // Assert
  expect(JSON.parse(outageChild.stdout).value.state).toBe("unavailable");
  expect(outageChild.stdout + outageChild.stderr).not.toMatch(
    /PRIVATE_ERROR_DESCRIPTION_MUST_NOT_BE_LOGGED/,
  );
});

it("token refresh restores ready without a second authorization when refresh succeeds", async (context) => {
  // Arrange
  const { harness, external, factory, getAuthorizationUrl } = await openOAuthFactory(context);
  await approvePendingOAuth(factory, external, getAuthorizationUrl);
  const oldContext = (await readConnection(factory)).authorizationContext;
  await factory.close();
  external.expireAccess();
  external.refreshUnavailable(true);
  const reopened = await harness.open({
    t3: liveT3(join(dirname(harness.databasePath), "credentials"), () => {}),
  });
  await reopened.configureConnection({ endpoint: external.endpoint });
  expect((await readConnection(reopened)).state).toBe("unavailable");
  external.refreshUnavailable(false);

  // Act
  const rechecked = await reopened.recheckConnection();

  // Assert
  expect(rechecked.ok).toBe(true);
  expect(rechecked.ok && rechecked.value.state).toBe("ready");
  expect(external.refreshes >= 1).toBeTruthy();
  expect(rechecked.ok && rechecked.value.authorizationContext).toStrictEqual(oldContext);
  expect(external.authorizations).toBe(1);
});

it("missing T3 contract surfaces incompatible until the contract returns", async (context) => {
  // Arrange
  const { factory, external, getAuthorizationUrl } = await openOAuthFactory(context);
  await approvePendingOAuth(factory, external, getAuthorizationUrl);
  external.missingContract(true);

  // Act
  const connection = await recheckConnection(factory);

  // Assert
  expect(connection.state).toBe("incompatible");
  external.missingContract(false);
});

it("revoked OAuth requires explicit reauthorization with a new authorization context", async (context) => {
  // Arrange
  const { external, factory, getAuthorizationUrl } = await openOAuthFactory(context);
  await approvePendingOAuth(factory, external, getAuthorizationUrl);
  const oldContext = (await readConnection(factory)).authorizationContext;
  const flow = await factory.createFlow({ name: "OAuth preserves history" });
  assert(flow.ok);
  assert(flow.ok);
  external.revoke();

  const afterRevoke = await recheckConnection(factory);
  expect(afterRevoke.state).toBe("authorization-required");
  await factory.authorizeConnection();
  const second = external.approvalUrl(getAuthorizationUrl());
  expect((await fetch(second)).status).toBe(200);

  // Act
  const reauthorized = await recheckConnection(factory);

  // Assert
  expect(reauthorized.state).toBe("ready");
  expect(reauthorized.authorizationContext?.id).not.toBe(oldContext?.id);
  expect(external.registrationCount >= 2).toBeTruthy();
  expect(await factory.getFlow(flow.value.id)).toStrictEqual(flow);
});

it("a T3 call's transient failure is not reported on a concurrent inspection whose grant is rejected", async (context) => {
  // Arrange
  let readReached!: () => void;
  let failRead!: () => void;
  let answerRejection!: () => void;
  const readStarted = new Promise<void>((resolve) => (readReached = resolve));
  const readFails = new Promise<void>((resolve) => (failRead = resolve));
  const rejectionAnswered = new Promise<void>((resolve) => (answerRejection = resolve));
  const { live, threads, external, endpoint } = await authorizedLiveOAuth(context, {
    runtimeActivity: async () => {
      readReached();
      await readFails;
      throw new Error("The connection of this read drops.");
    },
  });
  const read = threads.readExecution({ endpoint }, "thread-1");
  await readStarted;
  external.revoke();
  const rejectionHeld = external.holdAuthorizationRejections(rejectionAnswered);
  const inspection = live.contract.inspect({ endpoint });
  await rejectionHeld;

  // Act
  failRead();
  const readFailure = await read.then(
    () => undefined,
    (error: unknown) => error,
  );
  answerRejection();
  const inspected = await inspection;

  // Assert
  expect(readFailure).toMatchObject({ kind: "unavailable" });
  expect(inspected).toMatchObject({
    state: "authorization-required",
    reason: "approval-required",
  });
});

it("denied OAuth leaves authorization required with an actionable explanation", async (context) => {
  // Arrange
  const { factory, external, getAuthorizationUrl } = await openOAuthFactory(context);
  await factory.authorizeConnection();
  const denial = external.approvalUrl(getAuthorizationUrl());
  denial.searchParams.delete("code");
  denial.searchParams.set("error", "access_denied");
  expect((await fetch(denial)).status).toBe(400);

  // Act
  const denied = await factory.recheckConnection();

  // Assert
  assert(denied.ok);
  expect(denied.value.state).toBe("authorization-required");
  expect(denied.value.explanation).toMatch(/expired or was denied/);
});

it("a browser open failure during authorize stays actionable and never leaks the private error", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const external = await oauthT3();
  context.onTestFinished(() => external.close());
  const factory = await harness.open({
    t3: makeLiveT3({
      credentialsDirectory: join(dirname(harness.databasePath), "credentials"),
      callbackPort: 0,
      openBrowser: async () => {
        throw new Error("Private browser failure");
      },
    }),
  });
  await factory.configureConnection({ endpoint: external.endpoint });

  // Act
  const failed = await factory.authorizeConnection();

  // Assert
  assert(failed.ok);
  expect(failed.value.state).toBe("authorization-required");
  expect(failed.value.explanation).toMatch(/could not open/);
  expect(JSON.stringify(failed)).not.toMatch(/Private browser failure/);
});

it("an occupied callback port leaves authorization required with an actionable explanation", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const external = await oauthT3();
  context.onTestFinished(() => external.close());
  const factory = await harness.open({
    t3: makeLiveT3({
      credentialsDirectory: join(dirname(harness.databasePath), "credentials"),
      callbackPort: Number(new URL(external.endpoint).port),
      openBrowser: async () => {
        throw new Error("Browser must not open without a callback listener");
      },
    }),
  });
  await factory.configureConnection({ endpoint: external.endpoint });

  // Act
  const result = await factory.authorizeConnection();

  // Assert
  assert(result.ok);
  expect(result.value.state).toBe("authorization-required");
  expect(result.value.explanation).toMatch(/could not bind.*loopback/);
});

it("the original consent window still completes after its approval is reopened", async (context) => {
  // Arrange
  const { factory, external, getAuthorizationUrl } = await openOAuthFactory(context);
  assert((await factory.authorizeConnection()).ok);
  const callback = external.approvalUrl(getAuthorizationUrl());
  assert((await factory.openConnectionAuthorization()).ok);

  // Act
  const approval = await fetch(callback);

  // Assert
  expect(approval.status).toBe(200);
  expect((await recheckConnection(factory)).state).toBe("ready");
});

it("opening authorization after a denied approval starts a new attempt", async (context) => {
  // Arrange
  const { factory, external, openedUrls } = await openOAuthFactory(context);
  assert((await factory.authorizeConnection()).ok);
  const denial = external.approvalUrl(openedUrls[0]!);
  denial.searchParams.delete("code");
  denial.searchParams.set("error", "access_denied");
  expect((await fetch(denial)).status).toBe(400);

  // Act
  const started = await factory.openConnectionAuthorization();

  // Assert
  assert(started.ok);
  expect(started.value.authorizationPending).toBe(true);
  expect(openedUrls).toHaveLength(2);
  expect(new URL(openedUrls[1]!).searchParams.get("state")).not.toBe(
    new URL(openedUrls[0]!).searchParams.get("state"),
  );
});

it("consent completed after a pending inspection is preserved when authorization is opened", async (context) => {
  // Arrange
  const { factory, external, approveOnNextPendingInspection } = await openOAuthFactory(context);
  assert((await factory.authorizeConnection()).ok);
  approveOnNextPendingInspection();

  // Act
  const opened = await factory.openConnectionAuthorization();

  // Assert
  assert(opened.ok);
  expect(opened.value.state).toBe("ready");
  expect(opened.value.authorizationContext).not.toBeNull();
  expect(external.registrationCount).toBe(1);
});
