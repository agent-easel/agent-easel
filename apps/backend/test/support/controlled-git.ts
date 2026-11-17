import type { FlowWorkspaceBase } from "@t3-factory/contracts";
import type { GitAdapter } from "../../src/adapters/git.ts";

/** Same-host Git without the host's `git`: every path is its own repository root. */
export class ControlledGit implements GitAdapter {
  defaultBranch: string | null = "origin/main";
  readonly refs = new Set(["origin/main"]);
  async resolveRepository(_endpoint: string, path: string) {
    return path;
  }
  async resolveBaseRef(_endpoint: string, _workspaceRoot: string, base: FlowWorkspaceBase) {
    if (base.kind === "default") return this.defaultBranch;
    return this.refs.has(base.ref) ? base.ref : null;
  }
}
