import { expect, it } from "vite-plus/test";
import type { JoinArrival, JoinDetail, JoinSummary } from "@agent-easel/contracts";
import { joinSourceText } from "../src/join-display.ts";

const arrival = (exitName: string): JoinArrival => ({
  exitId: exitName.toLowerCase(),
  exitName,
  arrivedAt: "2026-11-22T10:00:00Z",
});

const summary = (change: Partial<JoinSummary>): JoinSummary => ({
  blockId: "results",
  round: 1,
  sources: 2,
  arrived: 0,
  queued: 0,
  latest: null,
  ...change,
});

const detail = (sources: JoinDetail["sources"]): JoinDetail => ({
  blockId: "results",
  round: 2,
  sources,
  latest: null,
});

const rows = (current: JoinSummary, read: JoinDetail) =>
  read.sources.map((_source, slot) => joinSourceText(current, read, slot));

it("a collecting round shows each source's arrived exit with its queued count, or pending", () => {
  // Arrange
  const read = detail([
    {
      sourceBlockId: "code",
      name: "Code review",
      arrived: arrival("Changes requested"),
      queued: 1,
      extras: [arrival("Approved")],
      latestArrival: arrival("Approved"),
    },
    {
      sourceBlockId: "accessibility",
      name: "Accessibility review",
      arrived: null,
      queued: 0,
      extras: [],
      latestArrival: arrival("Changes requested"),
    },
  ]);

  // Act
  const shown = rows(
    summary({
      round: 2,
      arrived: 1,
      queued: 1,
      latest: { round: 1, outcome: "forwarded", at: "" },
    }),
    read,
  );

  // Assert
  expect(shown).toEqual(["Changes requested +1", "pending"]);
});

it("a cancelled round shows the exits it had collected and pending for the source that never arrived", () => {
  // Arrange
  const read = detail([
    {
      sourceBlockId: "code",
      name: "Code review",
      arrived: null,
      queued: 0,
      extras: [],
      latestArrival: arrival("Approved"),
    },
    {
      sourceBlockId: "accessibility",
      name: "Accessibility review",
      arrived: null,
      queued: 0,
      extras: [],
      latestArrival: null,
    },
  ]);

  // Act
  const shown = rows(summary({ latest: { round: 1, outcome: "cancelled", at: "" } }), read);

  // Assert
  expect(shown).toEqual(["Approved", "pending"]);
});
