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

it("Start refuses a ready Flow that places a Subflow and creates no Run", async (c) => {
  // Arrange
  const { f, input, parent } = await readyComposition(c);

  // Act
  const started = await f.startRun({ ...input, flowId: parent.id });

  // Assert
  assert(!started.ok);
  expect(started.error.issues).toStrictEqual([
    {
      code: "subflow_start_unavailable",
      path: "flowId",
      message: "Start a Flow without Subflow blocks.",
    },
  ]);
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: [] });
});
