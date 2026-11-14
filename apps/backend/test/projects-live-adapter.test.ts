import { assert, expect, it } from "@effect/vitest";
import { rm } from "node:fs/promises";
import { liveProjectRepositories, staleProjectRepository } from "./support/boundaries-setup.ts";
import { prepared } from "./support/prepared-runner.ts";

it("a repository symlink resolves to the existing project", async (context) => {
  // Arrange
  const { factory, alias, p } = await liveProjectRepositories(context);

  // Act
  const result = await factory.addRepository({ path: alias });

  // Assert
  assert(result.ok);
  expect(result.value.id).toBe(p.id);
});

it("an execution worktree resolves to its source project", async (context) => {
  // Arrange
  const { factory, worktree, p } = await liveProjectRepositories(context);

  // Act
  const result = await factory.addRepository({ path: worktree });

  // Assert
  assert(result.ok);
  expect(result.value.id).toBe(p.id);
});

it("a directory without a repository is rejected", async (context) => {
  // Arrange
  const { factory, root } = await liveProjectRepositories(context);

  // Act
  const result = await factory.addRepository({ path: root });

  // Assert
  assert(!result.ok);
});

it("a deleted repository clone loses project readiness", async (context) => {
  // Arrange
  const { factory, second } = await liveProjectRepositories(context);
  const clone = await factory.addRepository({ path: second });
  assert(clone.ok);
  await rm(second, { recursive: true });

  // Act
  const result = await factory.getProjectReadiness(clone.value.id);

  // Assert
  assert(result.ok);
  expect(result.value.ready).toBe(false);
});

it("a worktree default base refreshes origin while leaving the local default branch unchanged", async (context) => {
  // Arrange
  const { adapter, second, originalCommit, currentCommit, readRef } =
    await staleProjectRepository(context);

  // Act
  const ref = await adapter.resolveBaseRef(second, { kind: "default" });

  // Assert
  expect(ref).toBe("origin/main");
  expect(await readRef("origin/main")).toBe(currentCommit);
  expect(await readRef("main")).toBe(originalCommit);
});

it("an unreachable origin rejects Start without creating a Run, Task or worker from a stale default base", async (context) => {
  // Arrange
  const { adapter, first, second } = await staleProjectRepository(context);
  const { f, t3, input } = await prepared(context, {
    workspace: { mode: "worktree", base: { kind: "default" } },
  });
  t3.resolveBaseRef = (_workspaceRoot, base) => adapter.resolveBaseRef(second, base);
  await rm(first, { recursive: true });

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toMatchObject([
    { code: "workspace_ref_unreadable", path: "workspace.base" },
  ]);
  expect(await f.listRuns(input.projectId)).toStrictEqual({ ok: true, value: [] });
  expect(await f.listTasks(input.projectId)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});

it("a custom local worktree base remains usable without contacting origin", async (context) => {
  // Arrange
  const { adapter, first, second, originalCommit, readRef } = await staleProjectRepository(context);
  await rm(first, { recursive: true });

  // Act
  const ref = await adapter.resolveBaseRef(second, { kind: "ref", ref: "main" });

  // Assert
  expect(ref).toBe("main");
  expect(await readRef("main")).toBe(originalCommit);
});

it("a repository without an origin default branch has no worktree default base", async (context) => {
  // Arrange
  const { adapter, first } = await liveProjectRepositories(context);

  // Act
  const ref = await adapter.resolveBaseRef(first, { kind: "default" });

  // Assert
  expect(ref).toBeNull();
});

it("a custom worktree ref that names no commit does not resolve", async (context) => {
  // Arrange
  const { adapter, second } = await liveProjectRepositories(context);

  // Act
  const ref = await adapter.resolveBaseRef(second, { kind: "ref", ref: "release/missing" });

  // Assert
  expect(ref).toBeNull();
});

it("project recheck preserves distinct projects across live SDK pages", async (context) => {
  // Arrange
  const { factory, second } = await liveProjectRepositories(context);
  const clone = await factory.addRepository({ path: second });
  assert(clone.ok);

  // Act
  const result = await factory.recheckProjects();

  // Assert
  assert(result.ok);
  expect(result.value.projects.length).toBe(2);
});
