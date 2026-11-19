import { beforeEach, test } from "./support/test.ts";
import { removeFlowElsewhere } from "./support/flows.ts";
import { flowsBreadcrumb } from "./support/studio.ts";
import {
  expectRetainedCleanFlow,
  beforeRetainedCleanFlow,
  expectKeptCleanFlow,
  beforeKeptCleanFlow,
  expectLeftRetainedFlow,
  beforeLeftRetainedFlow,
  expectDiscardedRetainedFlow,
  beforeDiscardedRetainedFlow,
  expectMissingRemovedFlow,
  beforeMissingRemovedFlow,
  expectRemovedFlowBackList,
  beforeRemovedFlowBackList,
  expectCopiedEditedFlow,
  beforeCopiedEditedFlow,
  expectFlowJsonFallback,
  beforeFlowJsonFallback,
  expectSelectedFlowJson,
  beforeSelectedFlowJson,
  expectUpdatedFlowJson,
  beforeUpdatedFlowJson,
  keepRetainedFlow,
} from "./support/studio-flow-removal-states.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1920, height: 1000 });
});
test("external Flow removal closes Remove and retains the clean draft with writes disabled", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeRetainedCleanFlow({ app, screen, browser }, "retainedCleanFlow");
  const { id } = state;

  // Act
  await removeFlowElsewhere(app.baseUrl, id);

  // Assert
  await expectRetainedCleanFlow({ ...state });
});

test("Keep editing preserves the clean retained Flow", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeKeptCleanFlow({ app, screen, browser }, "keptCleanFlow");

  // Act
  const guard = await keepRetainedFlow(screen);

  // Assert
  await expectKeptCleanFlow({ ...state, guard });
});

test("leaving a retained Flow for its list asks for discard", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeLeftRetainedFlow({ app, screen, browser }, "leftRetainedFlow");

  // Act
  await flowsBreadcrumb(screen).tap();

  // Assert
  await expectLeftRetainedFlow({ ...state });
});

test("Discard leaves a retained Flow for its list without another prompt", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeDiscardedRetainedFlow(
    { app, screen, browser },
    "discardedRetainedFlow",
  );
  const { guard } = state;

  // Act
  await guard.getByRole("button", "Discard", { exact: true }).tap();

  // Assert
  await expectDiscardedRetainedFlow({ ...state });
});

test("a removed Flow deep link shows not found", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeMissingRemovedFlow({ app, screen, browser }, "missingRemovedFlow");
  const { id } = state;

  // Act
  await app.open(`/studio/flows/${id}`);

  // Assert
  await expectMissingRemovedFlow({ ...state });
});

test("Back to list leaves a missing Flow for its list", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeRemovedFlowBackList({ app, screen, browser }, "removedFlowBackList");

  // Act
  await screen.getByRole("button", "Back to list", { exact: true }).tap();

  // Assert
  await expectRemovedFlowBackList({ ...state });
});

test("a retained Flow copies current unfinished JSON", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeCopiedEditedFlow({ app, screen, browser }, "copiedEditedFlow");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectCopiedEditedFlow({ ...state });
});

test("clipboard refusal exposes read-only current Flow JSON", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeFlowJsonFallback({ app, screen, browser }, "flowJsonFallback");

  // Act
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();

  // Assert
  await expectFlowJsonFallback({ ...state });
});

test("focusing fallback Flow JSON selects the complete draft", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeSelectedFlowJson({ app, screen, browser }, "selectedFlowJson");
  const { json } = state;

  // Act
  await json.focus();

  // Assert
  await expectSelectedFlowJson({ ...state });
});

test("editing a retained Flow updates its open recovery JSON", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeUpdatedFlowJson({ app, screen, browser }, "updatedFlowJson");

  // Act
  await screen.getByLabel("Flow name", { exact: true }).fill("Recovered unfinished Flow");

  // Assert
  await expectUpdatedFlowJson({ ...state });
});
