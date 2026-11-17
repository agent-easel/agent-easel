import { assert, expect, it } from "@effect/vitest";
import { runtimeReadinessFixture } from "./support/boundaries-setup.ts";
import { claudeRuntimeConfig } from "./support/boundaries-setup.ts";
import { changeReportSupportAtCapabilityRead } from "./support/controlled-t3.ts";
import { readdir } from "node:fs/promises";

it("missing user installation blocks readiness without launching setup work", async (c) => {
  // Arrange
  const { f, t3, root, selection } = await runtimeReadinessFixture(c);

  // Act
  const readiness = await f.recheckRuntime(selection);

  // Assert
  assert(readiness.ok);
  expect(readiness.value.ready).toBe(false);
  assert(readiness.value.issues.some((issue) => issue.code === "reporting_installation"));
  expect(await readdir(root)).toStrictEqual([".git"]);
  expect(t3.launches.size).toBe(0);
  expect(t3.sends.size).toBe(0);
  expect(t3.authorizationStarts).toBe(0);
});

it("recheckRuntime reports reporting_unsupported when T3 lacks report support", async (c) => {
  // Arrange
  const { f, t3, selection } = await runtimeReadinessFixture(c);
  t3.support.reportReads = false;

  // Act
  const result = await f.recheckRuntime(selection);

  // Assert
  assert(result.ok);
  expect(result.value.ready).toBe(false);
  assert(result.value.issues.some((i) => i.code === "reporting_unsupported"));
});

it("recheckRuntime reports reporting_unsupported from its own connection check, though a later check finds report support", async (c) => {
  // Arrange
  const { f, t3, selection } = await runtimeReadinessFixture(c);
  t3.support.reportReads = false;
  changeReportSupportAtCapabilityRead(t3, () => f.recheckConnection(), true);

  // Act
  const result = await f.recheckRuntime(selection);

  // Assert
  assert(result.ok);
  assert(result.value.issues.some((i) => i.code === "reporting_unsupported"));
});

it("recheckRuntime never answers a new authorization context with the report support its own check found for the previous one", async (c) => {
  // Arrange
  const { f, t3, selection } = await runtimeReadinessFixture(c);
  const list = t3.listProjects.bind(t3);
  let releaseListing = () => {};
  const listingReleased = new Promise<void>((resolve) => (releaseListing = resolve));
  const listing = new Promise<void>((resolve) => {
    t3.listProjects = async (target) => {
      t3.listProjects = list;
      resolve();
      await listingReleased;
      return list(target);
    };
  });
  // A Project recheck holds the Project catalog while readiness makes its connection check.
  const projectRecheck = f.recheckProjects();
  await listing;
  const inspect = t3.inspect.bind(t3);
  const readinessInspected = new Promise<void>((resolve) => {
    t3.inspect = async (target) => {
      t3.inspect = inspect;
      const answer = await inspect(target);
      resolve();
      return answer;
    };
  });

  // Act
  const readiness = f.recheckRuntime(selection);
  await readinessInspected;
  t3.approve("replacement-grant");
  t3.support.reportReads = false;
  await f.recheckConnection();
  releaseListing();
  await projectRecheck;
  const result = await readiness;

  // Assert
  assert(result.ok);
  expect(result.value.ready).toBe(false);
  expect(result.value.issues.map(({ code, path }) => ({ code, path }))).toContainEqual({
    code: "connection_unavailable",
    path: "connection",
  });
});

it("a Cursor provider is not rejected as an unsupported harness", async (c) => {
  // Arrange
  const { t3, f, p, input } = await claudeRuntimeConfig(c);
  t3.controlledProviders.push({
    ...t3.controlledProviders[0]!,
    providerInstanceId: "cursor-local",
    driverKind: "cursor",
  });
  const cursor = await f.createAgent({
    ...input,
    name: "Cursor worker",
    execution: { ...input.execution, providerInstanceId: "cursor-local" },
  });
  assert(cursor.ok);

  // Act
  const check = await f.recheckRuntime({ projectId: p.value.id, agentId: cursor.value.id });

  // Assert
  assert(check.ok);
  expect(check.value.issues.some((issue) => issue.code === "harness_unsupported")).toBe(false);
  expect(check.value.issues.some((issue) => issue.code === "reporting_installation")).toBe(true);
});

it("a saved Agent's provider that T3 later offers as an unsupported harness stays visible and blocks runtime readiness", async (c) => {
  // Arrange
  const { t3, f, p, input } = await claudeRuntimeConfig(c);
  const future = await f.createAgent({
    ...input,
    execution: { ...input.execution, providerInstanceId: "future" },
  });
  assert(future.ok);
  t3.controlledProviders.push({
    ...t3.controlledProviders[0]!,
    providerInstanceId: "future",
    driverKind: "future",
  });

  // Act
  const check = await f.recheckRuntime({ projectId: p.value.id, agentId: future.value.id });

  // Assert
  assert(check.ok);
  assert(check.value.issues.some((i) => i.code === "harness_unsupported"));
  const capabilities = await f.getAgentCapabilities();
  assert(capabilities.ok);
  expect(
    capabilities.value.providers.find((provider) => provider.driverKind === "future")?.reporting,
  ).toMatchObject({ supported: false });
});
