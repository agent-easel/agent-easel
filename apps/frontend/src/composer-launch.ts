import type { FactoryProject, ValidationIssue } from "@t3-factory/contracts";
import type { ConnectionPresentation } from "./connection-state.tsx";

/** T3's app. The no-project card only navigates here; Factory takes no action in T3. */
export const t3AppUrl = "https://app.t3.codes";

/** The one composer card, so a field can point its description at it. */
export const composerLaunchCardId = "composer-launch-card";

export type StartDestination = "reporting" | "connection" | "flows" | "agents";

export interface StartCause {
  readonly message: string;
  readonly destination: StartDestination;
  readonly flowId: string;
}

interface CatalogProject {
  readonly id: string;
  readonly title: string;
  readonly availability: FactoryProject["availability"];
}

interface LaunchFlow {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly ready: boolean;
  readonly issues: readonly string[];
}

interface LaunchAgent {
  readonly projectId: string | null;
  readonly execution: unknown;
}

/** Facts the composer already has. The card is the only launch message they produce. */
export interface ComposerLaunchState {
  readonly factoryOffline: boolean;
  readonly presentation: ConnectionPresentation;
  /** Saved T3 address, or null when none is saved or the status has not loaded. */
  readonly endpoint: string | null;
  readonly pending: boolean;
  readonly startError: string;
  readonly startIssues: readonly ValidationIssue[];
  readonly choicesError: string;
  readonly saveFailed: boolean;
  readonly catalog: {
    readonly projects: readonly CatalogProject[];
    readonly problem: string | null;
  } | null;
  readonly projectId: string;
  readonly flows: readonly LaunchFlow[] | null;
  readonly flowId: string;
  readonly agents: readonly LaunchAgent[] | null;
}

export type LaunchCard =
  | { readonly kind: "none" }
  | { readonly kind: "factory-offline" }
  | { readonly kind: "checking" }
  | { readonly kind: "status-unknown" }
  | { readonly kind: "unconfigured" }
  | { readonly kind: "disconnected" }
  | { readonly kind: "authorization" }
  | { readonly kind: "incompatible" }
  | { readonly kind: "start-unknown"; readonly message: string }
  | { readonly kind: "start-rejected"; readonly causes: readonly StartCause[] }
  | { readonly kind: "discovery"; readonly message: string }
  | { readonly kind: "no-projects" }
  | { readonly kind: "choose-project" }
  | { readonly kind: "create-agent" }
  | { readonly kind: "setup-agent" }
  | { readonly kind: "create-flow" }
  | { readonly kind: "no-ready-flows"; readonly projectTitle: string }
  | {
      readonly kind: "flow-not-ready";
      readonly flowId: string;
      readonly flowName: string;
      readonly issues: readonly string[];
    }
  | { readonly kind: "draft-storage" }
  | { readonly kind: "choices-stale"; readonly message: string };

/** Where one Start cause is repaired. Connection wins over a path that also names an Agent. */
function startDestination(issue: ValidationIssue): StartDestination {
  if (issue.code === "reporting_installation") return "reporting";
  if (issue.path.split(".").includes("connection") || issue.code === "project_connection")
    return "connection";
  if (issue.path.startsWith("graph.") || issue.path.startsWith("workspace.")) return "flows";
  return "agents";
}

/**
 * Whether a Flow of this Project can place an Agent. Unknown while Studio has not loaded, so the
 * composer does not flash a first-run card. No placeable Agent comes before a missing model.
 */
function agentLaunchGate(
  agents: readonly LaunchAgent[] | null,
  projectId: string,
): "unknown" | "create-agent" | "setup-agent" | "ready" {
  if (!agents) return "unknown";
  const placeable = agents.filter(
    (agent) => agent.projectId === null || agent.projectId === projectId,
  );
  if (placeable.length === 0) return "create-agent";
  if (placeable.every((agent) => agent.execution === null)) return "setup-agent";
  return "ready";
}

function startCauses(
  issues: readonly ValidationIssue[],
  error: string,
  flowId: string,
): readonly StartCause[] {
  if (issues.length === 0) return [{ message: error, destination: "agents", flowId }];
  return issues.map((issue) => ({
    message: issue.message,
    destination: startDestination(issue),
    flowId,
  }));
}

function connectionCard(state: ComposerLaunchState): LaunchCard {
  if (state.presentation === "loading") return { kind: "checking" };
  if (state.presentation === "load-error") return { kind: "status-unknown" };
  if (!state.endpoint) return { kind: "unconfigured" };
  if (state.presentation === "authorization-required") return { kind: "authorization" };
  if (state.presentation === "incompatible") return { kind: "incompatible" };
  return { kind: "disconnected" };
}

/** Shown only when no launch card already explains why Start is blocked. */
function leftover(state: ComposerLaunchState): LaunchCard {
  if (state.saveFailed && !state.pending) return { kind: "draft-storage" };
  if (state.choicesError) return { kind: "choices-stale", message: state.choicesError };
  return { kind: "none" };
}

function projectCard(
  catalog: NonNullable<ComposerLaunchState["catalog"]>,
  project: CatalogProject | undefined,
): LaunchCard {
  if (project?.availability === "connection-unavailable") return { kind: "none" };
  const available = catalog.projects.some((item) => item.availability === "available");
  if (!available && !project) return { kind: "no-projects" };
  return { kind: "choose-project" };
}

function prerequisiteCard(
  state: ComposerLaunchState,
  projectTitle: string,
  flows: readonly LaunchFlow[],
): LaunchCard {
  const relevant = flows.filter(
    (flow) => flow.projectId === null || flow.projectId === state.projectId,
  );
  const selected = relevant.find((flow) => flow.id === state.flowId);
  const noFlows = relevant.length === 0;
  const noneReady = relevant.length > 0 && relevant.every((flow) => !flow.ready) && !selected;
  if (!noFlows && !noneReady) return leftover(state);
  const gate = agentLaunchGate(state.agents, state.projectId);
  if (gate === "unknown") return leftover(state);
  if (gate === "create-agent") return { kind: "create-agent" };
  if (gate === "setup-agent") return { kind: "setup-agent" };
  if (noFlows) return { kind: "create-flow" };
  return { kind: "no-ready-flows", projectTitle };
}

/**
 * The one card under the composer. Factory being offline wins, then the T3 connection, then a
 * Start result, then discovery, then the Project, then a chosen Flow that is not ready, then the
 * first missing Agent or Flow. A chosen not-ready Flow is more specific than the Agent card.
 */
export function composerLaunchCard(state: ComposerLaunchState): LaunchCard {
  if (state.factoryOffline) return { kind: "factory-offline" };
  if (state.presentation !== "ready") return connectionCard(state);
  if (state.pending && state.startError)
    return { kind: "start-unknown", message: state.startError };
  if (state.startError)
    return {
      kind: "start-rejected",
      causes: startCauses(state.startIssues, state.startError, state.flowId),
    };
  if (state.catalog?.problem) return { kind: "discovery", message: state.catalog.problem };
  const project = state.catalog?.projects.find((item) => item.id === state.projectId);
  const projectReady = project?.availability === "available";
  if (!projectReady) {
    if (!state.catalog) return leftover(state);
    const card = projectCard(state.catalog, project);
    return card.kind === "none" ? leftover(state) : card;
  }
  const selected = state.flows?.find((flow) => flow.id === state.flowId);
  if (selected && !selected.ready)
    return {
      kind: "flow-not-ready",
      flowId: selected.id,
      flowName: selected.name,
      issues: selected.issues,
    };
  if (!state.flows) return leftover(state);
  return prerequisiteCard(state, project.title, state.flows);
}
