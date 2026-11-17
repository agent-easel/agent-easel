import { readFlow, saveFlowElsewhere, saveSingleAgentFlow } from "./flows.ts";
import type { StudioFixtures } from "./studio.ts";

/**
 * Saves a Flow whose Coder (block `worker`, a Runtime worker with one exit, `done`) reaches
 * Condition Escalate with `rules`; each listed wire leaves an Escalate output for Coder or for
 * Human step Review.
 */
export async function saveConditionFlow(
  baseUrl: string | undefined,
  name: string,
  rules: readonly { id: string; name: string; fromArrival: number | null }[],
  wired: readonly (readonly [exitId: string, targetBlockId: "worker" | "review"])[],
) {
  const id = await saveSingleAgentFlow(baseUrl, name, "Runtime worker", {
    id: "worker",
    name: "Coder",
    x: 320,
    y: 60,
  });
  const flow = await readFlow(baseUrl, id);
  await saveFlowElsewhere(baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        ...flow.graph.blocks,
        {
          id: "escalate",
          kind: "condition",
          name: "Escalate",
          position: { x: 680, y: 60 },
          rules,
          otherwise: { id: "otherwise" },
        },
        { id: "review", kind: "human", name: "Review", position: { x: 1040, y: 60 } },
      ],
      connections: [
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "escalate" },
        ...wired.map(([exitId, targetBlockId]) => ({
          sourceBlockId: "escalate",
          exitId,
          targetBlockId,
        })),
      ],
    },
  });
  return id;
}

/** A saved Flow whose Condition Escalate has one rule, from arrival 3, is open with Escalate selected. */
export async function openOneRuleCondition({ app, screen, browser }: StudioFixtures, name: string) {
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveConditionFlow(
    app.baseUrl,
    name,
    [{ id: "human", name: "Human", fromArrival: 3 }],
    [["human", "review"]],
  );
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Condition Escalate").tap();
  return flowId;
}
