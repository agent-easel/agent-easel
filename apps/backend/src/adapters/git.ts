import type { FlowWorkspaceBase } from "@agent-easel/contracts";

/**
 * Same-host Git on the Factory host. Each call names the T3 endpoint its repository belongs to;
 * a repository is read only when that endpoint is on this computer.
 */
export interface GitAdapter {
  /** The canonical root of the checkout at `path`; an execution worktree resolves to its source. */
  resolveRepository(endpoint: string, path: string): Promise<string>;
  /** The ref a new worktree starts from, or null when the repository lacks it. */
  resolveBaseRef(
    endpoint: string,
    workspaceRoot: string,
    base: FlowWorkspaceBase,
  ): Promise<string | null>;
}
