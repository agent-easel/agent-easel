import { assert, type TestContext } from "@effect/vitest";
import type { CreateTriggerInput } from "@t3-factory/contracts";
import type { GitHubRepository } from "../../src/adapters/github.ts";
import type { Factory } from "../../src/index.ts";
import { prepared } from "./prepared-runner.ts";

/** The repository the prepared Project's folder names on GitHub. */
export const atlasRepository: GitHubRepository = {
  host: "github.com",
  nameWithOwner: "factory-maintainer/atlas",
  nodeId: "R_atlas",
  visibility: "private",
};

/**
 * The prepared Project and ready Flow, with the Project's folder naming `repository` on GitHub,
 * and the least a client sends to create a GitHub Issues Trigger for them.
 */
export async function triggerWorld(c: TestContext, repository = atlasRepository) {
  const fixture = await prepared(c);
  fixture.github.repositories.set(fixture.project.workspaceRoot, repository);
  const triggerInput = {
    kind: "github_issues",
    name: "Ready issues",
    projectId: fixture.project.id,
    flowId: fixture.flow.id,
    github: { repositoryNodeId: repository.nodeId },
  } satisfies CreateTriggerInput;
  return { ...fixture, triggerInput };
}

/** The prepared Project as T3 lists it once the connection points at a remote T3. */
export async function remoteProject(f: Factory) {
  assert((await f.configureConnection({ endpoint: "https://t3.example/mcp" })).ok);
  const catalog = await f.recheckProjects();
  assert(catalog.ok);
  const project = catalog.value.projects.find(
    (entry) => entry.endpoint === "https://t3.example/mcp",
  );
  assert(project);
  return project;
}
