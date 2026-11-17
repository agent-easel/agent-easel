import { expect, it } from "vite-plus/test";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { currentSettings, widensAdmission } from "../src/trigger-review.ts";

const saved: TriggerDefinition = {
  id: "trigger-1",
  kind: "github_issues",
  name: "Ready issues",
  enabled: true,
  projectId: "project-1",
  flowId: "flow-1",
  schedule: { enabled: true, intervalMinutes: 5 },
  maxActiveRuns: 2,
  revision: 3,
  nextCheckAt: null,
  latestCheck: null,
  error: null,
  github: {
    repository: { host: "github.com", nameWithOwner: "acme/web", nodeId: "R_web" },
    query: "label:factory:ready author:@me",
    readyLabel: "factory:ready",
  },
  createdAt: "2026-11-10T09:00:00.000Z",
  updatedAt: "2026-11-10T09:00:00.000Z",
};
const edit = currentSettings(saved);

it("changing the Project and its repository needs a review", () => {
  // Arrange
  const moved = {
    ...edit,
    projectId: "project-2",
    github: { ...edit.github, repositoryNodeId: "R_api" },
  };

  // Act
  const widens = widensAdmission(saved, moved);

  // Assert
  expect(widens).toBe(true);
});

it("changing the query needs a review", () => {
  // Arrange
  const query = { ...edit, github: { ...edit.github, query: "label:factory:ready" } };

  // Act
  const widens = widensAdmission(saved, query);

  // Assert
  expect(widens).toBe(true);
});

it("changing the Flow needs a review", () => {
  // Arrange
  const flow = { ...edit, flowId: "flow-2" };

  // Act
  const widens = widensAdmission(saved, flow);

  // Assert
  expect(widens).toBe(true);
});

it("raising Max active Runs needs a review", () => {
  // Arrange
  const raised = { ...edit, maxActiveRuns: 3 };

  // Act
  const widens = widensAdmission(saved, raised);

  // Assert
  expect(widens).toBe(true);
});

it("renaming, changing the interval and lowering the limit save without a review", () => {
  // Arrange
  const harmless = {
    ...edit,
    name: "Renamed",
    schedule: { enabled: true, intervalMinutes: 60 },
    maxActiveRuns: 1,
  };

  // Act
  const widens = widensAdmission(saved, harmless);

  // Assert
  expect(widens).toBe(false);
});
