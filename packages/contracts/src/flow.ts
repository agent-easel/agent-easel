import { operation } from "./operation.ts";
import type { DefinitionExport, PortableFlowDocument } from "./portable-document.ts";
import type { ValidationIssue } from "./result.ts";

/** Flows: the graphs of Blocks that Runs execute. */
/** A named result a Block finishes with. Wires leave by `id`, so renaming keeps them. */
export interface BlockExit {
  readonly id: string;
  readonly name: string;
  /** Empty when the exit has no description. */
  readonly description: string;
  /** Finishing on this exit needs a non-empty message. */
  readonly messageRequired: boolean;
}

export interface CreateFlowInput {
  readonly name: string;
  readonly graph?: FlowGraphInput;
  readonly workspace?: FlowWorkspace;
  /** The owning Project's Factory id, or null (the default when omitted) for a global Flow. */
  readonly projectId?: string | null;
}

interface BlockBase {
  readonly id: string;
  readonly name: string;
  readonly position: { readonly x: number; readonly y: number };
}
/** The units a Wait duration is entered in. */
export type WaitUnit = "minutes" | "hours" | "days";
/** A fixed relative delay of any finite amount; readiness requires 1 minute to 7 days inclusive
 * after converting the unit, so 1.5 hours is ready. */
export interface WaitDuration {
  readonly amount: number;
  readonly unit: WaitUnit;
}
/** The largest arrival number a Condition rule may name: the largest exactly representable
 * integer, so a saved threshold is never rounded. */
export const CONDITION_ARRIVAL_MAX = Number.MAX_SAFE_INTEGER;
/** The fixed id of a Condition's last output, selected when no rule matches. */
export const CONDITION_OTHERWISE_ID = "otherwise";
/** One ordered Condition rule: from arrival `fromArrival` onward, select this rule's output, whose
 * wires leave by the rule's `id`, so renaming or reordering the rule keeps them. */
export interface ConditionRule {
  readonly id: string;
  /** Stored trimmed; blank only in a draft, where readiness reports it. */
  readonly name: string;
  /** A whole number from 1 to `CONDITION_ARRIVAL_MAX`; null while the draft has none. */
  readonly fromArrival: number | null;
}
/**
 * An Agent block exposes its Agent's exits, minus those this Flow hides, plus its Flow-local
 * exits and may carry a Revisit instruction. A Human block has the fixed Approve and Request
 * changes exits. A Wait block has one unnamed output; `duration` is null while the draft has none.
 * A Continuation sends its prompt once per Run into the worker thread of the message that reaches
 * it and has one fixed, unnamed output. A Condition routes each arrival by its arrival number: the
 * first matching rule selects that rule's output, else the fixed last Otherwise output.
 */
export type FlowBlock = BlockBase &
  (
    | {
        readonly kind: "agent";
        readonly agentId: string | null;
        /** Inherited Agent exit IDs hidden in this Flow; IDs the Agent no longer has are ignored. */
        readonly hiddenExitIds: readonly string[];
        /** Exits only this Flow adds to the block. */
        readonly localExits: readonly BlockExit[];
        /** Sent on every visit to this block after the first; stored trimmed, empty when unset. */
        readonly revisitInstruction: string;
      }
    | { readonly kind: "human" }
    | { readonly kind: "wait"; readonly duration: WaitDuration | null }
    | {
        readonly kind: "continuation";
        /** Stored trimmed; empty only in a draft, where readiness reports it. */
        readonly prompt: string;
      }
    | {
        readonly kind: "condition";
        /** Checked in order; the first rule whose threshold the arrival number reaches selects. */
        readonly rules: readonly ConditionRule[];
        /** Always present and always last; it cannot be renamed, removed or reordered. */
        readonly otherwise: { readonly id: typeof CONDITION_OTHERWISE_ID };
      }
  );
export interface FlowConnection {
  readonly sourceBlockId: string;
  readonly exitId: string;
  readonly targetBlockId: string;
}
/** The single, always-present source of a Flow; its targets start a Run in parallel. */
export interface FlowInputBlock {
  readonly position: { readonly x: number; readonly y: number };
  /** Agent blocks that each receive the Flow input in their own session at Start. A Wait target
   * saves but is a readiness gap. */
  readonly targetBlockIds: readonly string[];
}
export interface FlowGraph {
  readonly blocks: readonly FlowBlock[];
  readonly connections: readonly FlowConnection[];
  readonly flowInput: FlowInputBlock;
}
type OptionalPosition<B extends { readonly position: FlowBlock["position"] }> = B extends unknown
  ? Omit<B, "position"> & { readonly position?: B["position"] }
  : never;
/** An omitted Revisit instruction saves empty. */
type OptionalRevisitInstruction<B> = B extends { readonly kind: "agent" }
  ? Omit<B, "revisitInstruction"> & { readonly revisitInstruction?: string }
  : B;
export type FlowBlockInput = OptionalRevisitInstruction<OptionalPosition<FlowBlock>>;
/** Save/create input only: if any position is omitted, the server arranges the whole graph. */
export interface FlowGraphInput {
  readonly blocks: readonly FlowBlockInput[];
  readonly connections: readonly FlowConnection[];
  readonly flowInput: OptionalPosition<FlowInputBlock>;
}
/** Where a new worktree starts: the Project repository's default branch or a named Git ref. */
export type FlowWorkspaceBase =
  | { readonly kind: "default" }
  | { readonly kind: "ref"; readonly ref: string };
/** The workspace every worker of a Run shares; saved on the Flow, outside its graph. */
export type FlowWorkspace =
  | { readonly mode: "checkout" }
  | { readonly mode: "worktree"; readonly base: FlowWorkspaceBase };
/** A save never changes the owning Project. */
export interface UpdateFlowInput {
  readonly name: string;
  readonly expectedRevision: number;
  /** The owning Project the client last saw; a save after Change owner moved it is refused. */
  readonly expectedProjectId: string | null;
  readonly graph: FlowGraphInput;
  /** Protocol 1–3 clients cannot see it and omit it; such a save keeps the saved setting. */
  readonly workspace?: FlowWorkspace;
}

export interface FlowReadiness {
  readonly ready: boolean;
  readonly issues: readonly ValidationIssue[];
}

/**
 * The saved revision and owning Project of each Agent a graph places, by Agent id; null for one
 * that does not exist. An owner change appends no revision, so both decide readiness.
 */
export type FlowAgentRevisions = Readonly<
  Record<string, { readonly revision: number; readonly projectId: string | null } | null>
>;

/** Readiness of submitted Flow content and the saved Agents it was resolved against. */
export interface FlowValidation extends FlowReadiness {
  readonly agentRevisions: FlowAgentRevisions;
}

export interface FlowDraft {
  readonly id: string;
  /**
   * The owning Project's Factory id, or null for a global Flow. It belongs to the Flow identity,
   * not to its revisions, so a Run's captured Flow carries none.
   */
  readonly projectId: string | null;
  readonly name: string;
  readonly revision: number;
  readonly graph: FlowGraph;
  readonly workspace: FlowWorkspace;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readiness: FlowReadiness;
}

/**
 * Change owner of a Flow or Agent: moves it to `projectId` (null for global) only while its
 * owning Project is still `expectedProjectId`. It appends no revision and changes nothing else.
 */
export interface ChangeOwnerInput {
  readonly expectedProjectId: string | null;
  readonly projectId: string | null;
}

/** What Flow Duplicate does with one Agent the source Flow places. */
export type FlowDuplicateChoice =
  /** The copy places the same Agent. */
  | "keep"
  /** The copy places a new Agent created in the target from this Agent's latest saved revision. */
  | "copy";

/** One distinct Agent the source Flow places, as a Flow Duplicate plan lists it. */
export interface FlowDuplicatePlanAgent {
  readonly agentId: string;
  readonly name: string;
  /** The Agent's owning Project, or null for a global Agent. */
  readonly projectId: string | null;
  readonly revision: number;
  /** The default: keep for an Agent the target may place, copy for one it may not. */
  readonly choice: FlowDuplicateChoice;
  /**
   * Only a global Agent may switch between keep and copy. A Project Agent the target may not place
   * is always copied, and an Agent of the target Project itself is always kept.
   */
  readonly changeable: boolean;
}

/**
 * What Flow Duplicate would create, computed without writing anything: one entry per distinct
 * existing Agent the source's latest revision places, in the order its blocks first place them.
 * A block whose Agent is unset, missing or removed is copied unchanged and not listed.
 */
export interface FlowDuplicatePlan {
  readonly flowId: string;
  /** The source revision the plan copies; Duplicate names it as `expectedRevision`. */
  readonly revision: number;
  /** The resolved target: a Factory Project id or null for Global. */
  readonly projectId: string | null;
  /** The new Flow's default name. */
  readonly name: string;
  readonly agents: readonly FlowDuplicatePlanAgent[];
}

export interface PreviewFlowDuplicateInput {
  /** The target: a Factory Project id or null for Global; omitted, the source's owning Project. */
  readonly projectId?: string | null;
}

/** One planned Agent as the plan listed it, with the chosen treatment. */
export type FlowDuplicateAgentChoice = Pick<
  FlowDuplicatePlanAgent,
  "agentId" | "revision" | "projectId" | "choice"
>;

export interface DuplicateFlowInput {
  /** The new Flow's name; omitted, the plan's default name. */
  readonly name?: string;
  /**
   * The target: a Factory Project id available for new Runs, or null for Global. Omitted, the
   * source's owning Project, which must then be available.
   */
  readonly projectId?: string | null;
  /** The source revision the plan was prepared from. */
  readonly expectedRevision: number;
  /** Every planned Agent with its choice; a plan whose Flow or Agents changed since is refused. */
  readonly agents: readonly FlowDuplicateAgentChoice[];
}

/** The new Flow and the Agents created for it, by the source Agent each copies. */
export interface FlowDuplicate {
  readonly flow: FlowDraft;
  readonly copies: readonly { readonly sourceAgentId: string; readonly agentId: string }[];
}

/** The Flow operations the Factory facade implements. */
export const flowOperations = {
  listFlows: operation<never, readonly FlowDraft[]>()({ method: "GET", path: "/api/flows" }),
  createFlow: operation<CreateFlowInput, FlowDraft>()({
    method: "POST",
    path: "/api/flows",
    body: "json",
  }),
  /** Readiness of unsaved content for this Flow, placed under its owning Project. */
  validateFlow: operation<UpdateFlowInput, FlowValidation>()({
    method: "POST",
    path: "/api/flows/:id/validate",
    body: "json",
  }),
  getFlow: operation<never, FlowDraft>()({ method: "GET", path: "/api/flows/:id" }),
  removeFlow: operation()({ method: "DELETE", path: "/api/flows/:id" }),
  updateFlow: operation<UpdateFlowInput, FlowDraft>()({
    method: "PUT",
    path: "/api/flows/:id",
    body: "json",
  }),
  /** Change owner; refused while any Agent the Flow places could not be placed afterwards. */
  changeFlowOwner: operation<ChangeOwnerInput, FlowDraft>()({
    method: "PUT",
    path: "/api/flows/:id/owner",
    body: "json",
  }),
  /** The Flow Duplicate plan for a target, writing nothing. */
  previewFlowDuplicate: operation<PreviewFlowDuplicateInput, FlowDuplicatePlan>()({
    method: "POST",
    path: "/api/flows/:id/duplicate/preview",
    body: "json",
  }),
  /** Commits a previewed plan in one transaction; the source Flow and its Agents never change. */
  duplicateFlow: operation<DuplicateFlowInput, FlowDuplicate>()({
    method: "POST",
    path: "/api/flows/:id/duplicate",
    body: "json",
  }),
  /** The latest saved revision with each Agent it references as a portable document. */
  exportFlow: operation<never, DefinitionExport<PortableFlowDocument>>()({
    method: "GET",
    path: "/api/flows/:id/export",
  }),
};
