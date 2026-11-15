import { expect, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { fixtureHandles } from "./fixture/handle.ts";
import { approvedBrowserPath, remoteBrowserPath } from "./fixture/seam.ts";

type FixtureApp = { baseUrl: string | undefined; open(path: string): Promise<unknown> };

export const canvasColor = `getComputedStyle(document.body).backgroundColor`;
/** T3's built-in Ocean theme as Factory maps its Dark canvas. */
export const oceanDark = "rgb(23, 33, 43)";
/** The theme-color snapshot this browser profile keeps for its Factory address. */
export const cachedSnapshot = `window.localStorage.getItem("factory.inherited-colors")`;

/** Theme-color state of the fixture host's controlled T3, and a second browser address. */
export function themeColors(app: FixtureApp) {
  const appearance = fixtureHandles(app).appearance;
  const otherAddress = (path: string) => {
    const url = new URL(path, app.baseUrl);
    url.hostname = "localhost";
    return url.href;
  };
  return {
    unsupported: () => appearance.unsupported(),
    /** `t3 theme set ocean`: the host follows T3's built-in Ocean theme. */
    followOcean: () => appearance.setDefaultTheme({ theme: "ocean" }),
    /**
     * A host following Ocean whose T3 owner published "Nightfall" (dark seeds, no Light
     * variant), "Dusk" (dark seeds with a Light variant) and "Future" (a newer theme file
     * version).
     */
    async withPublishedThemes() {
      await appearance.publish();
      await appearance.setDefaultTheme({ theme: "ocean" });
    },
    /** `t3 theme set <id>` on the controlled T3 environment. */
    setDefaultTheme: (theme: string) => appearance.setDefaultTheme({ theme }),
    /**
     * The same fixture under `localhost` instead of `127.0.0.1`: another origin, so another
     * browser profile's storage, mode and client access.
     */
    otherAddress,
    /** Appearance settings of an approved browser profile at the other address, following Ocean. */
    async openApprovedClient(screen: Screen) {
      await app.open(otherAddress(remoteBrowserPath));
      await app.open(otherAddress(approvedBrowserPath("/settings/appearance")));
      await expect(screen.getByText("Colors follow T3’s default theme “Ocean”.")).toBeVisible();
    },
    /**
     * The host follows the published "Nightfall", and an approved browser profile at the other
     * address shows its Appearance settings, so the host panel keeps its own mode.
     */
    async followNightfallInApprovedBrowser() {
      await appearance.publish();
      await appearance.setDefaultTheme({ theme: "nightfall" });
      await app.open(otherAddress(remoteBrowserPath));
      await app.open(otherAddress(approvedBrowserPath("/settings/appearance")));
    },
  };
}

/** The host panel's Appearance settings, following T3's Ocean theme in Dark. */
export async function hostFollowingOcean({ app, browser }: { app: FixtureApp; browser: Browser }) {
  const colors = themeColors(app);
  await colors.followOcean();
  await app.open("/settings/appearance");
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
  return colors;
}

/**
 * An approved browser profile at another address that showed T3's Ocean theme in Dark, so
 * its storage holds the snapshot the server published.
 */
export async function clientWithCachedOcean({
  app,
  screen,
  browser,
}: {
  app: FixtureApp;
  screen: Screen;
  browser: Browser;
}) {
  const colors = themeColors(app);
  await colors.followOcean();
  await colors.openApprovedClient(screen);
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
  await expect.poll(() => browser.evaluate(cachedSnapshot)).not.toBe(null);
  return { colors, appearance: colors.otherAddress("/settings/appearance") };
}
