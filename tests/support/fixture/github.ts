import type { GitHubFailure, GitHubRepository } from "../../../apps/backend/src/adapters/github.ts";
import { ControlledGitHub } from "../../../apps/backend/test/support/controlled-github.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

type GitHubCall = "readiness" | "repository" | "openIssues" | "labelStates";

const baselineLogin = "factory-maintainer";
const baselineRepository = "factory-demo/atlas";

/** Triggers reach this controlled GitHub and host `gh` login instead of the real `gh`. */
export function startJourneyGitHub() {
  return new ControlledGitHub();
}

const repositoryNamed = (nameWithOwner: string, visibility: GitHubRepository["visibility"]) => ({
  host: "github.com",
  nameWithOwner,
  nodeId: `R_${nameWithOwner}`,
  visibility,
});

/**
 * GitHub as the seeded Project's repository and the host's `gh` login see it: the host login,
 * the Project's repository, its open issues and labels, and failures of any `gh` read.
 */
export function githubFixture(github: ControlledGitHub, { factory, world }: Host) {
  const projectFolder = world.project.workspaceRoot;
  /** The Project's repository, which every issue added by a journey belongs to. */
  const projectRepository = () => github.repositories.get(projectFolder)!;
  function restore() {
    github.found = true;
    github.signedIn = true;
    github.login = baselineLogin;
    github.repositories.clear();
    github.repositories.set(projectFolder, repositoryNamed(baselineRepository, "private"));
    github.issues.length = 0;
    github.failures.clear();
  }
  restore();
  let labellings = 0;
  return {
    actions: {
      /** The host login, the Project's repository and the issues GitHub holds. */
      state: () => ({
        found: github.found,
        signedIn: github.signedIn,
        login: github.login,
        repository: projectRepository(),
        issues: github.issues.map(({ number, title, labels, open }) => ({
          number,
          title,
          labels,
          open,
        })),
      }),
      /** `gh` on the Factory host: whether it is found and signed in, and as whom. */
      host({ found, signedIn, login }: { found?: boolean; signedIn?: boolean; login?: string }) {
        if (found !== undefined) github.found = found;
        if (signedIn !== undefined) github.signedIn = signedIn;
        if (login !== undefined) github.login = login;
      },
      /** The seeded Project's remote names this repository from now on. */
      repository({
        nameWithOwner,
        visibility = "private",
      }: {
        nameWithOwner: string;
        visibility?: GitHubRepository["visibility"];
      }) {
        const repository = repositoryNamed(nameWithOwner, visibility);
        github.repositories.set(projectFolder, repository);
        return repository;
      },
      /** Someone opens issue `number` in the Project's repository; each label gets a `labeled` event. */
      issue({ number, title, labels = [] }: { number: number; title: string; labels?: string[] }) {
        const repository = projectRepository();
        const createdAt = new Date(Date.UTC(2026, 10, 1, 9, number)).toISOString();
        github.issues.push({
          nodeId: `I_${repository.nameWithOwner}#${number}`,
          repositoryNodeId: repository.nodeId,
          number,
          title,
          url: `https://github.com/${repository.nameWithOwner}/issues/${number}`,
          createdAt,
          open: true,
          matchesQuery: true,
          labels: [...labels],
          labellings: labels.map((label) => {
            labellings += 1;
            return { label, eventId: `LE_${labellings}`, createdAt };
          }),
        });
      },
      /** The named `gh` read fails with `failure` until `recover` clears it. */
      fail({ call, failure }: { call: GitHubCall; failure: GitHubFailure }) {
        github.failures.set(call, failure);
      },
      /** The named read, or every read, answers normally again. */
      recover({ call }: { call?: GitHubCall } = {}) {
        if (call) github.failures.delete(call);
        else github.failures.clear();
      },
    },
    /** The baseline GitHub world, and no Triggers left from an earlier journey. */
    async reset() {
      restore();
      for (const trigger of requireSuccess(await factory.listTriggers()))
        requireSuccess(await factory.removeTrigger(trigger.id));
    },
  };
}
