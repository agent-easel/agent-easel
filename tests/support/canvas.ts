import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { saveLargeFlow } from "./large-flow.ts";
import { liveRun } from "./live.ts";

export const PAN_INTO_FILLERS = 2300;

export async function openLargeFlow({
  app,
  screen,
  browser,
}: {
  app: App;
  screen: Screen;
  browser: Browser;
}) {
  await browser.setViewport({ width: 1600, height: 900 });
  const name = `Canvas culling · Large Flow ${Date.now()}`;
  await saveLargeFlow(app.baseUrl, name, { fillers: 150, wires: 1200, columns: 8 });
  await app.open("/studio/flows");
  await screen.getByRole("link", name, { exact: false }).tap();
  await expect(screen.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(1);
}

export async function panFlowCanvas(browser: Browser, dy: number) {
  await browser.mouse.move(800, 450);
  await browser.mouse.wheel(0, dy);
}

export async function openLargeFlowPannedToFillers(args: {
  app: App;
  screen: Screen;
  browser: Browser;
}) {
  await openLargeFlow(args);
  await panFlowCanvas(args.browser, PAN_INTO_FILLERS);
  await expect(args.screen.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(0);
}

export async function openLargeFlowWithReturnedFiller(args: {
  app: App;
  screen: Screen;
  browser: Browser;
}) {
  await openLargeFlowPannedToFillers(args);
  await panFlowCanvas(args.browser, -PAN_INTO_FILLERS);
  await expect(args.screen.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(1);
}

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

async function openFollowedRun(app: App, screen: Screen, browser: Browser, run: string) {
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open(`/runs/${run}`);
  const canvas = screen.getByRole("region", "Execution canvas");
  await expect(
    canvas.getByRole("button", "Agent Implement change, Working", { exact: true }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute("data-following", "true");
  return canvas;
}

/** Opens a live build-and-review Run with the implementing Block active and following on. */
export async function openFollowedReviewRun(
  app: App,
  screen: Screen,
  browser: Browser,
  key: string,
) {
  const run = await liveRun(app, key, "review");
  return openFollowedRun(app, screen, browser, run);
}

export async function openFollowedLargeRun(
  app: App,
  screen: Screen,
  browser: Browser,
  key: string,
) {
  const flow = await saveLargeFlow(app.baseUrl, `Canvas culling · Large Run ${key} ${Date.now()}`, {
    fillers: 150,
    wires: 1200,
    columns: 8,
  });
  const run = await liveRun(app, key, { id: flow });
  return openFollowedRun(app, screen, browser, run);
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
  await screen.getByRole("link", flow, { exact: false }).tap();
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
      await expect(
        screen.getByRole("complementary", "Block settings").getByLabel("Name", { exact: true }),
      ).toHaveValue(name);
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

export async function wireEnds(browser: Browser, wire: string, source: string, target: string) {
  return await browser.evaluate<{ d: string; start: number | null; end: number | null } | null>(
    `(() => {
      const canvas = document.querySelector('[aria-label="Flow canvas"]');
      const wire = [...canvas.querySelectorAll('g[role="button"]')].find(
        (g) => g.getAttribute("aria-label") === ${JSON.stringify(wire)},
      );
      if (!wire) return null;
      const path = wire.querySelectorAll("path")[1];
      const at = (length) => path.getPointAtLength(length).matrixTransform(path.getScreenCTM());
      const ports = (block, incoming) => {
        const element = canvas.querySelector('[aria-label=' + JSON.stringify(block) + ']');
        if (!element) return null;
        return [...element.querySelectorAll("span.rounded-full")]
          .filter((el) => el.hasAttribute("data-incoming-port") === incoming)
          .map((el) => {
            const box = el.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          });
      };
      const nearest = (point, centres) =>
        centres && Math.min(...centres.map((c) => Math.hypot(c.x - point.x, c.y - point.y)));
      return {
        d: path.getAttribute("d"),
        start: nearest(at(0), ports(${JSON.stringify(`Block ${source}`)}, false)),
        end: nearest(at(path.getTotalLength()), ports(${JSON.stringify(`Block ${target}`)}, true)),
      };
    })()`,
  );
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
