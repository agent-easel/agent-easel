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
