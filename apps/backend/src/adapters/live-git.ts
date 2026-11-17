import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { FlowWorkspaceBase } from "@t3-factory/contracts";
import { isLocalEndpoint } from "../endpoint-local.ts";
import type { GitAdapter } from "./git.ts";

const localRepositoryRequired = (endpoint: string, path: string) => {
  if (!isLocalEndpoint(endpoint) || !isAbsolute(path))
    throw new Error("Existing local repository required.");
};

/** The host's `git`, run with a bounded time per call. */
export class LiveGitAdapter implements GitAdapter {
  async resolveRepository(endpoint: string, path: string): Promise<string> {
    localRepositoryRequired(endpoint, path);
    const canonical = await realpath(path);
    const git = promisify(execFile);
    const bare = await git("git", ["-C", canonical, "rev-parse", "--is-bare-repository"], {
      timeout: 10_000,
    });
    if (bare.stdout.trim() !== "false") throw new Error("Existing checkout required.");
    const result = await git(
      "git",
      ["-c", "core.quotePath=false", "-C", canonical, "worktree", "list", "--porcelain"],
      { timeout: 10_000, maxBuffer: 1_048_576 },
    );
    const root = result.stdout.split("\n")[0];
    if (!root?.startsWith("worktree ")) throw new Error("Existing worktree required.");
    // An execution worktree belongs to its source project, rather than becoming another project.
    return realpath(root.slice(9));
  }
  async resolveBaseRef(
    endpoint: string,
    workspaceRoot: string,
    base: FlowWorkspaceBase,
  ): Promise<string | null> {
    localRepositoryRequired(endpoint, workspaceRoot);
    // Exit status 1 is Git's answer for an absent ref; any other failure is not an answer.
    const git = (args: string[]) =>
      promisify(execFile)("git", ["-C", workspaceRoot, ...args], { timeout: 10_000 }).then(
        (result) => result.stdout.trim(),
        (error: { code?: unknown }) => {
          if (error.code === 1) return null;
          throw error;
        },
      );
    const ref =
      base.kind === "ref"
        ? base.ref
        : await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (!ref) return null;
    const commit = await git([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
    return commit ? ref : null;
  }
}
