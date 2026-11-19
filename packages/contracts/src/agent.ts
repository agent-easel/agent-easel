/** Agents: reusable definitions of how an Agent block's work runs, and their operations. */
import type { BlockExit, ChangeOwnerInput } from "./flow.ts";
import { operation } from "./operation.ts";
import type { DefinitionExport, PortableAgentDocument } from "./portable-document.ts";

export interface AgentModelOptionValue {
  readonly id: string;
  readonly value: string | boolean;
}

export interface AgentExecutionSettings {
  readonly environmentId: string;
  readonly providerInstanceId: string;
  readonly modelId: string;
  readonly modelOptions: readonly AgentModelOptionValue[];
}

export type AgentSettingAvailability = "available" | "unavailable" | "unknown";

export interface AgentSettingStatus {
  readonly state: AgentSettingAvailability;
  readonly explanation?: string;
}

export interface AgentExecutionSettingsStatus {
  readonly environment: AgentSettingStatus;
  readonly provider: AgentSettingStatus;
  readonly model: AgentSettingStatus;
  readonly options: readonly { readonly id: string; readonly state: AgentSettingAvailability }[];
}

/**
 * A global Agent's execution settings for Runs in one Project, replacing its own settings there.
 * Name, prompt and exits stay shared; a different prompt needs a Project Agent.
 */
export interface AgentProjectOverride {
  /** The Factory Project whose Runs use these settings. */
  readonly projectId: string;
  readonly execution: AgentExecutionSettings;
}

/** Fields every saved Agent revision has; `execution` decides which revision shape applies. */
interface AgentFields {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly revision: number;
  /** Inherited live by every Flow block of this Agent; a Run keeps the revision it captured. */
  readonly exits: readonly BlockExit[];
  /**
   * Part of the revision, so a Run's captured revision and its Project decide its settings. Only a
   * global Agent with execution settings has any, at most one per Project.
   */
  readonly projectOverrides: readonly AgentProjectOverride[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An Agent revision a Run captured; Start accepts only Agents with execution settings. */
export interface CapturedAgent extends AgentFields {
  readonly execution: AgentExecutionSettings;
}

/**
 * The content of one saved Agent revision. `execution` is complete or null, never partial: an
 * Agent without execution settings Needs a model and cannot run.
 */
export type AgentRevisionContent = CapturedAgent | (AgentFields & { readonly execution: null });

/**
 * A saved Agent: its latest revision and its owning Project, the Factory Project id it belongs to
 * or null for a global Agent. Ownership belongs to the Agent identity, not to its revisions, so a
 * Run's captured revisions carry none.
 */
export type AgentDefinition = AgentRevisionContent & { readonly projectId: string | null };

export interface AgentEnvironment {
  readonly environmentId: string;
  readonly label: string;
}

export interface AgentOptionChoice {
  readonly id: string;
  readonly label: string;
}

export interface AgentModelOptionDescriptor {
  readonly id: string;
  readonly label: string;
  readonly type: "select" | "boolean";
  readonly choices?: readonly AgentOptionChoice[];
  /** Exact permitted values when published; absent for unrestricted legacy booleans. */
  readonly values?: readonly (string | boolean)[];
  readonly default?: string | boolean;
}

export interface AgentModelCapability {
  readonly id: string;
  readonly label: string | null;
  readonly options?: readonly AgentModelOptionDescriptor[];
}

/** Whether Factory can accept Block reports from this provider's harness. */
export interface AgentProviderReporting {
  readonly supported: boolean;
  readonly explanation: string;
}

export interface AgentProviderCapability {
  readonly providerInstanceId: string;
  readonly displayName: string | null;
  readonly driverKind: string;
  readonly models: readonly AgentModelCapability[];
  readonly reporting: AgentProviderReporting;
}

export interface AgentCapabilities {
  readonly state: "ready" | "unavailable";
  readonly explanation: string;
  readonly checkedAt: string | null;
  readonly environments: readonly AgentEnvironment[];
  readonly providers: readonly AgentProviderCapability[];
}

/** What every Agent create and save writes as the next revision. */
interface AgentContentInput {
  readonly name: string;
  readonly prompt: string;
  /** Required: complete settings, or null for an Agent that Needs a model. */
  readonly execution: AgentExecutionSettings | null;
  readonly exits: readonly BlockExit[];
}

/** Studio's identified Create attempts have a bounded window in which Factory can write. */
export const AGENT_CREATE_WINDOW_MS = 15_000;

export type AgentCreateOutcome =
  | { readonly status: "created"; readonly agent: AgentDefinition }
  | { readonly status: "removed" | "absent" | "unconfirmed" };

export interface CreateAgentInput extends AgentContentInput {
  /** An optional UUID followed by the write deadline in Unix milliseconds, used as the Agent id. */
  readonly requestId?: string;
  /** The owning Project's Factory id, or null (the default when omitted) for a global Agent. */
  readonly projectId?: string | null;
  /** Omitted, the new Agent has none. */
  readonly projectOverrides?: readonly AgentProjectOverride[];
}

/** A save never changes the owning Project. */
export interface UpdateAgentInput extends AgentContentInput {
  readonly expectedRevision: number;
  /** The owning Project the client last saw; a save after Change owner moved it is refused. */
  readonly expectedProjectId: string | null;
  /** Required: the complete list the save stores, empty for none, so an omission never clears one. */
  readonly projectOverrides: readonly AgentProjectOverride[];
}

export interface DuplicateAgentInput {
  readonly name?: string;
  /**
   * The copy's owning Project: a Factory Project id available for new Runs, or null for Global.
   * Omitted, the copy keeps the source's owning Project, which must then be available.
   */
  readonly projectId?: string | null;
}

/** The Agent operations the Factory facade implements. */
export const agentOperations = {
  getAgentCapabilities: operation<never, AgentCapabilities>()({
    method: "GET",
    path: "/api/agents/capabilities",
  }),
  listAgents: operation<never, readonly AgentDefinition[]>()({
    method: "GET",
    path: "/api/agents",
  }),
  createAgent: operation<CreateAgentInput, AgentDefinition>()({
    method: "POST",
    path: "/api/agents",
    body: "json",
  }),
  getAgentCreateOutcome: operation<never, AgentCreateOutcome>()({
    method: "GET",
    path: "/api/agents/:id/create-outcome",
  }),
  getAgent: operation<never, AgentDefinition>()({ method: "GET", path: "/api/agents/:id" }),
  duplicateAgent: operation<DuplicateAgentInput, AgentDefinition>()({
    method: "POST",
    path: "/api/agents/:id/duplicate",
    body: "json",
  }),
  updateAgent: operation<UpdateAgentInput, AgentDefinition>()({
    method: "PUT",
    path: "/api/agents/:id",
    body: "json",
  }),
  /** Change owner; refused while a current Flow could no longer place the Agent afterwards. */
  changeAgentOwner: operation<ChangeOwnerInput, AgentDefinition>()({
    method: "PUT",
    path: "/api/agents/:id/owner",
    body: "json",
  }),
  removeAgent: operation()({ method: "DELETE", path: "/api/agents/:id" }),
  /** The latest saved revision as a portable document. */
  exportAgent: operation<never, DefinitionExport<PortableAgentDocument>>()({
    method: "GET",
    path: "/api/agents/:id/export",
  }),
};
