import { assert, expect, it } from "@effect/vitest";
import { gitHubRepairGuidance } from "../src/adapters/github.ts";
import {
  cursorlessSearchPage,
  emptySearchPage,
  fakeGh,
  fakeRepository,
  pageInfolessLabelStates,
} from "./support/fake-gh.ts";

it("gh on the inherited PATH is used before the fallback directories", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const path = await gh.directory("path", { stdout: '{"login":"path-login"}' });
  const fallback = await gh.directory("fallback", { stdout: '{"login":"fallback-login"}' });
  const adapter = gh.adapter([path], { fallbackDirectories: [fallback] });

  // Act
  const readiness = await adapter.readiness("github.com");

  // Assert
  assert(readiness.ok);
  expect(readiness.value.login).toBe("path-login");
});

it("gh missing from the inherited PATH is found in a fallback directory", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const fallback = await gh.directory("fallback", { stdout: '{"login":"fallback-login"}' });
  const adapter = gh.adapter(["/nonexistent/bin"], {
    fallbackDirectories: ["/nonexistent", fallback],
  });

  // Act
  const readiness = await adapter.readiness("github.com");

  // Assert
  assert(readiness.ok);
  expect(readiness.value.login).toBe("fallback-login");
});

it("a host without gh reports it missing with the steps to take on the host", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter(["/nonexistent/bin"], { fallbackDirectories: ["/nonexistent"] });

  // Act
  const readiness = await adapter.readiness("github.com");

  // Assert
  assert(!readiness.ok);
  expect(readiness.failure).toStrictEqual({ reason: "gh_missing" });
  expect(gitHubRepairGuidance(readiness.failure)).toContain(
    "Install GitHub CLI (gh) on the Factory host",
  );
  expect(gitHubRepairGuidance(readiness.failure)).toContain("restart a Factory opened from Finder");
});

it("an issue query reaches gh unchanged as one argument", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter([await gh.directory("path", { stdout: emptySearchPage() })]);
  const query = `label:"factory:ready" author:@me $(touch pwned); echo 'x'`;

  // Act
  const issues = await adapter.openIssues(fakeRepository, query);

  // Assert
  assert(issues.ok);
  expect(issues.value).toStrictEqual([]);
  expect(await gh.lastArguments()).toContain(`q=repo:octo/atlas is:issue is:open ${query}`);
});

it("a gh answer beyond the output bound fails as truncated, not as an empty list", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const path = await gh.directory("path", { stdout: emptySearchPage().padEnd(4096) });
  const adapter = gh.adapter([path], { outputLimitBytes: 1024 });

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure).toStrictEqual({ reason: "truncated" });
});

it("a search page that claims more issues without a cursor fails the read, not as a partial list", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter([await gh.directory("path", { stdout: cursorlessSearchPage() })]);

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure).toStrictEqual({
    reason: "failed",
    message: "GitHub said more issues match but gave no cursor to read them.",
  });
});

it("label states whose labeled events come without page info fail the read, not as never labelled", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter([await gh.directory("path", { stdout: pageInfolessLabelStates() })]);

  // Act
  const states = await adapter.labelStates(fakeRepository, ["I_1"], "factory:ready");

  // Assert
  assert(!states.ok);
  expect(states.failure.reason).toBe("failed");
});

it("a gh that does not answer in time fails as a timeout", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const path = await gh.directory("path", { script: "exec /bin/sleep 5" });
  const adapter = gh.adapter([path], { timeoutMs: 200 });

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure).toStrictEqual({ reason: "timeout" });
});

it("a non-zero gh exit fails the read, not as an empty list", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const path = await gh.directory("path", {
    stderr: "error connecting to api.github.com\n",
    exit: 1,
  });
  const adapter = gh.adapter([path]);

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure).toStrictEqual({
    reason: "failed",
    message: "error connecting to api.github.com",
  });
});

it("invalid JSON from gh fails the read, not as an empty list", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter([await gh.directory("path", { stdout: "[] and more" })]);

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure.reason).toBe("failed");
});

it("a gh without a login reports the host as signed out", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const path = await gh.directory("path", {
    stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
    exit: 4,
  });
  const adapter = gh.adapter([path]);

  // Act
  const readiness = await adapter.readiness("github.example.com");

  // Assert
  assert(!readiness.ok);
  expect(readiness.failure).toStrictEqual({ reason: "signed_out", host: "github.example.com" });
});

it("a repository name that now names another repository is reported as a mismatch", async (context) => {
  // Arrange
  const gh = await fakeGh(context);
  const adapter = gh.adapter([await gh.directory("path", { stdout: emptySearchPage("R_other") })]);

  // Act
  const issues = await adapter.openIssues(fakeRepository, "label:factory:ready");

  // Assert
  assert(!issues.ok);
  expect(issues.failure).toStrictEqual({
    reason: "repository_mismatch",
    nameWithOwner: "octo/atlas",
  });
});
