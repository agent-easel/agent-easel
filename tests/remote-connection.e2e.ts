import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import {
  elapse,
  hostT3Observations,
  openApproved,
  openRemoteBrowser,
  openWaitingConnection,
} from "./support/remote-access.ts";

beforeEach(async ({ app }) => {
  await openRemoteBrowser(app);
});

test("opening authorization from a remote browser starts approval in the host's browser", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.remoteAccess.t3Endpoint();
  await openApproved(app, "/settings/connection");
  await expect(screen.getByText("Managed on the AgentEasel host")).toBeVisible();
  await expect(screen.getByRole("link", "Devices & access")).toHaveCount(0);
  await expect(screen.getByText("Authorize AgentEasel in T3 Code").first()).toBeVisible();
  await expect(screen.getByRole("button", "Authorize")).toBeVisible();
  await expect(screen.getByRole("button", "Edit address")).toHaveCount(0);
  await expect(screen.getByLabel("Address", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Reauthorize")).toHaveCount(0);
  await app.screenshot("remote-connection-needs-authorization");

  // Act
  await screen.getByRole("button", "Authorize").tap();

  // Assert
  await expect(
    screen.getByText("Approve in the browser on the AgentEasel host").first(),
  ).toBeVisible();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
  expect((await hostT3Observations(app)).authorizationStarts).toBe(1);
  await app.screenshot("remote-connection-waiting");
});

test("the waiting connection screen turns Connected from the live connection, without status reads", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange: longer than two former 2.5 s polling periods passes without any status read.
  await openWaitingConnection(app, screen);
  await fixture.remoteAccess.resetConnectionReads();
  await elapse(6_000);

  // Act: the owner approves in T3 on the host; nobody touches this screen.
  await fixture.remoteAccess.t3Approve();

  // Assert
  await expect(screen.getByText("Connected", { exact: true }).first()).toBeVisible({
    timeout: 8_000,
  });
  await expect(
    screen.getByText("Approve in the browser on the AgentEasel host").first(),
  ).toHaveCount(0);
  await expect(screen.getByRole("button", "Authorize")).toHaveCount(0);
  await expect(screen.getByRole("button", /Reauthorize/)).toHaveCount(0);
  expect((await hostT3Observations(app)).connectionReads).toBe(0);
  await app.screenshot("remote-connection-connected");
});
