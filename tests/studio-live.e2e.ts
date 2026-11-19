import { renameCanvasAgent } from "./support/studio-live-states.ts";
import { test } from "./support/test.ts";
import {
  copyAgentDefinition,
  saveAgentElsewhere,
  removeAgentElsewhere,
  updateAgentExits,
} from "./support/agents.ts";
import { saveSingleAgentFlow, saveFlowElsewhere, removeFlowElsewhere } from "./support/flows.ts";
import {
  expectCreatedAgent,
  beforeCreatedAgent,
  expectCreatedFlow,
  beforeCreatedFlow,
  expectRenamedDependency,
  beforeRenamedDependency,
  expectBrokenDependency,
  beforeBrokenDependency,
  expectRestoredReadiness,
  beforeRestoredReadiness,
  expectReleasedTyping,
  beforeReleasedTyping,
  expectReleasedGesture,
  beforeReleasedGesture,
  expectOfflineFlow,
  beforeOfflineFlow,
  expectReconnectedFlow,
  beforeReconnectedFlow,
  expectDirtyFlow,
  beforeDirtyFlow,
  expectNewestFlowComparison,
  beforeNewestFlowComparison,
  expectReboundFlow,
  beforeReboundFlow,
  expectSavedFlow,
  beforeSavedFlow,
  expectReloadedFlow,
  beforeReloadedFlow,
  expectUnusedAgent,
  beforeUnusedAgent,
  expectRemovedDependency,
  beforeRemovedDependency,
  expectReopenedLatestFlow,
  beforeReopenedLatestFlow,
  expectRemovedFlow,
  beforeRemovedFlow,
  expectCopiedFlow,
  beforeCopiedFlow,
  expectKeptFlow,
  beforeKeptFlow,
  expectCleanAgent,
  beforeCleanAgent,
  expectComparedAgent,
  beforeComparedAgent,
  expectInvalidatedAgentConfirmation,
  beforeInvalidatedAgentConfirmation,
  expectReboundAgent,
  beforeReboundAgent,
  expectSavedAgent,
  beforeSavedAgent,
  expectReloadedAgent,
  beforeReloadedAgent,
  expectRemovedAgent,
  beforeRemovedAgent,
  expectCopiedAgent,
  beforeCopiedAgent,
  expectGuardedAgent,
  beforeGuardedAgent,
  expectMissingFlow,
  beforeMissingFlow,
  expectMissingAgent,
  beforeMissingAgent,
  expectChangedDirtyDependency,
  beforeChangedDirtyDependency,
  expectCheckedBrokenDependency,
  beforeCheckedBrokenDependency,
} from "./support/studio-live-states.ts";
const block = { id: "worker", name: "Worker", x: 320, y: 120 };
test("an independent Agent create updates the open Studio count", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCreatedAgent({ app, screen, browser }, "createdAgent");
  const { prefix } = state;

  // Act
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Acceptance · ${prefix} · Worker`,
  );

  // Assert
  await expectCreatedAgent({ ...state, agent });
});

test("an independent Flow create updates the open Studio list and counts without list reads", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCreatedFlow({ app, screen, browser }, "createdFlow");
  const { prefix, agent } = state;

  // Act
  const id = await saveSingleAgentFlow(
    app.baseUrl,
    `Acceptance · ${prefix} · Flow`,
    agent.name,
    block,
    agent.exits[0]!.id,
  );

  // Assert
  await expectCreatedFlow({ ...state, id });
});

test("an open Flow resolves changed Agent names, execution and ports", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRenamedDependency({ app, screen, browser }, "renamedDependency");
  const { prefix, agent } = state;

  // Act
  const renamed = await renameCanvasAgent(
    app.baseUrl,
    agent,
    `Acceptance · ${prefix} · Renamed worker`,
  );

  // Assert
  await expectRenamedDependency({ ...state, renamed });
});

test("an open clean Flow retains broken wires and its viewport after an Agent exit disappears", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeBrokenDependency({ app, screen, browser }, "brokenDependency");
  const { renamed } = state;

  // Act
  const changed = await saveAgentElsewhere(app.baseUrl, renamed, {
    exits: [
      ...renamed.exits.slice(1),
      { id: "handoff", name: "handoff", description: "", messageRequired: false },
    ],
  });

  // Assert
  await expectBrokenDependency({ ...state, changed });
});

test("restoring the Agent dependency restores clean Flow readiness", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRestoredReadiness({ app, screen, browser }, "restoredReadiness");
  const { agent, changed } = state;

  // Act
  await saveAgentElsewhere(app.baseUrl, changed, {
    exits: agent.exits,
    execution: agent.execution,
  });

  // Assert
  await expectRestoredReadiness({ ...state });
});

test("releasing typing adopts the deferred Flow revision and clears its obsolete selection", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReleasedTyping({ app, screen, browser }, "releasedTyping");
  const { canvas } = state;

  // Act
  await canvas.focus();

  // Assert
  await expectReleasedTyping({ ...state });
});

test("releasing the held canvas gesture adopts the deferred Flow revision without moving the view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReleasedGesture({ app, screen, browser }, "releasedGesture");

  // Act
  await browser.mouse.up();

  // Assert
  await expectReleasedGesture({ ...state });
});

test("an offline Studio refuses Flow saves", async ({ fixture, app, screen, browser }) => {
  // Arrange
  const state = await beforeOfflineFlow({ app, screen, browser }, "offlineFlow");

  // Act
  await fixture.remoteAccess.offline();

  // Assert
  await expectOfflineFlow({ ...state });
});

test("a reconnect snapshot preserves the Flow draft and viewport", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReconnectedFlow({ app, screen, browser }, "reconnectedFlow");

  // Act
  await fixture.remoteAccess.online();

  // Assert
  await expectReconnectedFlow({ ...state });
});

test("a newer saved Flow revision leaves the local draft in reconciliation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeDirtyFlow({ app, screen, browser }, "dirtyFlow");
  const { prefix, revision3 } = state;

  // Act
  const revision4 = await saveFlowElsewhere(app.baseUrl, revision3, {
    name: `Acceptance · ${prefix} · Flow revision 4`,
  });

  // Assert
  await expectDirtyFlow({ ...state, revision4 });
});

test("an open Flow comparison follows the newest saved revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeNewestFlowComparison({ app, screen, browser }, "newestFlowComparison");
  const { prefix, revision4 } = state;

  // Act
  const revision5 = await saveFlowElsewhere(app.baseUrl, revision4, {
    name: `Acceptance · ${prefix} · Flow revision 5`,
  });

  // Assert
  await expectNewestFlowComparison({ ...state, revision5 });
});

test("keeping a Flow draft against the newest revision sends no save", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReboundFlow({ app, screen, browser }, "reboundFlow");
  const comparison = screen.getByRole("dialog", "Compare with revision 5");

  // Act
  await comparison.getByRole("button", "Keep my edits", { exact: true }).tap();

  // Assert
  await expectReboundFlow({ ...state });
});

test("Save commits the rebound Flow draft without a false external conflict", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeSavedFlow({ app, screen, browser }, "savedFlow");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectSavedFlow({ ...state });
});

test("the rebound Flow save persists across reload", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeReloadedFlow({ app, screen, browser }, "reloadedFlow");

  // Act
  await browser.reload();

  // Assert
  await expectReloadedFlow({ ...state });
});

test("an external Flow graph save updates the open Agent usage count", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeUnusedAgent({ app, screen, browser }, "unusedAgent");
  const { ownFlow, empty } = state;

  // Act
  await saveFlowElsewhere(app.baseUrl, ownFlow, { graph: empty });

  // Assert
  await expectUnusedAgent({ ...state });
});

test("an external Agent removal removes its open Studio list entry", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRemovedDependency({ app, screen, browser }, "removedDependency");
  const { agent } = state;

  // Act
  await removeAgentElsewhere(app.baseUrl, agent.id);

  // Assert
  await expectRemovedDependency({ ...state });
});

test("reopening a Flow left clean shows its newest saved revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReopenedLatestFlow({ app, screen, browser }, "reopenedLatestFlow");
  const { prefix } = state;

  // Act
  await screen.getByRole("link", new RegExp(`Acceptance · ${prefix} · Local Flow`)).tap();

  // Assert
  await expectReopenedLatestFlow({ ...state });
});

test("an external Flow removal closes comparison and retains recovery with disabled writes", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRemovedFlow({ app, screen, browser }, "removedFlow");
  const { id } = state;

  // Act
  await removeFlowElsewhere(app.baseUrl, id);

  // Assert
  await expectRemovedFlow({ ...state });
});

test("a retained Flow copies its actual create-shape JSON to the granted clipboard", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCopiedFlow({ app, screen, browser }, "copiedFlow");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectCopiedFlow({ ...state });
});

test("Keep editing stays on a removed Flow's retained draft", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeKeptFlow({ app, screen, browser }, "keptFlow");
  const { flowGuard } = state;

  // Act
  await flowGuard.getByRole("button", "Keep editing", { exact: true }).tap();

  // Assert
  await expectKeptFlow({ ...state });
});

test("the Agent editor adopts an external revision in the same Studio history", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCleanAgent({ app, screen, browser }, "cleanAgent");
  const { prefix, currentAgent } = state;

  // Act
  const cleanAgent = await saveAgentElsewhere(app.baseUrl, currentAgent, {
    name: `Acceptance · ${prefix} · Agent revision 3`,
  });

  // Assert
  await expectCleanAgent({ ...state, cleanAgent });
});

test("an Agent comparison shows the retained local prompt", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeComparedAgent({ app, screen, browser }, "comparedAgent");
  const { agentPanel } = state;

  // Act
  await agentPanel.getByRole("button", "Compare latest revision", { exact: true }).tap();

  // Assert
  await expectComparedAgent({ ...state });
});

test("a newer Agent revision invalidates the open Load confirmation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeInvalidatedAgentConfirmation(
    { app, screen, browser },
    "invalidatedAgentConfirmation",
  );
  const { prefix, agent4 } = state;

  // Act
  await saveAgentElsewhere(app.baseUrl, agent4, {
    prompt: `Acceptance · ${prefix} · Saved prompt 5`,
  });

  // Assert
  await expectInvalidatedAgentConfirmation({ ...state });
});

test("keeping Agent edits against the newest revision sends no save", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeReboundAgent({ app, screen, browser }, "reboundAgent");
  const comparison = screen.getByRole("dialog", "Compare latest revision");

  // Act
  await comparison.getByRole("button", "Keep my edits against revision 5", { exact: true }).tap();

  // Assert
  await expectReboundAgent({ ...state });
});

test("Save commits the rebound Agent draft", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeSavedAgent({ app, screen, browser }, "savedAgent");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectSavedAgent({ ...state });
});

test("the rebound Agent save persists across reload", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeReloadedAgent({ app, screen, browser }, "reloadedAgent");

  // Act
  await browser.reload();

  // Assert
  await expectReloadedAgent({ ...state });
});

test("external Agent removal closes comparison and retains recovery with disabled writes", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRemovedAgent({ app, screen, browser }, "removedAgent");
  const { marker } = state;

  // Act
  await removeAgentElsewhere(app.baseUrl, marker.id);

  // Assert
  await expectRemovedAgent({ ...state });
});

test("a retained Agent copies its actual create-shape JSON to the granted clipboard", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCopiedAgent({ app, screen, browser }, "copiedAgent");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectCopiedAgent({ ...state });
});

test("leaving a retained Agent asks for explicit discard", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeGuardedAgent({ app, screen, browser }, "guardedAgent");

  // Act
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();

  // Assert
  await expectGuardedAgent({ ...state });
});

test("a removed Flow deep link shows not found", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeMissingFlow({ app, screen, browser }, "missingFlow");
  const { id } = state;

  // Act
  await app.open(`/studio/flows/${id}`);

  // Assert
  await expectMissingFlow({ ...state });
});

test("a removed Agent deep link shows not found", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeMissingAgent({ app, screen, browser }, "missingAgent");
  const { marker } = state;

  // Act
  await app.open(`/studio/agents/${marker.id}`);

  // Assert
  await expectMissingAgent({ ...state });
});

test("an Agent exit change invalidates an open dirty Flow readiness and retains its broken wire", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeChangedDirtyDependency(
    { app, screen, browser },
    "changedDirtyDependency",
  );
  const { agent, handoff } = state;

  // Act
  await updateAgentExits(app.baseUrl, agent, [...agent.exits.slice(1), handoff]);

  // Assert
  await expectChangedDirtyDependency({ ...state });
});

test("the readiness issues report the removed Agent exit", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeCheckedBrokenDependency(
    { app, screen, browser },
    "checkedBrokenDependency",
  );

  // Act
  await screen.getByRole("button", /^Not ready/).tap();

  // Assert
  await expectCheckedBrokenDependency({ ...state });
});
