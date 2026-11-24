import { expect, type Screen } from "e2e";
import { test } from "./support/test.ts";
import { applyRunState, prepareScenario } from "./support/scenarios.ts";
import { readHistoryRun, readInvocationHistory } from "./support/run-history.ts";

async function openInvocationHistory(screen: Screen) {
  const inspector = screen.getByRole("complementary", "Run inspector");
  await inspector.getByRole("button", "Show history", { exact: true }).tap();
  const history = inspector.getByRole("region", "Invocation history", { exact: true });
  return { inspector, history };
}

test("a Stop acknowledgment leaves the chosen Subflow ending held", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const { id } = await prepareScenario(app, "subflow-closing");
  const run = await readHistoryRun(app.baseUrl, id);
  expect(run.subflows?.[0]?.defaultInvocation).toMatchObject({
    state: "stopping",
    stops: [{ outcome: "acknowledged" }],
    ending: { delivery: "held", releasedAt: null },
  });

  // Act
  await app.open(`/runs/${id}`);
  await screen.getByRole("button", "Inspect Subflow invocation 1", { exact: true }).tap();

  // Assert
  const inspector = screen.getByRole("complementary", "Run inspector");
  await expect(inspector).toContainText("Stop acknowledged");
  await expect(inspector).toContainText("Release pending");
  await expect(inspector).toContainText("Approved");
  await expect(screen.getByRole("region", "Execution canvas")).toHaveAttribute(
    "data-following",
    "false",
  );
  await app.screenshot("subflow-stop-acknowledged-release-pending");
});

test("selecting a returned invocation from history shows its recipient and producing worker", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1080 });
  const { id } = await prepareScenario(app, "subflow-returned");
  const run = await readHistoryRun(app.baseUrl, id);
  const invocation = run.subflows?.[0]?.defaultInvocation;
  expect(invocation?.ending).toMatchObject({
    delivery: "released",
    endingName: "Approved",
    recipients: [{ blockId: "notes", disposition: "acknowledged" }],
  });
  await app.open(`/runs/${id}`);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await screen.getByRole("button", "Inspect Subflow invocation 1", { exact: true }).tap();
  const { inspector, history } = await openInvocationHistory(screen);
  const worker = run.threadBindings.find(
    (item) => item.threadId === invocation?.ending?.origin?.threadId,
  );

  // Act
  await history.getByRole("button", "Invocation 1 · Approved", { exact: true }).tap();

  // Assert
  await expect(inspector).toContainText("Code review → Approved · Visit 1");
  expect(worker?.link).toBeTruthy();
  await expect(
    inspector
      .getByRole("region", "Selected invocation", { exact: true })
      .getByRole("link", "Open in T3 Code", { exact: true })
      .first(),
  ).toHaveAttribute("href", worker!.link!);
  await expect(inspector.getByRole("region", "Recipients", { exact: true })).toContainText(
    "Acknowledged",
  );
  await expect(screen.getByRole("region", "Timeline", { exact: true })).toContainText("Released");
  await expect(
    screen.getByRole("region", "Execution canvas").getByRole("article", "Subflow Review panel"),
  ).toContainText("Released");
  await app.screenshot("subflow-released-and-acknowledged");
});

test("an expanded Subflow can collapse and reopen its captured input", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1080 });
  const { id } = await prepareScenario(app, "subflow-closing");
  await app.open(`/runs/${id}`);
  const canvas = screen.getByRole("region", "Execution canvas");
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await canvas.getByRole("button", "Collapse Review panel", { exact: true }).tap();

  // Act
  await canvas.getByRole("button", "Expand Review panel", { exact: true }).tap();

  // Assert
  await expect(canvas.getByText("Search is ready for review.", { exact: true })).toBeVisible();
  await expect(canvas.getByRole("article", "Block Code review", { exact: true })).toBeVisible();
});

test("an older pinned invocation updates its live recipient beside the same default invocation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1080 });
  const { id } = await prepareScenario(app, "subflow-serial");
  const before = await readHistoryRun(app.baseUrl, id);
  const placement = before.subflows?.find((item) => item.blockId === "panel");
  const defaultId = placement?.defaultInvocation?.id;
  expect(placement?.defaultInvocation).toMatchObject({ number: 2, state: "active" });
  const prior = await readInvocationHistory(app.baseUrl, id, "panel");
  const old = prior.invocations[1]!;
  expect(old.ending?.recipients).toEqual([
    { blockId: "notes", targetEndingId: null, disposition: "pending" },
  ]);
  expect(before.blocks.some((item) => item.threadId === old.ending?.origin?.threadId)).toBe(false);
  await app.open(`/runs/${id}`);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  const canvas = screen.getByRole("region", "Execution canvas");
  const group = canvas.getByRole("article", "Subflow Review panel", { exact: true });
  await group.getByRole("button", "Inspect Subflow invocation 2", { exact: true }).tap();
  const { inspector, history } = await openInvocationHistory(screen);
  const first = history.getByRole("button", "Invocation 1 · Approved", { exact: true });
  const second = history.getByRole("button", "Invocation 2 · Running", { exact: true });
  await first.tap();
  await second.tap();
  await expect(second).toHaveAttribute("aria-current", "true");
  await first.tap();
  const recipients = inspector.getByRole("region", "Recipients", { exact: true });
  await expect(recipients).toContainText("Pending");
  await app.screenshot("older-invocation-recipient-pending");

  // Act
  await applyRunState(app, id, "release notes ready for revisit");

  // Assert
  await expect
    .poll(async () => {
      const page = await readInvocationHistory(app.baseUrl, id, "panel");
      return page.invocations[1]?.ending?.recipients[0]?.disposition;
    })
    .toBe("acknowledged");
  const after = await readHistoryRun(app.baseUrl, id);
  expect(after.subflows?.find((item) => item.blockId === "panel")?.defaultInvocation?.id).toBe(
    defaultId,
  );
  const summary =
    "Invocation 1 · Approved · Released · Worker Code reviewer · Visit 2 · Release notes acknowledged";
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(recipients).toContainText("Acknowledged");
  await expect(inspector).toContainText("Code reviewer · Visit 2");
  await expect(
    group.getByRole("button", "Inspect Subflow invocation 1", { exact: true }),
  ).toHaveAttribute("title", summary);
  await expect(screen.getByRole("region", "Timeline", { exact: true })).toContainText(summary);
  expect(
    after.threadBindings.find((item) => item.threadId === old.ending?.origin?.threadId),
  ).toMatchObject({
    blockName: "Code reviewer",
  });
  await app.screenshot("older-invocation-recipient-acknowledged");
});

test("Auto-arrange moves the expanded Run view while preserving captured positions", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1080 });
  const { id } = await prepareScenario(app, "subflow-closing");
  const captured = await readHistoryRun(app.baseUrl, id);
  await app.open(`/runs/${id}`);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  const group = screen.getByRole("article", "Subflow Review panel", { exact: true });
  const before = await group.boundingBox();

  // Act
  await screen.getByRole("button", "Auto-arrange", { exact: true }).tap();

  // Assert
  await expect.poll(() => group.boundingBox()).not.toEqual(before);
  await expect(screen.getByRole("button", "Auto-arrange", { exact: true })).toBeEnabled();
  await expect(group).toBeVisible();
  expect((await readHistoryRun(app.baseUrl, id)).definitions).toEqual(captured.definitions);
});

async function openFittedSubflowReturned(
  app: Parameters<typeof prepareScenario>[0] & { open: (path: string) => Promise<void> },
  browser: { setViewport: (size: { width: number; height: number }) => Promise<void> },
  screen: Screen,
) {
  await browser.setViewport({ width: 1920, height: 1080 });
  const { id } = await prepareScenario(app, "subflow-returned");
  await app.open(`/runs/${id}`);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  return screen.getByRole("region", "Execution canvas");
}

test("hovering a Block inside an expanded Subflow emphasizes its outgoing wires", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const canvas = await openFittedSubflowReturned(app, browser, screen);
  const innerBlock = canvas.getByRole("article", "Block Code review", { exact: true });

  // Act
  await innerBlock.hover();

  // Assert
  await expect(
    browser.locator(
      '[aria-label="Execution canvas"] [data-canvas-scope] path[marker-end="url(#execution-arrow-emphasis)"]',
    ),
  ).toHaveCount(2);
  await expect(
    browser.locator(
      '[aria-label="Execution canvas"] path[marker-end="url(#execution-arrow-emphasis)"]',
    ),
  ).toHaveCount(2);
  await app.screenshot("subflow-inner-block-hover-wires");
});

test("tabbing to the inner Flow input inside an expanded Subflow emphasizes its outgoing wires in its scope", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const canvas = await openFittedSubflowReturned(app, browser, screen);
  const releaseNotes = canvas
    .getByRole("article", "Block Release notes", { exact: true })
    .getByRole("button");
  await releaseNotes.focus();

  // Act
  await releaseNotes.press("Tab");

  // Assert
  await expect(
    browser.locator('[aria-label="Execution canvas"] [data-canvas-scope] [data-flow-input] button'),
  ).toBeFocused();
  await expect(
    browser.locator(
      '[aria-label="Execution canvas"] [data-canvas-scope] path[marker-end="url(#execution-arrow-emphasis)"]',
    ),
  ).toHaveCount(2);
  await expect(
    browser.locator(
      '[aria-label="Execution canvas"] path[marker-end="url(#execution-arrow-emphasis)"]',
    ),
  ).toHaveCount(2);
});
