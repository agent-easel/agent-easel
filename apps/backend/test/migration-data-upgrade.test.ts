import { assert, expect, it } from "@effect/vitest";
import {
  currentAgent,
  currentFlow,
  currentRun,
  releasedUpgradeData,
} from "./support/released-upgrade.ts";
import {
  ALLOWED_CHANNEL,
  discordBot,
  discordGuild,
  savedChatModel,
  savedDiscordConnection,
  turnedOn,
} from "./support/chat-control.ts";
import { controlledDiscord, messageEvent, PARTICIPANT_ID } from "./support/controlled-discord.ts";
import { controlledModelProvider } from "./support/controlled-model.ts";

it("upgrading v0.2.0 keeps clients and definitions, as global Flows and Agents, with their execution settings in the project checkout, with an empty Revisit instruction on every Agent block and no Finish block, settles Finished, archives Stopped and pending Stop with their history and titles as legacy without title generation, removes the open Run, leaves Generate Run titles off starts Chat control Off with an empty Language model and Discord connection and treats the saved T3 Code endpoint as First-run setup already completed", async (c) => {
  // Arrange
  const fixture = await releasedUpgradeData(c);
  expect(fixture.pendingStop.closedAt).toBeNull();
  expect(fixture.pendingStop.stopRequestedAt).toEqual(expect.any(String));

  // Act
  const factory = await fixture.h.open({ t3: fixture.t3, connectionRetryMs: 60_000 });

  // Assert
  expect(await factory.listClients()).toStrictEqual({ ok: true, value: fixture.clients });
  const approved = await factory.getClientAccess(fixture.approvedCredential);
  assert(approved.ok);
  expect(approved.value.status).toBe("approved");
  const revoked = await factory.getClientAccess(fixture.revokedCredential);
  assert(revoked.ok);
  expect(revoked.value.status).toBe("revoked");
  expect(await factory.listFlows()).toMatchObject({ ok: true, value: [{ id: fixture.flow.id }] });
  expect(await factory.getFlow(fixture.flow.id)).toStrictEqual({
    ok: true,
    value: { ...currentFlow(fixture.flow), projectId: null },
  });
  expect(await factory.listAgents()).toMatchObject({ ok: true, value: [{ id: fixture.agent.id }] });
  expect(await factory.getAgent(fixture.agent.id)).toStrictEqual({
    ok: true,
    value: { ...currentAgent(fixture.agent), projectId: null },
  });
  const retiredFlow = await factory.getFlow(fixture.retired.flow.id);
  assert(!retiredFlow.ok);
  expect(retiredFlow.error.code).toBe("not_found");
  const retiredAgent = await factory.getAgent(fixture.retired.agent.id);
  assert(!retiredAgent.ok);
  expect(retiredAgent.error.code).toBe("not_found");
  expect(await factory.getRun(fixture.closed.id)).toStrictEqual({
    ok: true,
    value: currentRun(fixture.closed, "settled", null),
  });
  expect(await factory.getRun(fixture.stopped.id)).toStrictEqual({
    ok: true,
    value: currentRun(fixture.stopped, "archived", fixture.flow.revision),
  });
  expect(await factory.getRun(fixture.pendingStop.id)).toStrictEqual({
    ok: true,
    value: currentRun(fixture.pendingStop, "archived", fixture.flow.revision),
  });
  const active = await factory.getRun(fixture.active.id);
  assert(!active.ok);
  expect(active.error.code).toBe("not_found");
  const navigation = await factory.listRunNavigation();
  assert(navigation.ok);
  expect(
    navigation.value.map((entry) => [
      entry.id,
      entry.lifecycle,
      entry.title,
      entry.titleProvenance,
      entry.titleGeneration,
    ]),
  ).toStrictEqual([[fixture.closed.id, "settled", fixture.closed.title, "legacy", null]]);
  expect(await factory.getRunTitleSetting()).toStrictEqual({
    ok: true,
    value: { enabled: false, model: null, diagnostic: null },
  });
  const setup = await factory.getFirstRunSetup();
  assert(setup.ok);
  expect(setup.value.completed).toBe(true);
  expect(await factory.getChatModelSettings()).toStrictEqual({
    ok: true,
    value: {
      chatControlEnabled: false,
      configuration: {
        providerKind: null,
        baseUrl: null,
        model: null,
        keyConfigured: false,
        revision: 0,
        savedAt: null,
      },
      latestTest: null,
      runtimeProblem: null,
      needsAttention: false,
    },
  });
  expect(await factory.getDiscordSettings()).toStrictEqual({
    ok: true,
    value: {
      chatControlEnabled: false,
      connectionStatus: "incomplete",
      connectionProblem: null,
      commandSetup: null,
      needsAttention: false,
      configuration: {
        publicKey: null,
        tokenConfigured: false,
        revision: 0,
        savedAt: null,
      },
      application: null,
      botName: null,
      access: {
        users: [],
        bots: [],
        channels: [],
        unresolvedProjectIds: [],
        userNames: {},
        accountKinds: {},
        channelNames: {},
        test: null,
        revision: 0,
        savedAt: null,
      },
      latestCheck: null,
      delivery: { problems: [], moreProblems: 0, reconciling: [] },
    },
  });
  const tasks = await factory.listTasks(fixture.project.id);
  assert(tasks.ok);
  expect(tasks.value.map((task) => task.id)).toStrictEqual([
    fixture.pendingStop.task.id,
    fixture.stopped.task.id,
    fixture.closed.task.id,
  ]);
});

it("after upgrading v0.2.0 the released Agent saves without a model while its captured Runs keep their execution", async (c) => {
  // Arrange
  const fixture = await releasedUpgradeData(c);
  const factory = await fixture.h.open({ t3: fixture.t3, connectionRetryMs: 60_000 });
  const upgraded = await factory.getAgent(fixture.agent.id);
  assert(upgraded.ok);

  // Act
  const saved = await factory.updateAgent(fixture.agent.id, {
    name: upgraded.value.name,
    prompt: upgraded.value.prompt,
    execution: null,
    exits: upgraded.value.exits,
    expectedRevision: upgraded.value.revision,
    expectedProjectId: upgraded.value.projectId,
    projectOverrides: [],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value).toMatchObject({ revision: fixture.agent.revision + 1, execution: null });
  expect(await factory.getRun(fixture.stopped.id)).toStrictEqual({
    ok: true,
    value: currentRun(fixture.stopped, "archived", fixture.flow.revision),
  });
});

it("upgraded Runs have no originating thread: with Chat control On and their Project granted, an invocation's reply is the only message AgentEasel posts", async (c) => {
  // Arrange
  const fixture = await releasedUpgradeData(c);
  const model = await controlledModelProvider(c);
  const discord = await controlledDiscord(c);
  discord.addBot(discordBot);
  discord.addGuild(discordGuild);
  const factory = await fixture.h.open({
    t3: fixture.t3,
    connectionRetryMs: 60_000,
    discordApiUrl: discord.apiUrl,
  });
  await savedChatModel(factory, { baseUrl: model.baseUrl() });
  await savedDiscordConnection(factory);
  const access = await factory.updateDiscordAccess({
    revision: 0,
    users: [PARTICIPANT_ID],
    bots: [],
    channels: [{ channelId: ALLOWED_CHANNEL, projectIds: [fixture.project.id] }],
  });
  assert(access.ok, JSON.stringify(access));
  await turnedOn(factory, discord);

  // Act
  // Owed cards go out as soon as the session serves, before an invocation is answered.
  discord.deliver(
    messageEvent({
      bot: discordBot,
      guildId: discordGuild.id,
      channelId: ALLOWED_CHANNEL,
      id: "600000000000000001",
    }),
  );

  // Assert
  await discord.createdMessages(1);
  expect(discord.created.map((message) => message.content)).toStrictEqual(["OK"]);
});
