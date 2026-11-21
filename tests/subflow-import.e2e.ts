import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import type {
  PortableAgent,
  PortableFlowBlock,
  PortableFlowDocument,
} from "../packages/contracts/src/index.ts";
import { readFlow } from "./support/flows.ts";
import { listFlows } from "./support/owners.ts";
import { test } from "./support/test.ts";

test("nested import reviews repeated names, workspaces and instructions, then opens the new root", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const file = await writeBundle();
  await app.open("/studio/flows");
  await expect(screen.getByRole("button", "Import", { exact: true })).toBeEnabled();

  // Act
  await screen.getByLabel("Choose a Factory export file").setInputFiles([file]);
  const review = screen.getByRole("dialog", /Import “release-train.json”/);
  const flows = review.getByRole("region", "Flows · 6 · created in Global");
  await expect(flows).toContainText("Opens after import");
  await expect(flows).toContainText(
    "Used in Review panel · Lint checks, Checks (2) · Repeat checks",
  );
  await expect(flows).toContainText("Uses itself");
  await expect(review.getByRole("region", "Workspace")).toContainText("New worktree · main");
  await app.screenshot("nested-import-top");
  await review.getByRole("region", /^Agents/).scrollIntoView();
  await app.screenshot("nested-import-models");
  const instructions = review.getByRole("region", /^Instructions/);
  await instructions.scrollIntoView();
  await expect(instructions).toContainText("Checks (1)");
  await expect(instructions).toContainText("Checks (2)");
  await expect(
    instructions.getByText("Agent prompt · Changelog checker", { exact: true }),
  ).toHaveCount(3);
  await expect(instructions).toContainText("Continuation prompt");
  await expect(instructions).toContainText("Revisit instruction");
  await expect(review.getByRole("group", "Changelog checker")).toContainText("Needs a model");
  await app.screenshot("nested-import-instructions");
  await review.getByRole("button", "Import", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue("Release train");
  const rootId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  const root = await readFlow(app.baseUrl, rootId);
  const created = await listFlows(app.baseUrl);
  assert.equal(root.revision, 1);
  assert.deepEqual(root.workspace, { mode: "worktree", base: { kind: "ref", ref: "main" } });
  const reviewPanel = created.find((flow) => flow.name === "Review panel");
  assert(reviewPanel);
  assert(
    root.graph.blocks.some((block) => block.kind === "subflow" && block.flowId === reviewPanel.id),
  );
  assert.equal(created.filter((flow) => flow.name === "Checks").length, 2);
  await app.screenshot("nested-import-opened-root");
});

const worktree = { mode: "worktree", base: { kind: "ref", ref: "main" } } as const;
const position = { x: 240, y: 90 };
const subflow = (id: string, name: string, flowKey: string) => ({
  id,
  name,
  kind: "subflow" as const,
  flowKey,
  position,
});
const writer = (id: string, name: string, agentKey: string, revisitInstruction = "") => ({
  id,
  name,
  kind: "agent" as const,
  agentKey,
  position,
  revisitInstruction,
  revisitContext: "keep" as const,
  hiddenExitIds: [],
  localExits: [],
});
const continuation = (id: string, name: string, prompt: string) => ({
  id,
  name,
  kind: "continuation" as const,
  position,
  prompt,
});
const flow = (
  key: string,
  name: string,
  blocks: PortableFlowBlock[],
  workspace: PortableFlowDocument["flows"][number]["workspace"] = { mode: "checkout" },
) => ({
  key,
  name,
  workspace,
  graph: {
    blocks,
    connections: [],
    flowInput: { position: { x: 40, y: 90 }, targetBlockIds: [] },
    finish: { position: { x: 850, y: 90 }, endings: [] },
  },
});
const agent = (
  key: string,
  name: string,
  prompt: string,
  model: PortableAgent["model"],
): PortableAgent => ({
  key,
  name,
  prompt,
  model,
  exits: [],
});

async function writeBundle() {
  const model = {
    driverKind: "codex",
    providerInstanceId: "codex-main",
    modelId: "gpt-6.1-sol",
    modelOptions: [],
  };
  const document: PortableFlowDocument = {
    format: "t3-factory/definitions",
    formatVersion: 5,
    kind: "flow",
    factoryVersion: "source",
    exportedAt: "2026-11-21T09:00:00.000Z",
    rootFlowKey: "release",
    flows: [
      flow("review", "Review panel", [
        writer("security", "Security reviewer", "security", "Recheck the patch."),
        subflow("lint", "Lint checks", "checks-first"),
      ]),
      flow("checks-first", "Checks", [writer("lint", "Lint", "changelog")]),
      flow(
        "hotfix",
        "Hotfix lane",
        [
          continuation("hotfix", "Hotfix", "Continue the hotfix."),
          subflow("review", "Second review", "review"),
          subflow("smoke", "Smoke checks", "checks-second"),
        ],
        worktree,
      ),
      flow("checks-second", "Checks", [
        writer("smoke", "Smoke test", "changelog"),
        subflow("repeat", "Repeat checks", "checks-first"),
      ]),
      flow("docs", "Docs check", [
        writer("check", "Docs reviewer", "changelog", "Recheck the docs."),
        subflow("recheck", "Recheck", "docs"),
      ]),
      flow(
        "release",
        "Release train",
        [
          writer("writer", "Writer", "release-writer"),
          continuation("revise", "Revise notes", "Revise the release notes."),
          subflow("review", "Review", "review"),
          subflow("hotfix", "Hotfix", "hotfix"),
          subflow("docs", "Docs", "docs"),
        ],
        worktree,
      ),
    ],
    agents: [
      agent("release-writer", "Release writer", "Draft the release.", model),
      agent("security", "Security reviewer", "Review the patch.", model),
      agent("changelog", "Changelog checker", "Check the changelog.", null),
    ],
  };
  const directory = join(process.cwd(), ".e2e", "tmp");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "release-train.json");
  await writeFile(path, JSON.stringify(document));
  return path;
}
