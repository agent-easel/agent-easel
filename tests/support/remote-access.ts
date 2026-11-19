import { expect, type Screen } from "e2e";
import { fixtureHandles } from "./fixture/handle.ts";
import { approvedBrowserPath, remoteBrowserPath } from "./fixture/seam.ts";

type FixtureApp = { baseUrl: string | undefined; open(path: string): Promise<unknown> };

/** Owner actions on the host panel, the host's T3 connection and the remote browsers' network. */
const remoteAccess = (app: FixtureApp) => fixtureHandles(app).remoteAccess;

/** Marks this browser profile as remote, so it reaches the fixture's target server. */
export const openRemoteBrowser = (app: FixtureApp) => app.open(remoteBrowserPath);

/** A fresh browser profile requests access and the owner approves it on the host. */
export async function approvedBrowser(app: FixtureApp, screen: Screen, path = "/runs/new") {
  await app.open(path);
  await screen.getByRole("button", "Request access").tap();
  await expect(screen.getByLabel("Verification code")).toBeVisible();
  await remoteAccess(app).approve();
}

/** What the host's controlled T3 observed, and remote connection status GETs since a reset. */
export const hostT3Observations = (app: FixtureApp) => remoteAccess(app).t3Observations();

/** Updater actions approved clients requested from the fixture's desktop server. */
export const serverUpdateActions = (app: FixtureApp) => remoteAccess(app).serverUpdateActions();

/** An approved profile opens the upgrade review from the footer's downloaded-update control. */
export async function openUpgradeReview(app: FixtureApp, screen: Screen, scope: string) {
  await openApproved(app, "/runs/new");
  await screen.getByRole("button", `Update downloaded · Click to upgrade ${scope}`).tap();
  await expect(
    screen.getByRole(
      "heading",
      scope === "server" ? "Upgrade to 0.1.1-beta.3?" : "Upgrade client + server?",
    ),
  ).toBeVisible();
}

/** The review's confirmation started the upgrade and the fixture server received one install. */
export async function expectServerInstallRequested(
  app: FixtureApp,
  screen: Screen,
  installsBefore: number,
) {
  await expect(screen.getByRole("button", "Upgrading…")).toBeVisible();
  await expect
    .poll(async () => (await serverUpdateActions(app)).slice(installsBefore).join(","))
    .toBe("install");
}

/** Lets wall-clock time pass in the browser session, for interval-driven behavior. */
export const elapse = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The remote connection screen after it opened authorization: the owner saved a T3 endpoint on
 * the host, and approval waits in the host's browser.
 */
export async function openWaitingConnection(app: FixtureApp, screen: Screen) {
  await remoteAccess(app).t3Endpoint();
  await openApproved(app, "/settings/connection");
  await expect(screen.getByText("Managed on the Factory host")).toBeVisible();
  await screen.getByRole("button", "Authorize").tap();
  await expect(
    screen.getByText("Approve in the browser on the Factory host").first(),
  ).toBeVisible();
}

/** The incompatible-server gate with its local Application settings dialog open. */
export async function openIncompatibleApplicationSettings(app: FixtureApp, screen: Screen) {
  await remoteAccess(app).incompatible();
  await app.open("/");
  await expect(
    screen.getByRole("heading", "This client and server can’t work together"),
  ).toBeVisible();
  await screen.getByRole("button", "Application settings").tap();
}

/**
 * The host's own Devices & access page with one approved device and, requested after it, the
 * pending device `label`. Leaves the remote browser profile the file's journeys start from.
 */
export async function openHostDevices(
  app: FixtureApp,
  browser: { clearCookies(filter: { name: string }): Promise<unknown> },
  label: string,
) {
  await remoteAccess(app).requestAccess({ label: `Approved · ${label}` });
  await remoteAccess(app).approve();
  await remoteAccess(app).requestAccess({ label });
  await browser.clearCookies({ name: "fixture_remote" });
  await app.open("/settings/devices");
}

/** Opens `path` as a browser profile the host already approved, without an access request. */
export const openApproved = (app: FixtureApp, path: string) => app.open(approvedBrowserPath(path));
