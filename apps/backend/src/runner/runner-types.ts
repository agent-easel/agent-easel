import type * as Effect from "effect/Effect";
import type {
  CapturedAgent,
  HumanOccurrence,
  Result,
  RunBlock,
  RunDetail,
  RunDefinitions,
  RunTitleProvenance,
  RuntimeReadiness,
} from "@t3-factory/contracts";
import type { T3ContractSnapshot } from "../t3/contract.ts";
import type { T3Target } from "../t3/connection.ts";
import type { RunWorkspace } from "./run-workspace.ts";

/** A Run's row with the definitions it captured at Start. */
export type RunRow = {
  id: string;
  task_id: string;
  task_title: string;
  project_id: string;
  title: string;
  title_provenance: RunTitleProvenance;
  input: string;
  request_fingerprint: string;
  flow_revision_id: string;
  definitions: RunDefinitions;
  context_id: string;
  /** The project root: the Run's T3 project identity, also for worktree Runs. */
  workspace_root: string;
  workspace: RunWorkspace;
  gate_open: number;
  generation: number;
  number: number;
  started_at: string;
  settled_at: string | null;
  archived_at: string | null;
  endpoint: string;
  environment_id: string;
  t3_project_id: string;
};

export type BlockRow = {
  run_id: string;
  block_id: string;
  /** The Block id Agents name in Factory MCP calls; null for Human steps. */
  public_id: string | null;
  name: string;
  state: RunBlock["state"];
  thread_id: string | null;
  execution_id: string | null;
  link: string | null;
  engine_status: string | null;
  report_status: RunBlock["reportStatus"];
  problem: string | null;
  pending_request_count: number | null;
  observed_at: string | null;
  freshness: RunBlock["freshness"];
};

export type ExecutionRow = {
  binding_id: string;
  activation_id: string | null;
  block_id: string;
  execution_id: string;
  engine_status: string | null;
  report_status: "waiting" | "working" | "finished" | null;
  working_reported: number;
  observed_at: string | null;
  ordinal: number | null;
  problem: string | null;
  native_request_count: number | null;
  first_work_at: string | null;
  end_work_at: string | null;
};

export type HumanRow = {
  id: string;
  run_id: string;
  block_id: string;
  incoming_intent_id: string;
  state: HumanOccurrence["state"];
  pending_context: string | null;
  appeared_at: string;
  settled_at: string | null;
  exit_id: string | null;
  answer_fingerprint: string | null;
  answer_request_id: string | null;
};

export type TaskRunRow = {
  id: string;
  input: string;
  started_at: string;
  settled_at: string | null;
  archived_at: string | null;
  flow_id: string;
  flow_name: string;
};

export type TaskRow = { id: string; title: string; project_id: string; created_at: string };

export type ReportRunRow = Pick<
  RunRow,
  | "id"
  | "endpoint"
  | "environment_id"
  | "t3_project_id"
  | "workspace_root"
  | "gate_open"
  | "archived_at"
  | "settled_at"
  | "context_id"
  | "definitions"
> & { token: string };

/** Convert the accepted, persisted Run context without reading current connection settings. */
export function runTarget(
  runRow: Pick<RunRow, "endpoint" | "environment_id" | "t3_project_id" | "workspace_root">,
): T3Target {
  return {
    endpoint: runRow.endpoint,
    environmentId: runRow.environment_id,
    projectId: runRow.t3_project_id,
    workspaceRoot: runRow.workspace_root,
  };
}

export type StoredTarget = T3Target & {
  threadId?: string;
};

/** A dispatch precondition either holds with its value or names the operation's problem. */
export type Checked<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly problem: string };

export type RunnerDrive = (
  id: string,
  phase?: "observe" | "dispatch" | "both",
) => Effect.Effect<void, unknown>;
export interface RunnerLifecycle {
  isClosed(): boolean;
  drive: RunnerDrive;
  /** Runs `action` in the Run's drive lane, serialized with its observe and dispatch passes. */
  serial<A, E>(id: string, action: () => Effect.Effect<A, E>): Effect.Effect<A, E>;
  fork: (effect: Effect.Effect<unknown, unknown>) => Effect.Effect<void>;
  getRun(id: string): Effect.Effect<Result<RunDetail>, unknown>;
}
export interface RunnerOptions {
  /** `snapshot` is the T3 contract snapshot of the pass that checks. */
  checkAgent: (
    projectId: string,
    agent: CapturedAgent,
    snapshot: T3ContractSnapshot,
  ) => Effect.Effect<Result<RuntimeReadiness>, unknown>;
}
