import { expect, it } from "vite-plus/test";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { createTriggerDraft, triggerFlows } from "../src/trigger-draft.ts";
import { deliveredStudio, savedFlow } from "./support/studio-definitions.ts";

it("the Trigger form offers global Flows and the chosen Project's Flows", () => {
  // Arrange
  const flows = [
    savedFlow("Global", { id: "global", projectId: null }),
    savedFlow("Atlas release", { id: "atlas", projectId: "atlas" }),
    savedFlow("Northwind release", { id: "northwind", projectId: "northwind" }),
    savedFlow("Docs refresh", { id: "docs", projectId: "docs" }),
  ];

  // Act
  const offered = triggerFlows(flows, "atlas");

  // Assert
  expect(offered.map((flow) => flow.id)).toStrictEqual(["global", "atlas"]);
});

it("a case-insensitive Trigger name already in Studio disables saving the draft", () => {
  // Arrange
  const { definitions, close } = deliveredStudio({
    flows: [],
    agents: [],
    triggers: [{ id: "other", name: "Ready Issues" } as TriggerDefinition],
  });
  const draft = createTriggerDraft(null, definitions);
  const disconnect = draft.connect();
  draft.edit({ name: "New name", projectId: "atlas", flowId: "global" });
  draft.detectRepository("atlas", {
    host: "github.com",
    nameWithOwner: "factory-demo/atlas",
    nodeId: "atlas-repository",
  });
  expect(draft.getSnapshot().canSave).toBe(true);

  // Act
  draft.edit({ name: " ready issues " });

  // Assert
  expect(draft.getSnapshot().nameTaken).toBe(true);
  expect(draft.getSnapshot().canSave).toBe(false);
  disconnect();
  close();
});

it("a check refused for a newer revision enters the revision conflict a stale save enters", () => {
  // Arrange
  const saved: TriggerDefinition = {
    id: "trigger-1",
    kind: "github_issues",
    name: "Ready issues",
    enabled: true,
    projectId: "atlas",
    flowId: "global",
    schedule: { enabled: true, intervalMinutes: 5 },
    maxActiveRuns: 2,
    revision: 3,
    nextCheckAt: null,
    latestCheck: null,
    error: null,
    github: {
      repository: { host: "github.com", nameWithOwner: "factory-demo/atlas", nodeId: "atlas" },
      query: "label:factory:ready",
      readyLabel: "factory:ready",
    },
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
  };
  const { definitions, close } = deliveredStudio({ flows: [], agents: [], triggers: [saved] });
  const draft = createTriggerDraft(saved, definitions);
  const disconnect = draft.connect();
  draft.edit({ name: "Renamed" });

  // Act
  draft.noteStaleRevision();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Renamed" },
    dirty: true,
    conflict: { status: "detected", revision: null },
    canSave: false,
  });
  disconnect();
  close();
});
