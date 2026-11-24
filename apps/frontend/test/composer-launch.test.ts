import { expect, it } from "vite-plus/test";
import { composerLaunchCard, type ComposerLaunchState } from "../src/composer-launch.ts";

function ready(overrides: Partial<ComposerLaunchState> = {}): ComposerLaunchState {
  return {
    factoryOffline: false,
    presentation: "ready",
    endpoint: "http://127.0.0.1/mcp",
    pending: false,
    startError: "",
    startIssues: [],
    choicesError: "",
    saveFailed: false,
    catalog: {
      problem: null,
      projects: [{ id: "project", title: "Northwind", availability: "available" }],
    },
    projectId: "project",
    flows: [
      {
        id: "flow",
        projectId: "project",
        name: "Northwind release",
        ready: true,
        issues: [],
      },
    ],
    flowId: "flow",
    agents: [{ projectId: null, execution: { model: "ready" } }],
    ...overrides,
  };
}

const unfinishedFlow = {
  id: "flow",
  projectId: "project",
  name: "Northwind release",
  ready: false,
  issues: [] as readonly string[],
};

it("AgentEasel offline wins over a lost T3 Code connection and an unconfirmed Start", () => {
  // Arrange
  const state = ready({
    factoryOffline: true,
    presentation: "unavailable",
    pending: true,
    startError: "Start outcome unknown.",
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "factory-offline" });
});

it("a connection that is still loading is not treated as T3 Code not set up", () => {
  // Arrange
  const state = ready({ presentation: "loading", endpoint: null, projectId: "", flowId: "" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "checking" });
});

it("no saved T3 Code address is the not-set-up card", () => {
  // Arrange
  const state = ready({ presentation: "unavailable", endpoint: null });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "unconfigured" });
});

it("a saved T3 Code address that stopped answering is the disconnected card", () => {
  // Arrange
  const state = ready({ presentation: "unavailable" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "disconnected" });
});

it("a rejected Start lists every cause and wins over a Flow that is not ready", () => {
  // Arrange
  const state = ready({
    startError: "Flow execution setup is incomplete. No Run was created.",
    startIssues: [
      {
        code: "reporting_installation",
        path: "agents.a.runtime",
        message: "Install reporting.",
      },
      { code: "agent_model_required", path: "agents.b.execution", message: "Needs a model." },
      { code: "project_connection", path: "projectId", message: "Check the connection." },
      { code: "workspace_base", path: "workspace.base", message: "Missing base." },
      { code: "graph_input", path: "graph.input", message: "Connect the input." },
      {
        code: "launch_unsupported",
        path: "agents.c.connection.contract",
        message: "Contract.",
      },
    ],
    flows: [{ ...unfinishedFlow, issues: ["Not ready."] }],
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({
    kind: "start-rejected",
    causes: [
      { message: "Install reporting.", destination: "reporting", flowId: "flow" },
      { message: "Needs a model.", destination: "agents", flowId: "flow" },
      { message: "Check the connection.", destination: "connection", flowId: "flow" },
      { message: "Missing base.", destination: "flows", flowId: "flow" },
      { message: "Connect the input.", destination: "flows", flowId: "flow" },
      { message: "Contract.", destination: "connection", flowId: "flow" },
    ],
  });
});

it("a chosen Flow that is not ready wins over having no placeable Agent", () => {
  // Arrange
  const state = ready({
    agents: [],
    flows: [
      {
        ...unfinishedFlow,
        issues: ["Connect the Flow input to at least one Agent before running this Flow."],
      },
    ],
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({
    kind: "flow-not-ready",
    flowId: "flow",
    flowName: "Northwind release",
    issues: ["Connect the Flow input to at least one Agent before running this Flow."],
  });
});

it("no placeable Agent wins over creating a Flow", () => {
  // Arrange
  const state = ready({
    agents: [{ projectId: "other", execution: { model: "ready" } }],
    flows: [],
    flowId: "",
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "create-agent" });
});

it("no placeable Agent wins over a Project whose Flows are not ready", () => {
  // Arrange
  const state = ready({
    agents: [{ projectId: "other", execution: null }],
    flows: [unfinishedFlow],
    flowId: "",
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "create-agent" });
});

it("placeable Agents with no model ask for setup instead of a Flow", () => {
  // Arrange
  const state = ready({
    agents: [{ projectId: null, execution: null }],
    flows: [],
    flowId: "",
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "setup-agent" });
});

it("a placeable Agent with a model asks for the first Flow", () => {
  // Arrange
  const state = ready({ flows: [], flowId: "" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "create-flow" });
});

it("Flows that exist but are not ready name the Project once an Agent can be placed", () => {
  // Arrange
  const state = ready({ flows: [unfinishedFlow], flowId: "" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "no-ready-flows", projectTitle: "Northwind" });
});

it("does not flash a first-run card while Agents are still loading", () => {
  // Arrange
  const state = ready({ agents: null, flows: [], flowId: "" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "none" });
});

it("a connected catalog with nothing available and nothing selected is the no-project card", () => {
  // Arrange
  const state = ready({
    projectId: "",
    flowId: "",
    catalog: { problem: null, projects: [] },
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "no-projects" });
});

it("available Projects with none selected ask for a choice", () => {
  // Arrange
  const state = ready({ projectId: "", flowId: "" });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "choose-project" });
});

it("a discovery failure wins over the no-project card", () => {
  // Arrange
  const state = ready({
    projectId: "",
    flowId: "",
    catalog: {
      problem:
        "Project discovery failed. Recheck T3 Code and its project contract. Saved references are retained.",
      projects: [],
    },
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({
    kind: "discovery",
    message:
      "Project discovery failed. Recheck T3 Code and its project contract. Saved references are retained.",
  });
});

it("a Project kept through a connection outage does not become the no-project card", () => {
  // Arrange
  const state = ready({
    catalog: {
      problem: null,
      projects: [{ id: "project", title: "Northwind", availability: "connection-unavailable" }],
    },
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "none" });
});

it("an unconfirmed Start is its own card once T3 Code is connected", () => {
  // Arrange
  const state = ready({ pending: true, startError: "Start outcome unknown." });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "start-unknown", message: "Start outcome unknown." });
});

it("an unconfirmed Start stays behind the disconnected card while T3 Code is down", () => {
  // Arrange
  const state = ready({
    pending: true,
    startError: "Start outcome unknown.",
    presentation: "unavailable",
  });

  // Act
  const card = composerLaunchCard(state);

  // Assert
  expect(card).toEqual({ kind: "disconnected" });
});
