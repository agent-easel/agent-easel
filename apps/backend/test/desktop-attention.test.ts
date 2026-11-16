import { expect, it, type TestContext } from "@effect/vitest";
import { recordThreadFacts } from "./support/controlled-thread.ts";
import { desktopAttention } from "./support/desktop-attention.ts";
import { currentConnection, desktopProfile, selectServer } from "./support/desktop-client.ts";
import { remotePrepared, remoteServer } from "./support/remote-clients.ts";
import { observeFor, workerLaunched } from "./support/scenarios.ts";

type Prepared = Awaited<ReturnType<typeof remotePrepared>>;

/** A worker of a Run on `server` asks a native T3 question, which Factory observes. */
async function nativeQuestionAsked({ server, t3, input }: Prepared) {
  const world = { factory: server.factory, t3 };
  const worker = await workerLaunched(world, input);
  recordThreadFacts(t3, worker.threadId, { pendingRequestCount: 1 });
  await observeFor("observe the native question", world, worker.runId, (run) =>
    run.attention.some((matter) => matter.kind === "native-request" && !matter.settledAt),
  );
}

const hostSelection = (server: Prepared["server"]) =>
  ({ server: "server", target: { kind: "host", base: server.hostBase() } }) as const;

/** The approved desktop client's selection, holding the laptop's issued credential. */
async function clientSelection(
  context: TestContext,
  server: Awaited<ReturnType<typeof remoteServer>>,
  credential: string,
) {
  const { client } = await desktopProfile(context);
  const probe = await selectServer(client, server);
  await currentConnection(client).rememberCredential(credential);
  return {
    server: `client ${probe.url}`,
    target: { kind: "remote", connection: currentConnection(client) },
  } as const;
}

it("a desktop server's own subscription badges and announces a Run that newly needs input", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const alerts = await desktopAttention(c, hostSelection(prepared.server));

  // Act
  await nativeQuestionAsked(prepared);

  // Assert
  await alerts.until(() => alerts.shown.length > 0 && alerts.badges.at(-1) === "1");
  expect(alerts.shown.map(({ title }) => title)).toStrictEqual(["A Run needs your input"]);
});

it("an approved desktop client's own subscription badges and announces a Run that newly needs input", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const selection = await clientSelection(c, prepared.server, prepared.laptop.credential);
  const alerts = await desktopAttention(c, selection);

  // Act
  await nativeQuestionAsked(prepared);

  // Assert
  await alerts.until(() => alerts.shown.length > 0 && alerts.badges.at(-1) === "1");
  expect(alerts.shown.map(({ title }) => title)).toStrictEqual(["A Run needs your input"]);
});

it("stopping a desktop server's backend clears the Dock badge", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const alerts = await desktopAttention(c, hostSelection(prepared.server));
  await nativeQuestionAsked(prepared);
  await alerts.until(() => alerts.badges.at(-1) === "1");

  // Act
  await prepared.server.server.close();

  // Assert
  await alerts.until(() => alerts.badges.at(-1) === "");
});

it("a desktop client that loses its server clears the Dock badge", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const selection = await clientSelection(c, prepared.server, prepared.laptop.credential);
  const alerts = await desktopAttention(c, selection);
  await nativeQuestionAsked(prepared);
  await alerts.until(() => alerts.badges.at(-1) === "1");

  // Act
  await prepared.server.server.close();

  // Assert
  await alerts.until(() => alerts.badges.at(-1) === "");
});

it("a desktop client of an incompatible server never badges or announces", async (c) => {
  // Arrange
  const server = await remoteServer(c, { protocol: { protocol: 14, minimumPeerProtocol: 9 } });
  const laptop = await server.approved("Laptop", "desktop", { protocol: 14, minimum: 9 });
  const selection = await clientSelection(c, server, laptop.credential);

  // Act
  const alerts = await desktopAttention(c, selection);

  // Assert
  await alerts.until(() => alerts.badges.length > 1);
  expect({ badges: [...new Set(alerts.badges)], shown: alerts.shown }).toStrictEqual({
    badges: [""],
    shown: [],
  });
});

it("forgetting a server deletes its alert history, so reconnecting announces its pending matter again", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const selection = await clientSelection(c, prepared.server, prepared.laptop.credential);
  const alerts = await desktopAttention(c, selection);
  await nativeQuestionAsked(prepared);
  await alerts.until(() => alerts.shown.length === 1);
  await alerts.forget(selection.server);

  // Act
  alerts.follow(await clientSelection(c, prepared.server, prepared.laptop.credential));

  // Assert
  await alerts.until(() => alerts.shown.length === 2);
  expect(alerts.shown.map(({ title }) => title)).toStrictEqual([
    "A Run needs your input",
    "A Run needs your input",
  ]);
});

it("revoking a desktop client clears its Dock badge and withdraws its notifications", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const selection = await clientSelection(c, prepared.server, prepared.laptop.credential);
  const alerts = await desktopAttention(c, selection);
  await nativeQuestionAsked(prepared);
  await alerts.until(() => alerts.shown.length === 1 && alerts.badges.at(-1) === "1");

  // Act
  const revoked = await prepared.server.host(
    "POST",
    `/api/host/clients/${prepared.laptop.id}/revoke`,
  );

  // Assert
  expect(revoked.body.ok).toBe(true);
  await alerts.until(() => alerts.withdrawn.length > 0 && alerts.badges.at(-1) === "");
  expect(alerts.withdrawn).toStrictEqual([alerts.shown[0]!.id]);
});

it("a revoked desktop client that the owner approves again resumes its Dock badge", async (c) => {
  // Arrange
  const prepared = await remotePrepared(c);
  const selection = await clientSelection(c, prepared.server, prepared.laptop.credential);
  const alerts = await desktopAttention(c, selection);
  await nativeQuestionAsked(prepared);
  await alerts.until(() => alerts.shown.length === 1 && alerts.badges.at(-1) === "1");
  await prepared.server.host("POST", `/api/host/clients/${prepared.laptop.id}/revoke`);
  await alerts.until(() => alerts.withdrawn.length > 0);
  const again = await prepared.server.approved("Laptop");

  // Act
  await selection.target.connection.rememberCredential(again.credential);

  // Assert
  await alerts.until(() => alerts.badges.at(-1) === "1");
  expect(alerts.shown).toHaveLength(1);
});
