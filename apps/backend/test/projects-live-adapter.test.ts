import { assert, expect, it } from "@effect/vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { LiveGitAdapter } from "../src/adapters/live-git.ts";
import { liveProjectRepositories } from "./support/boundaries-setup.ts";

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

it("a worktree default base resolves to the clone's origin default branch", async (context) => {
  // Arrange
  const { endpoint, second } = await liveProjectRepositories(context);

  // Act
  const ref = await new LiveGitAdapter().resolveBaseRef(endpoint, second, { kind: "default" });

  // Assert
  expect(ref).toBe("origin/main");
});

it("a repository without an origin default branch has no worktree default base", async (context) => {
  // Arrange
  const { endpoint, first } = await liveProjectRepositories(context);

  // Act
  const ref = await new LiveGitAdapter().resolveBaseRef(endpoint, first, { kind: "default" });

  // Assert
  expect(ref).toBeNull();
});

it("a custom worktree ref that names no commit does not resolve", async (context) => {
  // Arrange
  const { endpoint, second } = await liveProjectRepositories(context);

  // Act
  const ref = await new LiveGitAdapter().resolveBaseRef(endpoint, second, {
    kind: "ref",
    ref: "release/missing",
  });

  // Assert
  expect(ref).toBeNull();
});

it("same-host Git refuses a repository when T3 is not on this computer", async () => {
  // Arrange
  const git = new LiveGitAdapter();

  // Act
  const resolved = git.resolveRepository("https://t3.example.invalid/mcp", tmpdir());

  // Assert
  await expect(resolved).rejects.toThrow("Existing local repository required.");
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
