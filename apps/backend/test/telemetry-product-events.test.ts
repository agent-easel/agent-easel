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
import { remoteServer } from "./support/remote-clients.ts";
import { liveClient, subscribe } from "./support/live.ts";
import { mockIngest } from "./support/telemetry.ts";
import { atlasRepository, triggerWorld } from "./support/triggers.ts";

it("checking an enabled Trigger emits its saved kind and closed outcome without Trigger data", async (context) => {
  const ingest = await mockIngest(context);
  const { f, triggerInput } = await triggerWorld(context, atlasRepository, { env: ingest.env });
  const saved = await f.createTrigger({ ...triggerInput, name: "Private Trigger label" });
  assert(saved.ok);
  const trigger = saved.value.trigger;
  assert(
    (await f.setTriggerEnabled(trigger.id, { enabled: true, reviewedRevision: trigger.revision }))
      .ok,
  );

  const checked = await f.runTrigger(trigger.id, {});
  assert(checked.ok);
  await f.close();

  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"trigger.saved"');
  expect(payload).toContain('"event":"trigger.fired"');
  expect(payload).toContain('"kind":"github_issues"');
  expect(payload).toContain('"outcome":"skipped"');
  expect(payload).not.toContain("Private Trigger label");
  expect(payload).not.toContain(trigger.id);
  expect(payload).not.toContain(atlasRepository.nodeId);
});

it("enabling the remote listener reports only its enabled state and certificate mode", async (context) => {
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, {
    remoteDisabled: true,
    telemetry: { env: ingest.env },
  });

  const enabled = await world.host("PUT", "/api/host/remote-access", { enabled: true });
  assert(enabled.body.ok);
  await world.server.close();

  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"remote_access.toggled"');
  expect(payload).toContain('"enabled":true,"certificateMode":"factory_ca"');
  expect(payload).not.toContain("127.0.0.1");
  expect(payload).not.toContain(world.home);
});

it("an approved client's live connection emits the surface without the device identity", async (context) => {
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, { telemetry: { env: ingest.env } });
  const client = await world.approved("Private device label");

  const rpc = await liveClient(context, client.live());
  const live = subscribe(context, rpc.WatchConnection());
  await live.until((messages) => messages.length > 0);
  await live.stop();
  await world.server.close();

  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"client.connected"');
  expect(payload).toContain('"surface":"approved_remote_client"');
  expect(payload).not.toContain("Private device label");
  expect(payload).not.toContain(client.id);
  expect(payload).not.toContain(client.credential);
});

it("handling a Discord status command reports only its platform and command category", async (context) => {
  const ingest = await mockIngest(context);
  const { factory, model, discord } = await chatControlWorld(context, { env: ingest.env });
  await turnedOn(factory, discord);
  model.script({ toolCalls: [{ name: "find_runs", input: {} }] }, { text: "No Runs found." });

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

  const payload = JSON.stringify(ingest.requests);
  expect(payload).toContain('"event":"chat_control.used"');
  expect(payload).toContain('"platform":"discord","command":"status"');
  expect(payload).not.toContain("Private status question");
  expect(payload).not.toContain(ALLOWED_CHANNEL);
  expect(payload).not.toContain(PARTICIPANT_ID);
});

it("only launching the downloaded version emits the anonymous update and consumes its receipt", async (context) => {
  const ingest = await mockIngest(context);
  const directory = await mkdtemp(join(tmpdir(), "factory-update-receipt-"));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const updateReceipt = join(directory, "private-installation-path");
  await writeFile(
    updateReceipt,
    JSON.stringify({
      channel: "beta",
      fromVersion: "0.9.0",
      toVersion: "0.9.1-beta.1",
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

  const installed = await remoteServer(context, {
    remoteDisabled: true,
    updateReceipt,
    telemetry,
    applicationVersion: "0.9.1-beta.1",
  });
  await installed.server.close();
  await installed.restart();
  await installed.server.close();

  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"update\.installed"/g)).toHaveLength(1);
  expect(payload).toContain('"channel":"beta"');
  expect(payload).toContain('"fromVersion":"0.9.0","toVersion":"0.9.1-beta.1"');
  expect(payload).not.toContain(updateReceipt);
});

it("the feature report accepts an allowlisted action and rejects an arbitrary label", async (context) => {
  const ingest = await mockIngest(context);
  const world = await remoteServer(context, {
    remoteDisabled: true,
    telemetry: { env: ingest.env },
  });

  const valid = await world.host("POST", "/api/feature-usage", "auto_arrange");
  const invalid = await world.host("POST", "/api/feature-usage", "Private Project Name");
  await world.server.close();

  expect(valid.status).toBe(200);
  expect(invalid.status).toBe(400);
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"feature\.used"/g)).toHaveLength(1);
  expect(payload).toContain('"feature":"auto_arrange"');
  expect(payload).not.toContain("Private Project Name");
});
