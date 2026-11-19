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

const checkedRadios = `document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]').length`;

/** The open animation slides the menu in from above, so geometry is read only once it has settled. */
const menuSettled = `(() => {
  const trigger = document.getElementById("launch-flow")?.getBoundingClientRect();
  const menu = document.querySelector('[role="menu"]')?.getBoundingClientRect();
  if (!trigger || !menu) return false;
  return menu.top >= trigger.bottom - 1 && menu.bottom <= window.innerHeight - 11;
})()`;

const menuPresented = `(() => {
  const label = [...document.querySelectorAll("[data-slot=dropdown-menu-label]")].find(
    (node) => node.textContent === "Global",
  );
  const list = document.querySelector('[aria-label="Flows"]');
  const trigger = document.getElementById("launch-flow");
  const menu = document.querySelector('[role="menu"]');
  return JSON.stringify({
    transform: label ? getComputedStyle(label).textTransform : "missing",
    shadow: trigger ? getComputedStyle(trigger).boxShadow : "missing",
    side: menu?.getAttribute("data-side") ?? "",
    scroll: !!list && list.scrollHeight > list.clientHeight + 1,
    fade: !!document.querySelector('[data-slot="picker-menu-fade"]'),
  });
})()`;

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
  await expect(
    screen.getByRole("menuitemradio", "Northwind release", { exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByRole("menuitemradio", "Choose a Flow", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByText("Only ready Flows are listed. Flows of other Projects run only there."),
  ).toHaveCount(0);
  await expect(screen.getByText("Selected Flow unavailable", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("Global", { exact: true })).toBeVisible();
  await expect(screen.getByText("Northwind", { exact: true }).last()).toBeVisible();
  await expect.poll(() => browser.evaluate(menuSettled)).toBe(true);
  const presented = JSON.parse(pageString(await browser.evaluate(menuPresented))) as {
    transform: string;
    shadow: string;
    side: string;
    scroll: boolean;
    fade: boolean;
  };
  expect(presented.transform).toBe("none");
  expect(presented.shadow).not.toBe("none");
  expect(presented.side).toBe("bottom");
  expect(presented.scroll).toBe(true);
  expect(presented.fade).toBe(true);
  await app.screenshot("after-flow-checked");
});

test("an empty Flow field checks nothing in the menu", async ({ app, screen, browser }) => {
  // Arrange
  await selectComposerProject(screen, "Northwind");
  await expect(
    screen.getByRole("button", "Select Flow: Choose a Flow", { exact: true }),
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
  expect(Number(await browser.evaluate(checkedRadios))).toBe(0);
  await expect(screen.getByRole("menuitemradio", "Choose a Flow", { exact: true })).toHaveCount(0);
  await app.screenshot("after-flow-empty");
});

test("a not-ready Flow is a disabled row, and a chosen one stays in the field", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await blockOnModelLessLaterReview(app, screen);
  const flowPicker = screen.getByRole("button", /^Select Flow: /);
  await expect(flowPicker).toContainText("Model-less later review");
  await expect(flowPicker).toContainText("Not ready");
  await expect(flowPicker).toHaveAttribute("aria-invalid", "true");

  // Act
  await openFlowMenu(screen);

  // Assert
  const row = screen.getByRole("menuitem", "Model-less later review · Not ready", { exact: true });
  await expect(row).toBeDisabled();
  await expect(
    screen.getByRole("menuitemradio", "Model-less later review", { exact: true }),
  ).toHaveCount(0);
  expect(Number(await browser.evaluate(checkedRadios))).toBe(0);
  const rowOpacity = pageString(
    await browser.evaluate(
      `getComputedStyle(document.querySelector('[aria-label="Model-less later review · Not ready"]')).opacity`,
    ),
  );
  expect(rowOpacity).toBe("1");
  await browser.keyboard.press("ArrowDown");
  const landed = pageString(
    await browser.evaluate(
      `JSON.stringify({ role: document.activeElement?.getAttribute("role"), disabled: document.activeElement?.getAttribute("aria-disabled") })`,
    ),
  );
  expect(JSON.parse(landed)).toEqual({ role: "menuitemradio", disabled: null });
  await browser.evaluate(
    `document.querySelector('[aria-label="Model-less later review · Not ready"]').scrollIntoView({ block: "center" })`,
  );
  await app.screenshot("after-flow-not-ready");
});

test("Flow search is pinned once more than seven Flows are listed, and Enter in the search does not choose", async ({
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
  await browser.keyboard.press("Enter");
  await expect(screen.getByRole("menu")).toBeVisible();
  expect(
    pageString(
      await browser.evaluate(
        `document.getElementById("launch-flow")?.getAttribute("data-state") ?? ""`,
      ),
    ),
  ).toBe("open");
  await search.fill("zzzz-no-such-flow");
  await expect(screen.getByText("No matching Flows", { exact: true })).toBeVisible();
  await app.screenshot("after-flow-no-match");
  await search.fill("");
  await browser.keyboard.press("ArrowDown");
  const chosen = pageString(
    await browser.evaluate(`document.activeElement?.getAttribute("aria-label") ?? ""`),
  );
  assert(chosen !== "" && !chosen.endsWith("Not ready"));
  await browser.keyboard.press("Enter");
  await expect(screen.getByRole("menu")).toBeHidden();
  await expect(screen.getByRole("button", `Select Flow: ${chosen}`, { exact: true })).toBeVisible();
});

test("Flow names that would truncate to the same text keep the ending that tells them apart", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const stem = `ZZ Truncation ${"x".repeat(90)}`;
  const one = `${stem} ONE`;
  const two = `${stem} TWO`;
  await saveFlowCopy(app.baseUrl, "Demo · Focused change", one, { mode: "checkout" });
  await saveFlowCopy(app.baseUrl, "Demo · Focused change", two, { mode: "checkout" });
  await selectComposerProject(screen, "Northwind");
  await openFlowMenu(screen);

  // Act
  await screen.getByRole("searchbox", "Search Flows", { exact: true }).fill("ZZ Truncation");

  // Assert
  await expect(screen.getByRole("menuitemradio", one, { exact: true })).toBeVisible();
  await expect(screen.getByRole("menuitemradio", two, { exact: true })).toBeVisible();
  const shown = JSON.parse(
    pageString(
      await browser.evaluate(`(() => JSON.stringify([...document.querySelectorAll('[role="menuitemradio"]')].map((item) => ({
        label: item.getAttribute("aria-label"),
        title: item.querySelector("span[title]")?.getAttribute("title"),
        text: item.querySelector("span[title]")?.textContent,
      }))))()`),
    ),
  ) as { label: string; title: string; text: string }[];
  const first = shown.find((item) => item.label === one);
  const second = shown.find((item) => item.label === two);
  assert(first && second);
  expect(first.title).toBe(one);
  expect(second.title).toBe(two);
  expect(first.text).toContain("…");
  expect(second.text).toContain("…");
  expect(first.text.endsWith("E")).toBe(true);
  expect(second.text.endsWith("O")).toBe(true);
  expect(first.text).not.toBe(second.text);
  await app.screenshot("after-flow-truncated");
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
