import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { liveRun } from "./live.ts";

/** Zooms and pans the Run canvas by hand; the returned check proves that view is unchanged. */
export async function manualRunView(screen: Screen, browser: Browser) {
  const canvas = screen.getByRole("region", "Execution canvas");
  await screen.getByRole("button", "Zoom in", { exact: true }).tap();
  await canvas.press("ArrowRight");
  const zoom = await canvas.getAttribute("data-zoom");
  const layer = browser.locator('[aria-label="Execution canvas"] > div[style]');
  const transform = await layer.getAttribute("style");
  return async function expectKept() {
    await expect(canvas).toHaveAttribute("data-zoom", zoom!);
    await expect(layer).toHaveAttribute("style", transform!);
  };
}

/** The named Block's center minus the center of the Run canvas area between its top badges and bottom controls. */
export async function runCanvasCenterOffset(screen: Screen, blockName: string) {
  const surface = (await screen.getByRole("region", "Execution canvas").boundingBox())!;
  const box = (await screen
    .getByRole("article", `Block ${blockName}`, { exact: true })
    .boundingBox())!;
  return {
    x: box.x + box.width / 2 - (surface.x + surface.width / 2),
    y: box.y + box.height / 2 - (surface.y + (surface.height + 64 - 80) / 2),
  };
}

/**
 * Horizontal distance of the named Block from the Run canvas center. The build-and-review Blocks
 * share a row, and a status footer can change a Block's height after the view moved there.
 */
export const runCanvasHorizontalOffset = async (screen: Screen, blockName: string) =>
  Math.abs((await runCanvasCenterOffset(screen, blockName)).x);

/** Opens a live build-and-review Run once its entry view has focused the implementing Block. */
export async function openFollowedReviewRun(
  app: App,
  screen: Screen,
  browser: Browser,
  key: string,
) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await liveRun(app, key, "review");
  await app.open(`/runs/${run}`);
  await expect.poll(() => runCanvasHorizontalOffset(screen, "Implement change")).toBeLessThan(2);
  return screen.getByRole("region", "Execution canvas");
}

/** The reviewer is centered, following has resumed, and the unseen-progress marker is cleared. */
export async function expectFollowingReview(screen: Screen) {
  await expect
    .poll(() => runCanvasHorizontalOffset(screen, "Review implementation"))
    .toBeLessThan(2);
  await expect(screen.getByRole("region", "Execution canvas")).toHaveAttribute(
    "data-following",
    "true",
  );
  await expect(screen.getByRole("button", "Follow active", { exact: true })).toBeVisible();
}

/**
 * Opens a seeded Flow fitted in a 1000 px tall viewport with one of its blocks. The worktree
 * Flow's Implement change block has one exit and only the Flow input wired into it; at 2800 px the
 * hold-for-release Flow fits at 100 %, so its Approve release Human step shows real pixels.
 */
export async function openFittedFlowBlock(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  { flow, name, width }: { flow: string; name: string; width: number },
) {
  await browser.setViewport({ width, height: 1000 });
  await app.open("/studio/flows");
  await screen.getByRole("heading", flow, { exact: true }).tap();
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  const label = `Block ${name}`;
  const block = screen.getByRole("article", label, { exact: true });
  const selector = JSON.stringify(`[aria-label="${label}"]`);
  return {
    height: () => drawnHeight(browser, label),
    /** The computed style of the frame's selected edge. */
    outlineStyle: () =>
      browser.evaluate<string>(
        `getComputedStyle(document.querySelector(${selector})).outlineStyle`,
      ),
    /** Selects the block by its name and waits for its inspector. */
    async selectByName() {
      await block.getByText(name, { exact: true }).first().tap();
      await expect(screen.getByLabel("Block name")).toHaveValue(name);
    },
  };
}

export const worktreeImplementBlock = {
  flow: "Demo · Build and review in a worktree",
  name: "Implement change",
  width: 1600,
};

export const releaseApprovalHumanStep = {
  flow: "Demo · Approve, then hold for release",
  name: "Approve release",
  width: 2800,
};

/** The layout height of the canvas node with this accessible name, unaffected by canvas zoom. */
export async function drawnHeight(browser: Browser, label: string) {
  const selector = JSON.stringify(`[aria-label="${label}"]`);
  return Number(await browser.evaluate(`document.querySelector(${selector}).offsetHeight`));
}

/**
 * The largest distance, in viewport px, between an end of a Flow canvas wire and the centre of
 * the port it starts or ends at.
 */
export async function largestWirePortOffset(browser: Browser) {
  return Number(
    await browser.evaluate(`(() => {
      const canvas = document.querySelector('[aria-label="Flow canvas"]');
      const centre = (el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const ports = [...canvas.querySelectorAll("article span.rounded-full")];
      const incoming = ports.filter((el) => el.hasAttribute("data-incoming-port")).map(centre);
      const outgoing = ports.filter((el) => !el.hasAttribute("data-incoming-port")).map(centre);
      const at = (path, length) => {
        const point = path.getPointAtLength(length);
        return point.matrixTransform(path.getScreenCTM());
      };
      const nearest = (point, centres) =>
        Math.min(...centres.map((c) => Math.hypot(c.x - point.x, c.y - point.y)));
      return Math.max(
        ...[...canvas.querySelectorAll('g[role="button"]')].flatMap((wire) => {
          const path = wire.querySelectorAll("path")[1];
          return [
            nearest(at(path, 0), outgoing),
            nearest(at(path, path.getTotalLength()), incoming),
          ];
        }),
      );
    })()`),
  );
}
