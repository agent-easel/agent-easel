import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, expect, it } from "@effect/vitest";
import {
  chatControlWorld,
  ALLOWED_CHANNEL,
  discordBot,
  discordGuild,
  POSTS,
  turnedOn,
} from "./support/chat-control.ts";
import { messageEvent, PARTICIPANT_ID } from "./support/controlled-discord.ts";
import { answeringWorld, answerCall, clicked, proposed } from "./support/chat-actions.ts";
import { remoteServer } from "./support/remote-clients.ts";
import { liveClient, subscribe } from "./support/live.ts";
import { mockIngest } from "./support/telemetry.ts";
import { atlasRepository, triggerWorld } from "./support/triggers.ts";

it("saving a Trigger reports its kind without its label or repository", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const { f, triggerInput } = await triggerWorld(context, atlasRepository, { env: ingest.env });

  // Act
  const saved = await f.createTrigger({ ...triggerInput, name: "Private Trigger label" });
  await f.close();

  // Assert
  assert(saved.ok);
  expect(ingest.events("trigger.saved")).toMatchObject([{ properties: { kind: "github_issues" } }]);
  const payload = JSON.stringify(ingest.events("trigger.saved"));
  expect(payload).not.toContain("Private Trigger label");
  expect(payload).not.toContain(saved.value.trigger.id);
  expect(payload).not.toContain(atlasRepository.nodeId);
});

it("checking an enabled Trigger emits its saved kind and closed outcome without Trigger data", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const { f, triggerInput } = await triggerWorld(context, atlasRepository, { env: ingest.env });
  const saved = await f.createTrigger({ ...triggerInput, name: "Private Trigger label" });
  assert(saved.ok);
  const trigger = saved.value.trigger;
  assert(
    (await f.setTriggerEnabled(trigger.id, { enabled: true, reviewedRevision: trigger.revision }))
      .ok,
  );

  // Act
  const checked = await f.runTrigger(trigger.id, {});
  assert(checked.ok);
  await f.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"trigger.fired"');
  expect(payload).toContain('"kind":"github_issues"');
  expect(payload).toContain('"outcome":"skipped"');
  expect(payload).not.toContain("Private Trigger label");
  expect(payload).not.toContain(trigger.id);
  expect(payload).not.toContain(atlasRepository.nodeId);
});

it("enabling the remote listener reports only its enabled state and certificate mode", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, {
    remoteDisabled: true,
    telemetry: { env: ingest.env },
  });

  // Act
  const enabled = await world.host("PUT", "/api/host/remote-access", { enabled: true });
  assert(enabled.body.ok);
  await world.server.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"remote_access.toggled"');
  expect(payload).toContain('"enabled":true,"certificateMode":"factory_ca"');
  expect(payload).not.toContain("127.0.0.1");
  expect(payload).not.toContain(world.home);
});

it("an approved client's live connection emits the surface without the device identity", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, { telemetry: { env: ingest.env } });
  const client = await world.approved("Private device label");

  // Act
  const rpc = await liveClient(context, client.live());
  const live = subscribe(context, rpc.WatchConnection());
  await live.until((messages) => messages.length > 0);
  await live.stop();
  await world.server.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"client.connected"');
  expect(payload).toContain('"surface":"approved_remote_client"');
  expect(payload).not.toContain("Private device label");
  expect(payload).not.toContain(client.id);
  expect(payload).not.toContain(client.credential);
});

it("handling a Discord status command reports only its platform and command category", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const { factory, model, discord } = await chatControlWorld(context, { env: ingest.env });
  await turnedOn(factory, discord);
  model.script(
    {
      toolCalls: [
        { name: "find_runs", input: {} },
        { name: "find_runs", input: {} },
      ],
    },
    { text: "No Runs found." },
  );

  // Act
  discord.deliver(
    messageEvent({
      bot: discordBot,
      guildId: discordGuild.id,
      channelId: ALLOWED_CHANNEL,
      id: "300000000000000010",
      content: "Private status question",
    }),
  );
  await discord.request("POST", POSTS);
  await factory.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"chat_control.used"/g)).toHaveLength(1);
  expect(payload).toContain('"platform":"discord","command":"status"');
  expect(payload).not.toContain("Private status question");
  expect(payload).not.toContain(ALLOWED_CHANNEL);
  expect(payload).not.toContain(PARTICIPANT_ID);
});

it("only launching the downloaded version emits the anonymous update and consumes its receipt", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const directory = await mkdtemp(join(tmpdir(), "factory-update-receipt-"));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const updateReceipt = join(directory, "private-installation-path");
  await writeFile(
    updateReceipt,
    JSON.stringify({
      receiptId: "ae611bbb-a1c7-4004-8000-04def5e621b9",
      fromVersion: "0.9.0",
      toVersion: "0.9.1",
    }),
  );
  const telemetry = { env: ingest.env, packagedChannel: "stable" as const };
  const previous = await remoteServer(context, {
    remoteDisabled: true,
    updateReceipt,
    telemetry,
    applicationVersion: "0.9.0",
  });
  await previous.server.close();
  expect(JSON.stringify(ingest.requests)).not.toContain('"event":"update.installed"');

  // Act
  const installed = await remoteServer(context, {
    remoteDisabled: true,
    updateReceipt,
    telemetry,
    applicationVersion: "0.9.1",
  });
  await installed.server.close();
  await installed.restart();
  await installed.server.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"update\.installed"/g)).toHaveLength(1);
  expect(ingest.events("update.installed")).toMatchObject([{ properties: { channel: "stable" } }]);
  expect(payload).toContain('"fromVersion":"0.9.0","toVersion":"0.9.1"');
  expect(payload).not.toContain(updateReceipt);
});

it("the feature report accepts an allowlisted action and rejects an arbitrary label", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, {
    remoteDisabled: true,
    telemetry: { env: ingest.env },
  });

  // Act
  const valid = await world.host("POST", "/api/feature-usage", "auto_arrange");
  const invalid = await world.host("POST", "/api/feature-usage", "Private Project Name");
  await world.server.close();

  expect(valid.status).toBe(200);
  expect(invalid.status).toBe(400);
  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"feature\.used"/g)).toHaveLength(1);
  expect(payload).toContain('"feature":"auto_arrange"');
  expect(payload).not.toContain("Private Project Name");
});

it("an approved desktop's retried installed receipt counts once across a host restart", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, { telemetry: { env: ingest.env } });
  const laptop = await world.approved("Private laptop");
  const receipt = {
    receiptId: "ae611bbb-a1c7-4004-8000-04def5e621b9",
    fromVersion: "0.9.0-beta.1",
    toVersion: "0.9.0",
  };
  const path = "/api/client-update/installed";

  // Act
  await laptop.sendLosingResponse("POST", path, receipt);
  await world.restart();
  const retried = await laptop.send("POST", path, receipt);
  await world.server.close();

  // Assert
  expect(retried.status).toBe(200);
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"update.installed"/g)).toHaveLength(1);
  expect(payload).toContain('"fromVersion":"0.9.0-beta.1","toVersion":"0.9.0"');
  expect(payload).not.toContain(receipt.receiptId);
  expect(payload).not.toContain(laptop.id);
});

it("a host opt-out consumes the desktop receipt even if the client retries after opt-in", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, { telemetry: { env: ingest.env } });
  const laptop = await world.approved("Laptop");
  const receipt = {
    receiptId: "ae611bbb-a1c7-4004-8000-04def5e621b9",
    fromVersion: "1.0.0",
    toVersion: "1.0.1-beta.1",
  };
  const path = "/api/client-update/installed";
  assert((await world.host("PUT", "/api/settings/telemetry", { telemetryEnabled: false })).body.ok);

  // Act
  const consumed = await laptop.send("POST", path, receipt);
  assert((await world.host("PUT", "/api/settings/telemetry", { telemetryEnabled: true })).body.ok);
  const retry = await laptop.send("POST", path, receipt);
  await world.server.close();

  // Assert
  expect([consumed.status, retry.status]).toEqual([200, 200]);
  expect(ingest.events("update.installed")).toHaveLength(0);
});

it("the installed receipt endpoint requires an approved desktop", async (context) => {
  // Arrange
  const world = await remoteServer(context);
  const desktop = world.client();
  const browser = await world.approved("Browser", "browser");
  const receipt = {
    receiptId: "ae611bbb-a1c7-4004-8000-04def5e621b9",
    fromVersion: "1.0.0",
    toVersion: "1.0.1",
  };

  // Act
  const unapproved = await desktop.send("POST", "/api/client-update/installed", receipt);
  const wrongSurface = await browser.send("POST", "/api/client-update/installed", receipt);

  // Assert
  expect([unapproved.status, wrongSurface.status]).toEqual([401, 401]);
});

it("an approved desktop cannot attach arbitrary data to an update", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, { telemetry: { env: ingest.env } });
  const client = await world.approved("Laptop");

  // Act
  const rejected = await client.send("POST", "/api/client-update/installed", {
    receiptId: "ae611bbb-a1c7-4004-8000-04def5e621b9",
    fromVersion: "1.0.0",
    toVersion: "1.0.1",
    url: "private source",
  });
  await world.server.close();

  // Assert
  expect(rejected.status).toBe(400);
  expect(ingest.events("update.installed")).toHaveLength(0);
});

it("reading a Run to answer a Human step counts the confirmed reply in its own category", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const world = await answeringWorld(context, undefined, { env: ingest.env });
  world.model.script({ toolCalls: [{ name: "read_run", input: { run: "#1" } }] });
  const button = await proposed(world, "600000000000000001", 2, answerCall(world), "approve #1");

  // Act
  await clicked(world.discord, button, "610000000000000001", 1);
  await world.factory.close();

  // Assert
  expect(ingest.events("chat_control.used")).toMatchObject([
    { properties: { platform: "discord", command: "human_reply" } },
  ]);
});
