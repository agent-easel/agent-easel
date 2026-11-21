import assert from "node:assert/strict";
import type { FlowDraft, FlowGraph, Result } from "../../packages/contracts/src/index.ts";

const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

async function request(baseUrl: string | undefined, path: string, init?: RequestInit) {
  const result = (await (await fetch(new URL(path, baseUrl), init)).json()) as Result<unknown>;
  assert(result.ok, JSON.stringify(result).slice(0, 600));
  return result.value;
}

const GRID = { left: 0, top: 640, stepX: 300, stepY: 300 };

const NEIGHBOUR_REACHES = [1, 2, 3, 24, 25, 26, 50, 100, 200, -1, -25];

const FAR_REVIEWER = { x: 6400, y: 2800 };

const fillerWire = (from: number, reach: number, fillers: number) => ({
  sourceBlockId: `filler-${from}`,
  exitId: "output",
  targetBlockId: `filler-${(from + reach + fillers) % fillers}`,
});

export async function saveLargeFlow(
  baseUrl: string | undefined,
  name: string,
  { fillers, wires, columns = 25 }: { fillers: number; wires: number; columns?: number },
) {
  assert(wires <= fillers * NEIGHBOUR_REACHES.length, "Each filler reaches each neighbour once");
  const flows = (await request(baseUrl, "/api/flows")) as FlowDraft[];
  const seeded = flows.find((flow) => flow.name === "Demo · Build, review and decide");
  assert(seeded);
  const created = (await request(baseUrl, "/api/flows", {
    method: "POST",
    headers: mutation,
    body: JSON.stringify({ name }),
  })) as FlowDraft;
  const graph: FlowGraph = {
    ...seeded.graph,
    blocks: [
      ...seeded.graph.blocks.map((block) =>
        block.id === "reviewer" ? { ...block, position: FAR_REVIEWER } : block,
      ),
      ...Array.from({ length: fillers }, (_, index) => ({
        id: `filler-${index}`,
        kind: "wait" as const,
        name: `Filler ${index}`,
        duration: { amount: 10, unit: "minutes" as const },
        position: {
          x: GRID.left + (index % columns) * GRID.stepX,
          y: GRID.top + Math.floor(index / columns) * GRID.stepY,
        },
      })),
    ],
    connections: [
      ...seeded.graph.connections,
      { sourceBlockId: "decision", exitId: "approve", targetBlockId: "filler-0" },
      ...Array.from({ length: wires }, (_, index) =>
        fillerWire(
          index % fillers,
          NEIGHBOUR_REACHES[Math.floor(index / fillers) % NEIGHBOUR_REACHES.length]!,
          fillers,
        ),
      ),
    ],
  };
  await request(baseUrl, `/api/flows/${created.id}`, {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({
      name,
      expectedRevision: 1,
      expectedProjectId: created.projectId,
      workspace: { mode: "checkout" },
      graph,
    }),
  });
  return created.id;
}
