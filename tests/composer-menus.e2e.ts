import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FlowDraft, ProjectCatalog, Result } from "../packages/contracts/src/index.ts";
import { expect, type Screen } from "e2e";
import { beforeEach, test } from "./support/test.ts";
import { blockOnModelLessLaterReview, selectComposerProject } from "./support/composer.ts";
import {
  chooseComposerFlow,
  flowList,
  openComposerMenus,
  openFlowMenu,
  pageString,
  readFactoryJson,
} from "./support/composer-menus.ts";
import { saveFlowCopy } from "./support/flows.ts";

/** Composer Flow and Project menus after ticket #508. Dark, 1440×900. */
beforeEach(async ({ app, browser, screen }) => {
  await openComposerMenus(app, browser, screen);
});

async function openProjectMenu(screen: Screen) {
  await screen.getByRole("button", /^Select project: /).tap();
  await expect(screen.getByRole("group", "Projects")).toBeVisible();
}

// A cancelled animation rejects `finished` with AbortError. A shot still waits for the rest.
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null))).then(() => true)";

const checkedChoices = `document.querySelectorAll('[role="option"][data-state="checked"]').length`;

/** The Flow field's open popup, which its trigger controls. */
const flowPopup = `document.getElementById(document.getElementById("launch-flow")?.getAttribute("aria-controls") ?? "")`;

/** The open animation slides the menu in from above, so geometry is read only once it has settled. */
const menuSettled = `(() => {
  const trigger = document.getElementById("launch-flow")?.getBoundingClientRect();
  const menu = ${flowPopup}?.getBoundingClientRect();
  if (!trigger || !menu) return false;
  return menu.top >= trigger.bottom - 1 && menu.bottom <= window.innerHeight - 11;
})()`;

const menuPresented = `(() => {
  const menu = ${flowPopup};
  const label = [...(menu?.querySelectorAll('[role="group"] > *') ?? [])].find(
    (node) => node.textContent === "Global",
  );
  const list = menu?.querySelector("[data-radix-select-viewport]");
  const trigger = document.getElementById("launch-flow");
  return JSON.stringify({
    transform: label ? getComputedStyle(label).textTransform : "missing",
    shadow: trigger ? getComputedStyle(trigger).boxShadow : "missing",
    side: menu?.getAttribute("data-side") ?? "",
    scroll: !!list && list.scrollHeight > list.clientHeight + 1,
    fade: !!menu?.querySelector('[data-slot="choice-menu-fade"]'),
  });
})()`;

/** Where each named option's label ends, against the list's edges. */
function labelEnds(names: readonly string[]) {
  return `(() => {
    const list = ${flowPopup}?.querySelector("[data-radix-select-viewport]")?.getBoundingClientRect();
    return JSON.stringify(${JSON.stringify(names)}.map((name) => {
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent === name,
      );
      const label = document.getElementById(option?.getAttribute("aria-labelledby")?.split(" ")[0] ?? "");
      const text = label?.firstChild;
      const range = document.createRange();
      range.setStart(text, text.length - 3);
      range.setEnd(text, text.length);
      const end = range.getBoundingClientRect();
      return {
        text: label?.textContent,
        lines: label ? label.getClientRects().length : 0,
        endInside: !!list && end.left >= list.left && end.right <= list.right,
      };
    }));
  })()`;
}

function placeholderContrast(placeholder: string) {
  return `(() => {
    const input = document.querySelector('input[placeholder="${placeholder}"]');
    const channel = (value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const parse = (color) => {
      const match = String(color).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const fg = parse(getComputedStyle(input, "::placeholder").color);
    const bg = parse(getComputedStyle(input).backgroundColor);
    if (!fg || !bg) return 0;
    const [lighter, darker] = [lum(fg), lum(bg)].sort((left, right) => right - left);
    return (lighter + 0.05) / (darker + 0.05);
  })()`;
}

test("the Flow menu checks the chosen ready Flow and has no placeholder, footer, or uppercase groups", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await chooseComposerFlow(screen, "Northwind release");

  // Act
  await openFlowMenu(screen);

  // Assert
  await expect(screen.getByRole("option", "Northwind release", { exact: true })).toHaveAttribute(
    "data-state",
    "checked",
  );
  await expect(screen.getByRole("option", "Choose a Flow", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByText("Only ready Flows are listed. Flows of other Projects run only there."),
  ).toHaveCount(0);
  await expect(screen.getByText("Selected Flow unavailable", { exact: true })).toHaveCount(0);
  await expect(flowList(screen).getByText("Global", { exact: true })).toBeVisible();
  await expect(flowList(screen).getByText("Northwind", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(menuSettled)).toBe(true);
  const presented = JSON.parse(pageString(await browser.evaluate(menuPresented))) as {
    transform: string;
    shadow: string;
    side: string;
    scroll: boolean;
  };
  expect(presented.transform).toBe("none");
  expect(presented.shadow).not.toBe("none");
  expect(presented.side).toBe("bottom");
  expect(presented.scroll).toBe(true);
  await app.screenshot("after-flow-checked");
});

test("an empty Flow field checks nothing in the menu", async ({ app, screen, browser }) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await expect(
    screen.getByRole("combobox", "Select Flow: Choose a Flow", { exact: true }),
  ).toBeVisible();

  // Act
  await openFlowMenu(screen);

  // Assert — the open menu is modal, so the trigger is read from the page, not the accessibility tree.
  expect(
    pageString(
      await browser.evaluate(
        `document.getElementById("launch-flow")?.getAttribute("data-state") ?? ""`,
      ),
    ),
  ).toBe("open");
  expect(Number(await browser.evaluate(checkedChoices))).toBe(0);
  await expect(screen.getByRole("option", "Choose a Flow", { exact: true })).toHaveCount(0);
  await expect.poll(() => browser.evaluate(menuSettled)).toBe(true);
  const presented = JSON.parse(pageString(await browser.evaluate(menuPresented))) as {
    fade: boolean;
  };
  expect(presented.fade).toBe(true);
  await app.screenshot("after-flow-empty");
});

test("a not-ready Flow is a disabled row, and a chosen one stays in the field", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await blockOnModelLessLaterReview(app, screen);
  const flowPicker = screen.getByRole("combobox", /^Select Flow: /);
  await expect(flowPicker).toContainText("Model-less later review");
  await expect(flowPicker).toContainText("Not ready");
  await expect(flowPicker).toHaveAttribute("aria-invalid", "true");

  // Act
  await openFlowMenu(screen);

  // Assert
  const row = screen.getByRole("option", "Model-less later review Not ready", { exact: true });
  await expect(row).toBeDisabled();
  await expect(screen.getByRole("option", "Model-less later review", { exact: true })).toHaveCount(
    0,
  );
  expect(Number(await browser.evaluate(checkedChoices))).toBe(0);
  await browser.keyboard.press("ArrowDown");
  const landed = pageString(
    await browser.evaluate(
      `JSON.stringify({ role: document.activeElement?.getAttribute("role"), disabled: document.activeElement?.getAttribute("aria-disabled") })`,
    ),
  );
  expect(JSON.parse(landed)).toEqual({ role: "option", disabled: null });
  await row.scrollIntoView();
  await app.screenshot("after-flow-not-ready");
});

test("with seven or fewer Flows the list has no search and choosing a row sets the Flow", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const flows = await readFactoryJson<FlowDraft[]>(app.baseUrl, "/api/flows");
  const kept = flows.find((flow) => flow.name === "Northwind release");
  assert(kept);
  await fixture.definitions.removeFlows({ keepId: kept.id });
  await browser.reload();
  await selectComposerProject(screen, "Northwind");
  await openFlowMenu(screen);
  await expect(screen.getByRole("searchbox", "Search Flows", { exact: true })).toHaveCount(0);
  await app.screenshot("after-flow-few");

  // Act
  await screen.getByRole("option", "Northwind release", { exact: true }).tap();

  // Assert
  await expect(flowList(screen)).toBeHidden();
  await expect(
    screen.getByRole("combobox", "Select Flow: Northwind release", { exact: true }),
  ).toBeFocused();
});

test("Flow search is pinned and focused once more than seven Flows are listed", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange — the seed lists more than seven relevant Flows. The Project menu covers seven or fewer.
  const catalog = await readFactoryJson<ProjectCatalog>(app.baseUrl, "/api/projects");
  const northwind = catalog.projects.find((project) => project.title === "Northwind");
  assert(northwind);
  const flows = await readFactoryJson<FlowDraft[]>(app.baseUrl, "/api/flows");
  const relevant = flows.filter(
    (flow) => flow.projectId === null || flow.projectId === northwind.id,
  );
  assert(relevant.length > 7);
  await selectComposerProject(screen, "Northwind");

  // Act
  await openFlowMenu(screen);

  // Assert
  const search = screen.getByRole("searchbox", "Search Flows", { exact: true });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  const ratio = Number(await browser.evaluate(placeholderContrast("Search Flows")));
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await app.screenshot("after-flow-search");
});

test("Enter in the Flow search does not choose a Flow", async ({ screen, browser }) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await openFlowMenu(screen);
  await expect(screen.getByRole("searchbox", "Search Flows", { exact: true })).toBeFocused();

  // Act
  await browser.keyboard.press("Enter");

  // Assert
  await expect(flowList(screen)).toBeVisible();
  expect(
    pageString(
      await browser.evaluate(
        `document.getElementById("launch-flow")?.getAttribute("aria-label") ?? ""`,
      ),
    ),
  ).toBe("Select Flow: Choose a Flow");
});

test("a Flow search with no match says so", async ({ app, screen }) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await openFlowMenu(screen);

  // Act
  await screen.getByRole("searchbox", "Search Flows", { exact: true }).fill("zzzz-no-such-flow");

  // Assert
  await expect(flowList(screen).getByText("No matching Flows", { exact: true })).toBeVisible();
  await expect(screen.getByRole("option")).toHaveCount(0);
  await app.screenshot("after-flow-no-match");
});

test("a filtered Flow is chosen from the search by keyboard", async ({ app, screen, browser }) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await openFlowMenu(screen);
  await screen.getByRole("searchbox", "Search Flows", { exact: true }).fill("northwind rel");
  await expect(screen.getByRole("option")).toHaveCount(1);
  await browser.keyboard.press("ArrowDown");
  await expect(screen.getByRole("option", "Northwind release", { exact: true })).toBeFocused();
  await app.screenshot("after-flow-filtered");

  // Act
  await browser.keyboard.press("Enter");

  // Assert
  await expect(flowList(screen)).toBeHidden();
  await expect(
    screen.getByRole("combobox", "Select Flow: Northwind release", { exact: true }),
  ).toBeFocused();
});

test("long unbroken Flow names wrap in the list and keep the ending that tells them apart", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange — 63 characters without a space.
  const stem = `ZZWrap-${"x".repeat(52)}`;
  const one = `${stem}-ONE`;
  const two = `${stem}-TWO`;
  await saveFlowCopy(app.baseUrl, "Demo · Focused change", one, { mode: "checkout" });
  await saveFlowCopy(app.baseUrl, "Demo · Focused change", two, { mode: "checkout" });
  await selectComposerProject(screen, "Northwind");

  // Act
  await openFlowMenu(screen);

  // Assert
  await expect(screen.getByRole("option", one, { exact: true })).toBeAttached();
  await expect(screen.getByRole("option", two, { exact: true })).toBeAttached();
  const ends = JSON.parse(pageString(await browser.evaluate(labelEnds([one, two])))) as {
    text: string;
    lines: number;
    endInside: boolean;
  }[];
  expect(ends[0]).toMatchObject({ text: one, endInside: true });
  expect(ends[1]).toMatchObject({ text: two, endInside: true });
  expect(ends[0]!.lines).toBeGreaterThan(1);
  expect(ends[1]!.lines).toBeGreaterThan(1);
  await screen.getByRole("option", one, { exact: true }).scrollIntoView();
  await app.screenshot("after-flow-long-names");
});

test("the Project menu lists available projects and Refresh projects", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");

  // Act
  await openProjectMenu(screen);

  // Assert
  await expect(screen.getByRole("menuitemradio", /^Northwind · /)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(screen.getByRole("menuitemradio", /Docs site/)).toHaveCount(0);
  await expect(
    screen.getByRole("menuitemradio", "No project selected", { exact: true }),
  ).toHaveCount(0);
  await expect(screen.getByRole("menuitem", "Add repository", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("menuitem", "Recheck projects", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("Projects from T3", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByText("No projects found. Add an existing repository to get started.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(screen.getByRole("menuitem", "Refresh projects", { exact: true })).toBeVisible();
  await expect(screen.getByRole("searchbox", "Search projects", { exact: true })).toHaveCount(0);
  const shadow = pageString(
    await browser.evaluate(
      `getComputedStyle(document.querySelector('[aria-label^="Select project:"]')).boxShadow`,
    ),
  );
  expect(shadow).not.toBe("none");
  await expect(screen.getByRole("menu")).toHaveAttribute("data-side", "bottom");
  await app.screenshot("after-project-menu");
});

test("Project search appears after more than seven projects and keeps the path ending", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const roots: string[] = [];
  try {
    for (let index = 0; index < 8; index += 1) {
      const root = await mkdtemp(join(tmpdir(), "factory-menu-evidence-"));
      roots.push(root);
      await promisify(execFile)("git", ["init", root]);
      const response = await fetch(new URL("/api/projects", app.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "X-Factory-Request": "1" },
        body: JSON.stringify({ path: root }),
      });
      const body = (await response.json()) as Result<unknown>;
      assert(body.ok, JSON.stringify(body));
    }
    await selectComposerProject(screen, "Northwind");

    // Act
    await openProjectMenu(screen);

    // Assert
    const search = screen.getByRole("searchbox", "Search projects", { exact: true });
    await expect(search).toBeVisible();
    const ratio = Number(await browser.evaluate(placeholderContrast("Search projects")));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    const path = JSON.parse(
      pageString(
        await browser.evaluate(`(() => {
          const row = [...document.querySelectorAll("[data-project-id]")].find((item) =>
            (item.getAttribute("aria-label") ?? "").includes("factory-menu-evidence-"),
          );
          const path = row?.querySelector("[dir=rtl]");
          return JSON.stringify({
            dir: path?.getAttribute("dir"),
            title: path?.getAttribute("title") ?? "",
            text: path?.textContent ?? "",
          });
        })()`),
      ),
    ) as { dir: string; title: string; text: string };
    expect(path.dir).toBe("rtl");
    expect(path.title).toContain("factory-menu-evidence-");
    expect(path.text).toBe(path.title);
    await browser.evaluate(settled);
    await app.screenshot("after-project-many");
    await search.fill("zzzz-no-such-project");
    await expect(screen.getByText("No matching projects", { exact: true })).toBeVisible();
    await expect(screen.getByRole("menuitem", "Refresh projects", { exact: true })).toBeVisible();
    await browser.evaluate(settled);
    await app.screenshot("after-project-no-match");
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});
