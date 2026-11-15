/** Agents: reusable definitions of how an Agent block's work runs, and their operations. */
import type { BlockExit } from "./flow.ts";
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
 * One saved Agent revision. `execution` is complete or null, never partial: an Agent without
 * execution settings Needs a model and cannot run.
 */
export interface SavedAgent {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly revision: number;
  readonly execution: AgentExecutionSettings | null;
  /** Inherited live by every Flow block of this Agent; a Run keeps the revision it captured. */
  readonly exits: readonly BlockExit[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `settingsStatus` judges saved execution settings, so it is null exactly when they are. */
export type AgentDefinition = SavedAgent &
  (
    | {
        readonly execution: AgentExecutionSettings;
        readonly settingsStatus: AgentExecutionSettingsStatus;
      }
    | { readonly execution: null; readonly settingsStatus: null }
  );

/** An Agent revision a Run captured; Start accepts only Agents with execution settings. */
export interface CapturedAgent extends SavedAgent {
  readonly execution: AgentExecutionSettings;
}

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

export interface CreateAgentInput {
  readonly name: string;
  readonly prompt: string;
  /** Required: complete settings, or null for an Agent that Needs a model. */
  readonly execution: AgentExecutionSettings | null;
  readonly exits: readonly BlockExit[];
}

export interface UpdateAgentInput extends CreateAgentInput {
  readonly expectedRevision: number;
}

export interface DuplicateAgentInput {
  readonly name?: string;
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
  removeAgent: operation()({ method: "DELETE", path: "/api/agents/:id" }),
  /** The latest saved revision as a portable document. */
  exportAgent: operation<never, DefinitionExport<PortableAgentDocument>>()({
    method: "GET",
    path: "/api/agents/:id/export",
  }),
};
