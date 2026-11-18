import { beforeEach, test } from "./support/test.ts";
import { removeAgentElsewhere } from "./support/agents.ts";
import {
  expectRetainedCleanAgent,
  beforeRetainedCleanAgent,
  expectCleanAgentGuard,
  beforeCleanAgentGuard,
  expectKeptCleanAgent,
  beforeKeptCleanAgent,
  expectDiscardedCleanAgent,
  beforeDiscardedCleanAgent,
  expectMissingRemovedAgent,
  beforeMissingRemovedAgent,
  expectRemovedAgentBackList,
  beforeRemovedAgentBackList,
  expectCopiedEditedAgent,
  beforeCopiedEditedAgent,
  expectAgentJsonFallback,
  beforeAgentJsonFallback,
  expectSelectedAgentJson,
  beforeSelectedAgentJson,
  expectDeletedOwnAgent,
  beforeDeletedOwnAgent,
} from "./support/studio-agent-removal-states.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 1000 });
});

test("external Agent removal closes Delete and retains the clean draft with writes disabled", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRetainedCleanAgent({ app, screen, browser }, "retainedCleanAgent");
  const { agent } = state;

  // Act
  await removeAgentElsewhere(app.baseUrl, agent.id);

  // Assert
  await expectRetainedCleanAgent({ ...state });
});

test("leaving a clean retained Agent asks for discard", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeCleanAgentGuard({ app, screen, browser }, "cleanAgentGuard");

  // Act
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();

  // Assert
  await expectCleanAgentGuard({ ...state });
});

test("Keep editing preserves the clean retained Agent", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeKeptCleanAgent({ app, screen, browser }, "keptCleanAgent");
  const { guard } = state;

  // Act
  await guard.getByRole("button", "Keep editing", { exact: true }).tap();

  // Assert
  await expectKeptCleanAgent({ ...state });
});

test("Discard leaves the retained Agent without another prompt", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeDiscardedCleanAgent({ app, screen, browser }, "discardedCleanAgent");
  const { guard } = state;

  // Act
  await guard.getByRole("button", "Discard", { exact: true }).tap();

  // Assert
  await expectDiscardedCleanAgent({ ...state });
});

test("a removed Agent deep link shows not found", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeMissingRemovedAgent({ app, screen, browser }, "missingRemovedAgent");
  const { agent } = state;

  // Act
  await app.open(`/studio/agents/${agent.id}`);

  // Assert
  await expectMissingRemovedAgent({ ...state });
});

test("Back to list leaves a missing Agent for its list", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeRemovedAgentBackList({ app, screen, browser }, "removedAgentBackList");

  // Act
  await screen.getByRole("button", "Back to list", { exact: true }).tap();

  // Assert
  await expectRemovedAgentBackList({ ...state });
});

test("a retained Agent exports edited JSON to the clipboard", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeCopiedEditedAgent({ app, screen, browser }, "copiedEditedAgent");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectCopiedEditedAgent({ ...state });
});

test("clipboard refusal exposes read-only current Agent JSON", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeAgentJsonFallback({ app, screen, browser }, "agentJsonFallback");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectAgentJsonFallback({ ...state });
});

test("focusing fallback Agent JSON selects the complete draft", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeSelectedAgentJson({ app, screen, browser }, "selectedAgentJson");
  const { json } = state;

  // Act
  await json.focus();

  // Assert
  await expectSelectedAgentJson({ ...state });
});

test("an accepted Agent Delete discards its edits and navigates without another prompt", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeDeletedOwnAgent({ app, screen, browser }, "deletedOwnAgent");

  // Act
  await screen.getByRole("button", "Remove Agent", { exact: true }).tap();

  // Assert
  await expectDeletedOwnAgent({ ...state });
});
