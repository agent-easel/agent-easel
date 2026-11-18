import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import type { ProjectCatalog, Result } from "../../packages/contracts/src/index.ts";
import { expect, type App, type Screen } from "e2e";
import { copyAgentDefinition } from "./agents.ts";
import { placeAgentElsewhere, saveFlowCopy } from "./flows.ts";

async function selectComposerFlow(screen: Screen, flowName: string) {
  const trigger = screen.getByLabel("Flow", { exact: true });
  const selected = await trigger.getAttribute("aria-label");
  if (selected?.endsWith(`: ${flowName}`)) return;

  await trigger.tap();
  await expect(screen.getByRole("menu")).toBeVisible();
  await screen.getByRole("menuitemradio", { name: flowName, exact: true }).tap();
  await expect(screen.getByRole("menu")).toBeHidden();
}

/** Chooses a Project in the composer's picker by its title. */
export async function selectComposerProject(screen: Screen, title: string) {
  await screen.getByRole("button", /^Select project: /).tap();
  await expect(screen.getByRole("group", "Projects")).toBeVisible();
  await screen.getByRole("menuitemradio", new RegExp(`^${title} · `)).tap();
  await expect(screen.getByRole("menu")).toBeHidden();
}

const selectionPath = "/api/projects/selection";

/** Factory's selected Project, which the Project picker changes for every client. */
export async function projectSelection(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/projects", baseUrl));
  const catalog = (await response.json()) as Result<ProjectCatalog>;
  assert(catalog.ok);
  return catalog.value.selectedProjectId;
}

/** Restores Factory's selected Project for the journeys that follow. */
export async function restoreProjectSelection(baseUrl: string | undefined, id: string | null) {
  const response = await fetch(new URL(selectionPath, baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: JSON.stringify({ id }),
  });
  assert(response.ok);
}

export async function openComposerWithFlow(app: App, screen: Screen, flowName: string) {
  await app.open("/runs/new");
  await selectComposerFlow(screen, flowName);
}

/** Selects a Project and a Flow, then fills the initial prompt. */
export async function fillReadyComposer(
  screen: Screen,
  prompt: string,
  project = "Northwind",
  flow = "Northwind release",
) {
  await selectComposerProject(screen, project);
  await selectComposerFlow(screen, flow);
  await screen.getByLabel("Initial prompt", { exact: false }).fill(prompt);
}

/** Opens the New Run composer with a Project, a Flow, and a prompt. */
export async function openReadyComposer(app: App, screen: Screen, prompt: string) {
  await app.open("/runs/new");
  await fillReadyComposer(screen, prompt);
}

/**
 * Opens a checkout copy of Demo · Parallel review, places a model-less Agent on its later branch,
 * and waits until that reason keeps Start disabled.
 */
export async function blockOnModelLessLaterReview(app: App, screen: Screen) {
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Demo · Accessibility reviewer",
    "Model-less accessibility reviewer",
    { modelLess: true },
  );
  const flow = await saveFlowCopy(
    app.baseUrl,
    "Demo · Parallel review",
    "Model-less later review",
    {
      mode: "checkout",
    },
  );
  await openComposerWithFlow(app, screen, "Model-less later review");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI model-less later Agent");
  await placeAgentElsewhere(app.baseUrl, flow, "accessibility", agent.id);
  await expect(
    screen.getByText(/Accessibility review: Model-less accessibility reviewer needs a model\./),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeDisabled();
  return { agent, flow };
}

/** Factory accepts the Start but its response is lost: the composer offers Check same request. */
export async function startLosingResponse(screen: Screen, browser: Browser) {
  await browser.route("**/api/runs", async (route) => {
    if (route.request.method !== "POST") return route.continue();
    await route.fetch();
    await route.abort();
  });
  await screen.getByRole("button", "Start", { exact: true }).tap();
  await expect(screen.getByRole("button", "Check same request", { exact: true })).toBeVisible();
  await browser.unrouteAll();
}

/** A file carried by a clipboard paste or a drag from the desktop. */
export interface CarriedFile {
  readonly name: string;
  readonly type: string;
  readonly data: Uint8Array;
}

/**
 * Dispatches the browser's own paste or drop event carrying real files at the prompt editor, as
 * Ctrl+V/Cmd+V after copying screenshots or dragging them from the desktop does. Automation has
 * no OS clipboard or desktop drag source, so the event is constructed in the page.
 */
async function carry(browser: Browser, kind: "paste" | "drop", files: readonly CarriedFile[]) {
  const carried = files.map(({ name, type, data }) => ({
    name,
    type,
    data: Buffer.from(data).toString("base64"),
  }));
  await browser.evaluate(`(() => {
    const { kind, files } = ${JSON.stringify({ kind, files: carried })};
    const editor = document.getElementById("launch-prompt");
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    const init = { bubbles: true, cancelable: true };
    if (kind === "paste")
      editor.dispatchEvent(new ClipboardEvent("paste", { ...init, clipboardData: transfer }));
    else
      for (const type of ["dragenter", "dragover", "drop"])
        editor.dispatchEvent(new DragEvent(type, { ...init, dataTransfer: transfer }));
  })()`);
}

/** Pastes files at the prompt caret. */
export const pasteFiles = (browser: Browser, files: readonly CarriedFile[]) =>
  carry(browser, "paste", files);

/** Drops files on the prompt field. */
export const dropFiles = (browser: Browser, files: readonly CarriedFile[]) =>
  carry(browser, "drop", files);
