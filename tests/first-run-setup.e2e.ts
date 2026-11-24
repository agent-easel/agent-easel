import assert from "node:assert/strict";
import { test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import type { FirstRunSetup, Result, T3Connection } from "../packages/contracts/src/index.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";

type FreshOptions = Parameters<Fixture["firstRunSetup"]["fresh"]>[0];

/** A fresh host, seen in the accepted Figma frames' 1440 × 900 dark appearance. */
async function freshHost(
  { fixture, browser }: { fixture: Fixture; browser: Browser },
  options?: FreshOptions,
) {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
  await fixture.firstRunSetup.fresh(options);
}

/** A fresh host's setup screen. */
async function openFreshSetup(
  context: { fixture: Fixture; app: App; browser: Browser },
  options?: FreshOptions,
) {
  await freshHost(context, options);
  await context.app.open("/runs/new");
}

/** Live delivery enables actions once current; a frame waits for the button's fade-in. */
async function expectActionShown(browser: Browser, label: string) {
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle([...document.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)})).opacity`,
      ),
    )
    .toBe("1");
}

/** Connect on the detected T3 started approval in the host's browser. */
async function connectDetected(screen: Screen) {
  await screen.getByRole("button", "Connect").tap();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
}

/** No address entry is open and no product route mounts behind the setup screen. */
async function expectNoAddressFormOrApplication(screen: Screen) {
  await expect(screen.getByRole("button", "Save and connect")).toHaveCount(0);
  await expect(screen.getByRole("link", /^Settings/)).toHaveCount(0);
}

/** Step 1 turned done once T3 Connected, and step 2 is the current step. */
async function expectInstallStepOpen(screen: Screen) {
  await expect(screen.getByRole("heading", "Connected to T3 Code 0.1.11, done")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible();
}

/** A fresh host connected to the detected T3, on its install step. */
async function openInstallStep(
  context: { fixture: Fixture; app: App; browser: Browser; screen: Screen },
  options: FreshOptions,
) {
  await openFreshSetup(context, options);
  await connectDetected(context.screen);
  await context.fixture.firstRunSetup.t3Approve();
  await expectInstallStepOpen(context.screen);
}

/** A fresh host installed in both harnesses T3 has on: Ready offers Open Factory. */
async function readyHost(context: {
  fixture: Fixture;
  app: App;
  browser: Browser;
  screen: Screen;
}) {
  await openInstallStep(context, {});
  await context.screen.getByRole("button", "Install in 2 harnesses").tap();
  await expect(context.screen.getByRole("heading", "AgentEasel is ready")).toBeVisible({
    timeout: 8_000,
  });
  await expectActionShown(context.browser, "Open AgentEasel");
}

/** The harness list is being read again, and nothing rests on the earlier one meanwhile. */
async function expectListBeingRead(screen: Screen) {
  await expect(screen.getByText("Checking harnesses…")).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
  await expect(screen.getByRole("group", "Claude", { exact: true })).toHaveCount(0);
}

/** A host API call that must succeed: a refused or failed call fails the journey here. */
async function hostCall<T>(baseUrl: string | undefined, path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, baseUrl), init);
  const result = (await response.json()) as Result<T>;
  assert(result.ok, `${init?.method ?? "GET"} ${path} failed: ${JSON.stringify(result)}`);
  return result.value;
}

const setupCompleted = async (baseUrl: string | undefined) =>
  (await hostCall<FirstRunSetup>(baseUrl, "/api/setup")).completed;

const savedEndpoint = async (baseUrl: string | undefined) =>
  (await hostCall<T3Connection>(baseUrl, "/api/connection")).endpoint;

/** A host action, as another host window or the host's own screen sends it. */
const hostAction = <T>(baseUrl: string | undefined, path: string) =>
  hostCall<T>(baseUrl, path, { method: "POST", headers: { "X-Factory-Request": "1" } });

const failedReopen = /Factory could not open the backend-host browser\. The pending approval/;
const approvalPageOpen = /T3 Code’s approval page is open in the browser on this computer/;
const continueWithoutReporting =
  /Open AgentEasel to continue without reporting\. Once this is fixed, install it from Settings → Agent reporting, or set it up by hand\./;
const cannotInstallHere =
  "AgentEasel can’t install here; waiting for the AgentEasel host to open AgentEasel";

/** An approved remote browser on a fresh host that has not finished setup. */
async function openApprovedClient(
  context: { fixture: Fixture; app: App; browser: Browser },
  options?: FreshOptions,
) {
  await freshHost(context, options);
  await openRemoteBrowser(context.app);
  await openApproved(context.app, "/runs/new");
}

/** Discovery refuses the host's connected T3, and this approved client has read that refusal. */
async function clientReadRefusal(context: {
  fixture: Fixture;
  app: App;
  browser: Browser;
  screen: Screen;
}) {
  await openApprovedClient(context, { sameT3: false });
  await context.fixture.firstRunSetup.hostConnects();
  await expect(context.screen.getByText(cannotInstallHere)).toBeVisible({ timeout: 8_000 });
}

/** Approval waits in the host's browser, which can no longer be opened again. */
async function approvalPendingWithoutHostBrowser(context: {
  fixture: Fixture;
  app: App;
  browser: Browser;
  screen: Screen;
}) {
  await openFreshSetup(context);
  await connectDetected(context.screen);
  await expect(context.screen.getByText(approvalPageOpen)).toBeVisible();
  await context.fixture.firstRunSetup.hostBrowserFails();
}

/** Reopen approval page, in this window, failed to open the host's browser. */
async function failedReopenHere(context: {
  fixture: Fixture;
  app: App;
  browser: Browser;
  screen: Screen;
}) {
  await approvalPendingWithoutHostBrowser(context);
  await context.screen.getByRole("button", "Reopen approval page").tap();
  await expect(context.screen.getByText(failedReopen)).toBeVisible();
}

/** The pending approval explains the failed open instead of saying the page is open. */
async function expectFailedReopenShown(screen: Screen) {
  await expect(screen.getByText(failedReopen)).toBeVisible();
  await expect(screen.getByText(approvalPageOpen)).toHaveCount(0);
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
}

/** Discovery's refusal with its explanation and how to continue without installing. */
async function expectRefusalExplained(screen: Screen, explanation: RegExp) {
  await expect(screen.getByText("Couldn’t check your harnesses")).toBeVisible();
  await expect(screen.getByText(explanation)).toBeVisible();
  await expect(screen.getByText(continueWithoutReporting)).toBeVisible();
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
}

/** Neither an install nor Open Factory is offered on this screen. */
async function expectNoInstallOrOpenFactory(screen: Screen) {
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
}

test("a fresh host connects to the detected T3 Code, installs in its harnesses and opens AgentEasel for good", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser });
  await expect(screen.getByRole("heading", "Set up AgentEasel")).toBeVisible();
  await expect(screen.getByRole("heading", "Connect to T3 Code, current step")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, upcoming step")).toBeVisible();
  await expect(screen.getByText("T3 Code 0.1.11 is running on this computer")).toBeVisible();
  await expect(screen.getByText("http://127.0.0.1:3773/mcp", { exact: true })).toBeVisible();
  await expect(
    screen.getByText(/Connect opens T3 Code’s approval page in your browser/),
  ).toBeVisible();
  // A fresh home has no saved address, and nothing explains a failure no one attempted.
  expect(await savedEndpoint(app.baseUrl)).toBeNull();
  await expect(screen.getByText("AgentEasel can’t reach T3 Code")).toHaveCount(0);
  // The disclosure stays closed while T3 is detected, and no product route mounts behind it.
  await expectNoAddressFormOrApplication(screen);
  await expect(screen.getByRole("button", "Connect")).toBeEnabled();
  await expectActionShown(browser, "Connect");
  await app.screenshot("first-run-setup-t3-detected");

  // Act
  await screen.getByRole("button", "Connect").tap();

  // Assert: Connect saved the detected address and started approval in the host's browser.
  await expect(screen.getByText("Approve AgentEasel in your browser")).toBeVisible();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await expect(
    screen.getByText(/T3 Code’s approval page is open in the browser on this computer/),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Reopen approval page")).toBeVisible();
  expect(await savedEndpoint(app.baseUrl)).toBe("http://127.0.0.1:3773/mcp");
  expect(await fixture.firstRunSetup.authorizationStarts()).toBe(1);
  await app.screenshot("first-run-setup-waiting");

  // The owner approves in T3; nobody touches this screen.
  await fixture.firstRunSetup.t3Approve();
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Approve AgentEasel in your browser")).toHaveCount(0);

  // Step 2 lists the installable harnesses T3 has on with their messages, and names the ones it
  // keeps off.
  const claude = screen.getByRole("group", "Claude", { exact: true });
  const codex = screen.getByRole("group", "Codex", { exact: true });
  await expect(claude.getByRole("status")).toHaveText("Not installed");
  await expect(claude).toContainText(".claude.json · ");
  await expect(claude).toContainText("reporting-claude/skills");
  await expect(claude).toContainText("Install once for all projects and Agents using this home.");
  await expect(codex.getByRole("status")).toHaveText("Not installed");
  await expect(codex).toContainText("reporting-codex/config.toml · ");
  await expect(codex).toContainText("reporting-codex/skills");
  await expect(
    screen.getByText("Cursor and Grok are off in T3 Code. Turn them on there to include them."),
  ).toBeVisible();
  await expect(screen.getByRole("group", "Cursor", { exact: true })).toHaveCount(0);
  await app.screenshot("first-run-setup-install");
  await screen.getByRole("button", "What gets installed").tap();
  await expect(screen.getByText(/Factory MCP/)).toBeVisible();
  await expect(screen.getByText(/factory-start-run/)).toBeVisible();
  await screen.getByRole("button", "What gets installed").tap();

  await screen.getByRole("button", "Install in 2 harnesses").tap();

  // Ready: both steps done, and a reminder that open sessions keep the tools they loaded.
  await expect(screen.getByRole("heading", "AgentEasel is ready")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Installed in Claude and Codex, done")).toBeVisible();
  await expect(
    screen.getByText(
      "factory-runtime MCP · $factory-block · factory-start-run · setup-factory · factory-configure",
    ),
  ).toBeVisible();
  await expect(screen.getByText("Open a new agent session")).toBeVisible();
  expect(await setupCompleted(app.baseUrl)).toBe(false);
  await app.screenshot("first-run-setup-ready");

  await screen.getByRole("button", "Open AgentEasel").tap();

  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "AgentEasel is ready")).toHaveCount(0);
  expect(await setupCompleted(app.baseUrl)).toBe(true);
  // Completion is durable: a reload, even with T3 gone, opens the application.
  await fixture.firstRunSetup.t3Unavailable();
  await browser.reload();
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "Set up AgentEasel")).toHaveCount(0);
});

test("with no running T3 Code the step offers an address, and proposes T3 Code with the disclosure closed once it starts", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { t3Running: false });
  await expect(screen.getByText("No running T3 Code found on this computer")).toBeVisible();
  // Save and connect waits for an address; the input shows the default one as its placeholder.
  await expect(screen.getByRole("button", "Save and connect")).toBeDisabled();
  await app.screenshot("first-run-setup-t3-not-found");

  // Act
  await fixture.firstRunSetup.t3Starts();

  // Assert
  await expect(screen.getByText("T3 Code 0.1.11 is running on this computer")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByText("No running T3 Code found on this computer")).toHaveCount(0);
  await expect(screen.getByRole("button", "Save and connect")).toHaveCount(0);
  await expect(screen.getByRole("button", "Use another address · how to find it")).toBeVisible();
});

test("a failed reopen of the approval page shows the host's explanation", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await approvalPendingWithoutHostBrowser({ fixture, app, browser, screen });

  // Act
  await screen.getByRole("button", "Reopen approval page").tap();

  // Assert
  await expectFailedReopenShown(screen);
});

test("after a failed reopen, a reload still shows the host's explanation", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await failedReopenHere({ fixture, app, browser, screen });

  // Act
  await browser.reload();

  // Assert
  await expectFailedReopenShown(screen);
  await app.screenshot("first-run-setup-reopen-failed-reload");
});

test("a reopen that failed in another host window shows its explanation here", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await approvalPendingWithoutHostBrowser({ fixture, app, browser, screen });

  // Act
  await hostAction<T3Connection>(app.baseUrl, "/api/connection/authorization/open");

  // Assert
  await expectFailedReopenShown(screen);
});

test("an approval that ended without consent is explained after a reload", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser });
  await connectDetected(screen);
  await fixture.firstRunSetup.approvalAbandoned();

  // Act
  await browser.reload();

  // Assert
  await expect(screen.getByText("Approval didn’t finish")).toBeVisible();
  await expect(
    screen.getByText(/Approve access in T3 Code by opening authorization/),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Connect")).toBeVisible();
});

test("with no installable harness on in T3 Code, the install step asks to turn one on and offers no install", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { harnessesOn: false });
  await connectDetected(screen);

  // Act
  await fixture.firstRunSetup.t3Approve();

  // Assert
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Turn on a harness in T3 Code")).toBeVisible();
  await expect(
    screen.getByText(
      "Claude, Codex, Cursor, and Grok are off in T3 Code. Turn them on there to include them.",
    ),
  ).toBeVisible();
  await expectNoInstallOrOpenFactory(screen);
  await app.screenshot("first-run-setup-no-harness");
});

test("a harness turned on in T3 Code during the install step joins the list and leaves the caption", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openInstallStep({ fixture, app, browser, screen }, { harnessesOn: false });
  await expect(screen.getByText("Turn on a harness in T3 Code")).toBeVisible();

  // Act
  await fixture.firstRunSetup.codexTurnedOn();

  // Assert
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Not installed",
    { timeout: 8_000 },
  );
  await expect(
    screen.getByText(
      "Claude, Cursor, and Grok are off in T3 Code. Turn them on there to include them.",
    ),
  ).toBeVisible();
  await expect(screen.getByText("Turn on a harness in T3 Code")).toHaveCount(0);
});

test("when discovery cannot read the connected T3 Code's harnesses, the install step names the blocker and the host can still open AgentEasel", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openInstallStep({ fixture, app, browser, screen }, { sameT3: false });
  await expectRefusalExplained(
    screen,
    /Connected T3 Code identity does not match local state\. Set FACTORY_T3_STATE/,
  );
  await expect(screen.getByRole("link", "set it up by hand")).toHaveAttribute(
    "href",
    "https://github.com/alimek/t3-factory/blob/main/docs/t3-integration.md#reporting-installation",
  );
  await expect(screen.getByText("Turn on a harness in T3 Code")).toHaveCount(0);
  await expect(screen.getByText(/are off in T3 Code/)).toHaveCount(0);
  // Nothing was installed, so there is no new session to open.
  await expect(screen.getByText("Open a new agent session")).toHaveCount(0);
  await expectActionShown(browser, "Open AgentEasel");
  await app.screenshot("first-run-setup-discovery-refused");

  // Act
  await screen.getByRole("button", "Open AgentEasel").tap();

  // Assert
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  expect(await setupCompleted(app.baseUrl)).toBe(true);
});

test("a listed harness AgentEasel can neither install nor repair waits until the installable ones are installed, then the host may open AgentEasel", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openInstallStep({ fixture, app, browser, screen }, { codexHome: false });
  await expect(screen.getByText("Codex’s configuration folder is missing")).toBeVisible();
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Needs attention",
  );
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);

  // Act
  await screen.getByRole("button", "Install in 1 harness").tap();

  // Assert
  await expect(screen.getByRole("group", "Claude", { exact: true }).getByRole("status")).toHaveText(
    "Installed",
    { timeout: 8_000 },
  );
  await expect(screen.getByText("Codex’s configuration folder is missing")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible();
  await expect(screen.getByText("Open a new agent session")).toBeVisible();
  await expectActionShown(browser, "Open AgentEasel");
  await app.screenshot("first-run-setup-manual-harness");
});

test("when T3 Code's settings file cannot be read, the install step says where AgentEasel reads T3 Code's state and how to continue", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { t3Settings: false });
  await connectDetected(screen);

  // Act
  await fixture.firstRunSetup.t3Approve();

  // Assert
  await expectInstallStepOpen(screen);
  await expectRefusalExplained(
    screen,
    /Cannot discover local T3 Code configuration: .+\. Check that T3 Code has run on this computer as this user, or set FACTORY_T3_STATE_DIRECTORY to the owning local T3 Code state directory\./,
  );
  await expectActionShown(browser, "Open AgentEasel");
  await app.screenshot("first-run-setup-settings-unreadable");
});

test("a harness turned on in T3 Code beside one needing manual setup withholds Open AgentEasel until the list read again offers its install", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: Claude installed and Codex needing manual setup, so Open Factory is offered.
  await openInstallStep({ fixture, app, browser, screen }, { codexHome: false });
  await screen.getByRole("button", "Install in 1 harness").tap();
  await expectActionShown(browser, "Open AgentEasel");
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.grokTurnedOn();

  // Assert: once setup sees the change, the list is read again and Open Factory waits for it.
  await expect(
    screen.getByText("Cursor is off in T3 Code. Turn it on there to include it."),
  ).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
  await expect(screen.getByText("Checking harnesses…")).toBeVisible();
  await app.screenshot("first-run-setup-list-refreshing");
  // The read answers: Grok is installable, so Install comes back and Open Factory stays away.
  await fixture.firstRunSetup.releaseReportingReads();
  await expect(screen.getByRole("group", "Grok", { exact: true }).getByRole("status")).toHaveText(
    "Not installed",
  );
  await expect(screen.getByRole("button", "Install in 1 harness")).toBeVisible();
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
});

test("after T3 Code grants a new authorization with the same harnesses off, Open AgentEasel waits for a list read for it", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await readyHost({ fixture, app, browser, screen });
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.t3NewAuthorization();

  // Assert: the caption is unchanged, yet the list read for the earlier authorization no longer counts.
  await expectListBeingRead(screen);
  await expect(
    screen.getByText("Cursor and Grok are off in T3 Code. Turn them on there to include them."),
  ).toBeVisible();
});

test("after T3 Code disconnects and reconnects, Open AgentEasel waits for a list read since reconnecting", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await readyHost({ fixture, app, browser, screen });
  await fixture.firstRunSetup.t3Unavailable();
  await expect(screen.getByRole("heading", "Connect to T3 Code, current step")).toBeVisible({
    timeout: 8_000,
  });
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.t3Available();

  // Assert
  await expectInstallStepOpen(screen);
  await expectListBeingRead(screen);
});

test("an approved client waits read-only while the host sets up, then opens AgentEasel by itself", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: the host is in First-run setup; this browser is an approved remote device.
  await openApprovedClient({ fixture, app, browser });

  // Assert: the host's progress, read-only, with Check again as the only action.
  await expect(screen.getByRole("heading", "Finish setup on the AgentEasel host")).toBeVisible();
  await expect(
    screen.getByText(/happen on the computer where AgentEasel runs\. Open AgentEasel there/),
  ).toBeVisible();
  await expect(screen.getByRole("heading", "Connect to T3 Code, current step")).toBeVisible();
  await expect(screen.getByText("Not connected yet")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, upcoming step")).toBeVisible();
  await expect(screen.getByText("Waiting for step 1")).toBeVisible();
  await expect(screen.getByRole("button", "Connect")).toHaveCount(0);
  await expect(screen.getByRole("button", /another address/)).toHaveCount(0);
  await expectNoAddressFormOrApplication(screen);
  await screen.getByRole("button", "Check again").tap();
  await expect(screen.getByRole("heading", "Finish setup on the AgentEasel host")).toBeVisible();
  await app.screenshot("first-run-setup-approved-client");

  // Act: the owner connects the detected T3 on the host and approves it.
  await fixture.firstRunSetup.hostConnects();

  // Assert: step 1 is done and step 2 shows the host's harnesses, with nothing to install here.
  await expectInstallStepOpen(screen);
  await expect(screen.getByRole("group", "Claude", { exact: true }).getByRole("status")).toHaveText(
    "Not installed",
  );
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
  await app.screenshot("first-run-setup-approved-client-connected");

  // Act: the owner finishes setup on the host.
  await hostAction<FirstRunSetup>(app.baseUrl, "/api/setup/complete");

  // Assert: the client leaves the setup screen without a reload.
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("heading", "Finish setup on the AgentEasel host")).toHaveCount(0);
});

test("an approved client is not told installation is impossible from a read made before the host connected", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: this client read the host's reporting list while T3 was not connected yet.
  await openApprovedClient({ fixture, app, browser });
  await expect(screen.getByText("Not connected yet")).toBeVisible();
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.hostConnects();

  // Assert: until a list read since connecting answers, the client only waits for the install.
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Waiting for the install on the AgentEasel host")).toBeVisible();
  await expect(screen.getByText(cannotInstallHere)).toHaveCount(0);
  await app.screenshot("first-run-setup-approved-client-list-pending");
});

test("an approved client on a host where installation is impossible waits for the host to open AgentEasel", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: discovery refuses the host's T3, whose state belongs to another T3.
  await openApprovedClient({ fixture, app, browser }, { sameT3: false });

  // Act
  await fixture.firstRunSetup.hostConnects();

  // Assert: read-only, with no install and no Open Factory here.
  await expectInstallStepOpen(screen);
  await expect(screen.getByText(cannotInstallHere)).toBeVisible();
  await expectNoInstallOrOpenFactory(screen);
  await expect(screen.getByRole("button", "Check again")).toBeVisible();
  await app.screenshot("first-run-setup-approved-client-blocked");
});

test("an approved client is not told installation is impossible from a list read for an earlier T3 Code authorization", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await clientReadRefusal({ fixture, app, browser, screen });
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.t3NewAuthorization();

  // Assert
  await expect(screen.getByText("Waiting for the install on the AgentEasel host")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByText(cannotInstallHere)).toHaveCount(0);
});

test("an approved client shows no harnesses read before T3 Code disconnected until a list read since reconnecting answers", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: this client listed the host's harnesses, then T3 went away.
  await openApprovedClient({ fixture, app, browser });
  await fixture.firstRunSetup.hostConnects();
  await expect(screen.getByRole("group", "Claude", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await fixture.firstRunSetup.t3Unavailable();
  await expect(screen.getByText("Not connected yet")).toBeVisible({ timeout: 8_000 });
  await fixture.firstRunSetup.holdReportingReads();

  // Act
  await fixture.firstRunSetup.t3Available();

  // Assert
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Waiting for the install on the AgentEasel host")).toBeVisible();
  await expect(screen.getByRole("group", "Claude", { exact: true })).toHaveCount(0);
});
