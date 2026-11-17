import { expect, it } from "vite-plus/test";
import { triggerFlows } from "../src/trigger-draft.ts";
import { savedFlow } from "./support/studio-definitions.ts";

it("the Trigger form offers global Flows and the chosen Project's Flows, keeping the chosen Flow", () => {
  // Arrange
  const flows = [
    savedFlow("Global", { id: "global", projectId: null }),
    savedFlow("Atlas release", { id: "atlas", projectId: "atlas" }),
    savedFlow("Northwind release", { id: "northwind", projectId: "northwind" }),
    savedFlow("Docs refresh", { id: "docs", projectId: "docs" }),
  ];

  // Act
  const offered = triggerFlows(flows, "atlas", "docs");

  // Assert
  expect(offered.map((flow) => flow.id)).toStrictEqual(["global", "atlas", "docs"]);
});
