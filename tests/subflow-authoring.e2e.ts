import assert from "node:assert/strict";
import { expect } from "e2e";
import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowDraft,
  type Result,
} from "../packages/contracts/src/index.ts";
import { readFlow, removeFlowElsewhere, saveFlowElsewhere } from "./support/flows.ts";
import { readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";
import { test } from "./support/test.ts";

const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

async function apiJson<T>(
  baseUrl: string | undefined,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const result = (await (await fetch(new URL(path, baseUrl), init)).json()) as Result<T>;
  assert(result.ok);
  return result.value;
}

async function createReviewPanelFlow(baseUrl: string | undefined, name: string) {
  const agents = await apiJson<AgentDefinition[]>(baseUrl, "/api/agents");
  const reviewer = agents.find((agent) => agent.name === "Sample worker") ?? agents[0];
  assert(reviewer);
  return apiJson<FlowDraft>(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({
      name,
      workspace: { mode: "checkout" },
      graph: {
        flowInput: { position: { x: 40, y: 120 }, targetBlockIds: ["security"] },
        blocks: [
          {
            id: "security",
            name: "Security review",
            kind: "agent",
            agentId: reviewer.id,
            position: { x: 320, y: 120 },
            hiddenExitIds: [],
            localExits: [],
            revisitInstruction: "",
            revisitContext: "keep",
          },
        ],
        connections: [
          {
            sourceBlockId: "security",
            exitId: reviewer.exits[0]!.id,
            targetBlockId: FINISH_BLOCK_ID,
            targetEndingId: "approved",
          },
          {
            sourceBlockId: "security",
            exitId: reviewer.exits[0]!.id,
            targetBlockId: FINISH_BLOCK_ID,
            targetEndingId: "needs-changes",
          },
        ],
        finish: {
          position: { x: 680, y: 120 },
          endings: [
            {
              id: "approved",
              name: "Approved",
              description: "Review passed.",
              output: "optional",
              outputDescription: "Review summary",
            },
            {
              id: "needs-changes",
              name: "Needs changes",
              description: "Changes requested.",
              output: "required",
              outputDescription: "Requested changes",
            },
          ],
        },
      },
    }),
  });
}

async function createEmptyParentFlow(baseUrl: string | undefined, name: string) {
  return apiJson<FlowDraft>(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({
      name,
      workspace: { mode: "checkout" },
      graph: {
        flowInput: { position: { x: 40, y: 160 }, targetBlockIds: [] },
        blocks: [],
        connections: [],
        finish: {
          position: { x: 1480, y: 160 },
          endings: [
            {
              id: "returned",
              name: "Returned",
              description: "Returned for fixes.",
              output: "optional",
              outputDescription: "Feedback",
            },
          ],
        },
      },
    }),
  });
}

async function renameChildEnding(
  baseUrl: string | undefined,
  childId: string,
  endingId: string,
  name: string,
) {
  const latestChild = await readFlow(baseUrl, childId);
  return saveFlowElsewhere(baseUrl, latestChild, {
    graph: {
      ...latestChild.graph,
      finish: {
        ...latestChild.graph.finish,
        endings: latestChild.graph.finish.endings.map((item) =>
          item.id === endingId ? { ...item, name } : item,
        ),
      },
    },
  });
}

async function removeChildEnding(baseUrl: string | undefined, child: FlowDraft, endingId: string) {
  return saveFlowElsewhere(baseUrl, child, {
    graph: {
      ...child.graph,
      connections: child.graph.connections.filter((edge) => edge.targetEndingId !== endingId),
      finish: {
        ...child.graph.finish,
        endings: child.graph.finish.endings.filter((item) => item.id !== endingId),
      },
    },
  });
}

test("placing a saved Flow renders an expanded Subflow group, wires exits, collapses, persists and blocks cycles", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const child = await createReviewPanelFlow(app.baseUrl, "S1 Review panel");
  const parent = await createEmptyParentFlow(app.baseUrl, "S1 Release with review");
  await app.open(`/studio/flows/${parent.id}`);

  // Act
  const library = screen.getByRole("region", "Block library");
  await library.getByRole("button", /^Add S1 Review panel/).tap();
  const group = screen.getByRole("article", "Subflow S1 Review panel");
  await expect(group).toBeVisible();
  await expect(group).toContainText("Incoming message");
  await expect(group).toContainText("Security review");
  await expect(group).toContainText("Approved");

  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await screen.getByRole("button", "Flow input", { exact: true }).tap();
  await screen.getByRole("button", /^Targets of the Flow input:/).tap();
  await screen.getByRole("menuitemcheckbox", "S1 Review panel", { exact: true }).tap();
  await browser.keyboard.press("Escape");

  await group.getByRole("button", /^Subflow S1 Review panel/).tap();
  const needsChanges = screen.getByRole("listitem", "Exit Needs changes");
  await needsChanges.getByRole("button", /^Targets of exit Needs changes:/).tap();
  await screen.getByRole("menuitemcheckbox", "Finish → Returned", { exact: true }).tap();
  await browser.keyboard.press("Escape");

  await saveFlowWithReadiness(screen, "Ready");
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot("s1-subflow-expanded");

  await group.getByRole("button", "Collapse S1 Review panel", { exact: true }).tap();
  const expandButton = screen.getByRole("button", "Expand S1 Review panel", { exact: true });
  await expect(expandButton).toBeVisible();
  await app.screenshot("s1-subflow-collapsed");

  await expandButton.tap();
  await expect(group).toBeVisible();

  await app.open(`/studio/flows/${parent.id}`);
  await expect(screen.getByRole("article", "Subflow S1 Review panel")).toBeVisible();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();

  await app.open(`/studio/flows/${child.id}`);
  const childLibrary = screen.getByRole("region", "Block library");
  await expect(childLibrary.getByLabel("S1 Release with review", { exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(childLibrary.getByRole("button", /^Add S1 Release with review/)).toHaveCount(0);
  await app.screenshot("s1-subflow-cycle-disabled");
});

test("renaming a child ending preserves its wire while removing an ending or child Flow stays repairable", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const child = await createReviewPanelFlow(app.baseUrl, "S1 Repair panel");
  const parent = await apiJson<FlowDraft>(app.baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({
      name: "S1 Repair parent",
      workspace: { mode: "checkout" },
      graph: {
        flowInput: { position: { x: 40, y: 160 }, targetBlockIds: ["review"] },
        blocks: [
          {
            id: "review",
            name: "Review step",
            kind: "subflow",
            flowId: child.id,
            position: { x: 340, y: 80 },
          },
        ],
        connections: [
          {
            sourceBlockId: "review",
            exitId: "approved",
            targetBlockId: FINISH_BLOCK_ID,
            targetEndingId: "shipped",
          },
        ],
        finish: {
          position: { x: 1200, y: 160 },
          endings: [
            {
              id: "shipped",
              name: "Shipped",
              description: "",
              output: "optional",
              outputDescription: "",
            },
          ],
        },
      },
    }),
  });
  await app.open(`/studio/flows/${parent.id}`);
  await expect(readinessSummary(screen, "Ready")).toBeVisible();

  // Act
  const renamedChild = await renameChildEnding(app.baseUrl, child.id, "approved", "Signed off");

  // Assert
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  const group = screen.getByRole("article", "Subflow Review step");
  await expect(group).toContainText("Signed off");

  await removeChildEnding(app.baseUrl, renamedChild, "approved");
  await expect(readinessSummary(screen, /^Not ready/)).toBeVisible();
  await group.getByRole("button", /^Subflow Review step/).tap();
  const brokenSection = screen.getByRole("region", "Broken wires");
  await expect(brokenSection).toBeVisible();
  await app.screenshot("s1-subflow-broken-wire");
  await brokenSection.getByRole("button", /^Remove broken wire/).tap();
  await expect(brokenSection).toHaveCount(0);

  await removeFlowElsewhere(app.baseUrl, child.id);
  await expect(readinessSummary(screen, /^Not ready/)).toBeVisible();
  await expect(screen.getByRole("combobox", /Missing Flow/)).toBeVisible();
  await expect(screen.getByRole("alert")).toContainText("was removed or does not exist");
  await app.screenshot("s1-subflow-missing-child");
});
