import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { reviewPanelGraph, releaseGraph, savedFlow } from "./support/subflow.ts";

async function readyComposition(c: Parameters<typeof prepared>[0]) {
  const setup = await prepared(c);
  const child = await savedFlow(setup.f, {
    name: "Review panel",
    graph: reviewPanelGraph(setup.agent.id),
  });
  const parent = await savedFlow(setup.f, {
    name: "Release",
    graph: releaseGraph(setup.agent.id, child.id),
  });
  assert(parent.readiness.ready, JSON.stringify(parent.readiness.issues));
  return { ...setup, parent };
}

it("Export refuses a Flow that places a Subflow", async (c) => {
  // Arrange
  const { f, parent } = await readyComposition(c);

  // Act
  const exported = await f.exportFlow(parent.id);

  // Assert
  assert(!exported.ok);
  expect(exported.error.issues.map((issue) => issue.code)).toStrictEqual([
    "subflow_export_unavailable",
  ]);
});
