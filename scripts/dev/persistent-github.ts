import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitHubRepository } from "../../apps/backend/src/adapters/github.ts";
import {
  ControlledGitHub,
  type ControlledIssue,
} from "../../apps/backend/test/support/controlled-github.ts";
import { writeState } from "./write-state.ts";

interface SavedGitHub {
  version: 1;
  login: string;
  repositories: [string, GitHubRepository][];
  issues: ControlledIssue[];
}

/**
 * The demo's GitHub and host `gh` login: the controlled stand-in, with its repositories and issues
 * saved in the demo home so a restarted demo's scheduled checks see the GitHub they saw before.
 */
export class PersistentGitHub extends ControlledGitHub {
  private readonly statePath: string;

  constructor(home: string, restore: boolean) {
    super();
    this.statePath = join(home, "demo-github.json");
    if (restore) this.restore();
  }

  private restore() {
    try {
      const saved = JSON.parse(readFileSync(this.statePath, "utf8")) as SavedGitHub;
      if (saved.version !== 1) throw new Error("Unsupported demo GitHub state.");
      this.login = saved.login;
      for (const [folder, repository] of saved.repositories)
        this.repositories.set(folder, repository);
      this.issues.push(...saved.issues);
    } catch (cause) {
      throw new Error(
        "Demo GitHub state is missing, damaged or incompatible. Run pnpm db:reset to restore scenarios.",
        { cause },
      );
    }
  }

  save() {
    writeState(this.statePath, {
      version: 1,
      login: this.login,
      repositories: [...this.repositories],
      issues: this.issues,
    } satisfies SavedGitHub);
  }
}
