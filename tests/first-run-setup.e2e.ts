import { test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import type { FirstRunSetup, Result, T3Connection } from "../packages/contracts/src/index.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";

/** A fresh host's setup screen, in the accepted Figma frames' 1440 × 900 dark appearance. */
async function openFreshSetup(
  { fixture, app, browser }: { fixture: Fixture; app: App; browser: Browser },
  options?: Parameters<Fixture["firstRunSetup"]["fresh"]>[0],
) {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
  await fixture.firstRunSetup.fresh(options);
  await app.open("/runs/new");
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
  await expect(screen.getByRole("heading", "Connected to T3 0.1.11, done")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible();
}

/** A fresh host connected to the detected T3, on its install step. */
async function openInstallStep(
  context: { fixture: Fixture; app: App; browser: Browser; screen: Screen },
  options: Parameters<Fixture["firstRunSetup"]["fresh"]>[0],
) {
  await openFreshSetup(context, options);
  await connectDetected(context.screen);
  await context.fixture.firstRunSetup.t3Approve();
  await expectInstallStepOpen(context.screen);
}

async function setupCompleted(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/setup", baseUrl));
  const setup = (await response.json()) as Result<FirstRunSetup>;
  return setup.ok && setup.value.completed;
}

async function savedEndpoint(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/connection", baseUrl));
  const connection = (await response.json()) as Result<T3Connection>;
  return connection.ok ? connection.value.endpoint : null;
}

test("a fresh host connects to the detected T3, installs in its harnesses and opens Factory for good", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser });
  await expect(screen.getByRole("heading", "Set up Factory")).toBeVisible();
  await expect(screen.getByRole("heading", "Connect to T3, current step")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, upcoming step")).toBeVisible();
  await expect(screen.getByText("T3 0.1.11 is running on this computer")).toBeVisible();
  await expect(screen.getByText("http://127.0.0.1:3773/mcp", { exact: true })).toBeVisible();
  await expect(screen.getByText(/Connect opens T3’s approval page in your browser/)).toBeVisible();
  // A fresh home has no saved address, and nothing explains a failure no one attempted.
  expect(await savedEndpoint(app.baseUrl)).toBeNull();
  await expect(screen.getByText("Factory can’t reach T3")).toHaveCount(0);
  // The disclosure stays closed while T3 is detected, and no product route mounts behind it.
  await expectNoAddressFormOrApplication(screen);
  await expect(screen.getByRole("button", "Connect")).toBeEnabled();
  await expectActionShown(browser, "Connect");
  await app.screenshot("first-run-setup-t3-detected");

  // Act
  await screen.getByRole("button", "Connect").tap();

  // Assert: Connect saved the detected address and started approval in the host's browser.
  await expect(screen.getByText("Approve Factory in your browser")).toBeVisible();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await expect(
    screen.getByText(/T3’s approval page is open in the browser on this computer/),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Reopen approval page")).toBeVisible();
  expect(await savedEndpoint(app.baseUrl)).toBe("http://127.0.0.1:3773/mcp");
  expect(await fixture.firstRunSetup.authorizationStarts()).toBe(1);
  await app.screenshot("first-run-setup-waiting");

  // The owner approves in T3; nobody touches this screen.
  await fixture.firstRunSetup.t3Approve();
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Approve Factory in your browser")).toHaveCount(0);

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
    screen.getByText("Cursor and Grok are off in T3. Turn them on there to include them."),
  ).toBeVisible();
  await expect(screen.getByRole("group", "Cursor", { exact: true })).toHaveCount(0);
  await app.screenshot("first-run-setup-install");
  await screen.getByRole("button", "What gets installed").tap();
  await expect(screen.getByText(/Factory MCP/)).toBeVisible();
  await expect(screen.getByText(/factory-start-run/)).toBeVisible();
  await screen.getByRole("button", "What gets installed").tap();

  await screen.getByRole("button", "Install in 2 harnesses").tap();

  // Ready: both steps done, and a reminder that open sessions keep the tools they loaded.
  await expect(screen.getByRole("heading", "Factory is ready")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Installed in Claude and Codex, done")).toBeVisible();
  await expect(
    screen.getByText("factory-runtime MCP · $factory-block · factory-start-run · setup-factory"),
  ).toBeVisible();
  await expect(screen.getByText("Open a new agent session")).toBeVisible();
  expect(await setupCompleted(app.baseUrl)).toBe(false);
  await app.screenshot("first-run-setup-ready");

  await screen.getByRole("button", "Open Factory").tap();

  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "Factory is ready")).toHaveCount(0);
  expect(await setupCompleted(app.baseUrl)).toBe(true);
  // Completion is durable: a reload, even with T3 gone, opens the application.
  await fixture.firstRunSetup.t3Unavailable();
  await browser.reload();
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "Set up Factory")).toHaveCount(0);
});

test("with no running T3 the step offers an address, and proposes T3 with the disclosure closed once it starts", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { t3Running: false });
  await expect(screen.getByText("No running T3 found on this computer")).toBeVisible();
  // Save and connect waits for an address; the input shows the default one as its placeholder.
  await expect(screen.getByRole("button", "Save and connect")).toBeDisabled();
  await app.screenshot("first-run-setup-t3-not-found");

  // Act
  await fixture.firstRunSetup.t3Starts();

  // Assert
  await expect(screen.getByText("T3 0.1.11 is running on this computer")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByText("No running T3 found on this computer")).toHaveCount(0);
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
  await openFreshSetup({ fixture, app, browser });
  await connectDetected(screen);
  await fixture.firstRunSetup.hostBrowserFails();

  // Act
  await screen.getByRole("button", "Reopen approval page").tap();

  // Assert
  await expect(
    screen.getByText(/Factory could not open the backend-host browser\. The pending approval/),
  ).toBeVisible();
  await expect(
    screen.getByText(/T3’s approval page is open in the browser on this computer/),
  ).toHaveCount(0);
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
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
  await expect(screen.getByText(/Approve access in T3 by opening authorization/)).toBeVisible();
  await expect(screen.getByRole("button", "Connect")).toBeVisible();
});

test("with no installable harness on in T3, the install step asks to turn one on and offers no install", async ({
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
  await expect(screen.getByText("Turn on a harness in T3")).toBeVisible();
  await expect(
    screen.getByText(
      "Claude, Codex, Cursor, and Grok are off in T3. Turn them on there to include them.",
    ),
  ).toBeVisible();
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Open Factory")).toHaveCount(0);
  await app.screenshot("first-run-setup-no-harness");
});

test("a harness turned on in T3 during the install step joins the list and leaves the caption", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openInstallStep({ fixture, app, browser, screen }, { harnessesOn: false });
  await expect(screen.getByText("Turn on a harness in T3")).toBeVisible();

  // Act
  await fixture.firstRunSetup.codexTurnedOn();

  // Assert
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Not installed",
    { timeout: 8_000 },
  );
  await expect(
    screen.getByText("Claude, Cursor, and Grok are off in T3. Turn them on there to include them."),
  ).toBeVisible();
  await expect(screen.getByText("Turn on a harness in T3")).toHaveCount(0);
});

test("when discovery cannot read the connected T3's harnesses, the install step names the blocker instead", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { sameT3: false });
  await connectDetected(screen);

  // Act
  await fixture.firstRunSetup.t3Approve();

  // Assert
  await expectInstallStepOpen(screen);
  await expect(screen.getByText("Couldn’t check your harnesses")).toBeVisible();
  await expect(
    screen.getByText(/Connected T3 identity does not match local state\. Set FACTORY_T3_STATE/),
  ).toBeVisible();
  await expect(screen.getByText("Turn on a harness in T3")).toHaveCount(0);
  await expect(screen.getByText(/are off in T3/)).toHaveCount(0);
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await app.screenshot("first-run-setup-discovery-refused");
});

test("an approved client waits read-only while the host sets up, then opens Factory by itself", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange: the host is in First-run setup; this browser is an approved remote device.
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
  await fixture.firstRunSetup.fresh();
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");

  // Assert: the host's progress, read-only, with Check again as the only action.
  await expect(screen.getByRole("heading", "Finish setup on the Factory host")).toBeVisible();
  await expect(
    screen.getByText(/happen on the computer where Factory runs\. Open Factory there/),
  ).toBeVisible();
  await expect(screen.getByRole("heading", "Connect to T3, current step")).toBeVisible();
  await expect(screen.getByText("Not connected yet")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, upcoming step")).toBeVisible();
  await expect(screen.getByText("Waiting for step 1")).toBeVisible();
  await expect(screen.getByRole("button", "Connect")).toHaveCount(0);
  await expect(screen.getByRole("button", /another address/)).toHaveCount(0);
  await expectNoAddressFormOrApplication(screen);
  await screen.getByRole("button", "Check again").tap();
  await expect(screen.getByRole("heading", "Finish setup on the Factory host")).toBeVisible();
  await app.screenshot("first-run-setup-approved-client");

  // Act: the owner connects the detected T3 on the host and approves it.
  await fixture.firstRunSetup.hostConnects();

  // Assert: step 1 is done and step 2 shows the host's harnesses, with nothing to install here.
  await expectInstallStepOpen(screen);
  await expect(screen.getByRole("group", "Claude", { exact: true }).getByRole("status")).toHaveText(
    "Not installed",
  );
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Open Factory")).toHaveCount(0);
  await app.screenshot("first-run-setup-approved-client-connected");

  // Act: the owner finishes setup on the host.
  const completed = await fetch(new URL("/api/setup/complete", app.baseUrl), {
    method: "POST",
    headers: { "X-Factory-Request": "1" },
  });
  expect(completed.ok).toBe(true);

  // Assert: the client leaves the setup screen without a reload.
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("heading", "Finish setup on the Factory host")).toHaveCount(0);
});
