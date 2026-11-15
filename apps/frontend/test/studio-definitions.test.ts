import { expect, it, vi } from "vite-plus/test";
import { notReady } from "./support/flow-draft.ts";
import { savedAgent } from "./support/agent-draft.ts";
import {
  currentWindow,
  deliveredStudio,
  liveStudio,
  savedFlow,
  studioChanged,
  studioSnapshot,
} from "./support/studio-definitions.ts";

it("both lists come from one Studio subscription", () => {
  // Arrange
  const { definitions, studio, socket } = liveStudio();

  // Act
  studio.message(studioSnapshot({ agents: [savedAgent()], flows: [savedFlow("Live")] }));

  // Assert
  expect(definitions.getSnapshot()).toStrictEqual({
    flows: { value: [savedFlow("Live")], synchronized: true, error: null },
    agents: { value: [savedAgent()], synchronized: true, error: null },
  });
  expect(socket.watches).toStrictEqual([{ rpc: "WatchStudio" }]);
});

it("a committed change updates both lists in one publication, keeping untouched entities, backend order and readiness-only Flow changes", () => {
  // Arrange
  const untouched = savedAgent({ id: "untouched", updatedAt: "2026-11-09T08:00:00.000Z" });
  const edited = savedAgent({ id: "edited", updatedAt: "2026-11-08T08:00:00.000Z" });
  const flow = savedFlow("Review");
  const { definitions, studio } = deliveredStudio({ agents: [untouched, edited], flows: [flow] });
  const notify = vi.fn();
  definitions.subscribe(notify);
  const saved = { ...edited, revision: 4, updatedAt: "2026-11-11T08:00:00.000Z" };
  const blocked = { ...flow, readiness: notReady };

  // Act
  studio.message(
    studioChanged({
      agents: { upserts: [saved], removals: [] },
      flows: { upserts: [blocked], removals: [] },
    }),
  );

  // Assert
  const { agents, flows } = definitions.getSnapshot();
  expect(agents.value).toStrictEqual([saved, untouched]);
  expect(agents.value?.[1]).toBe(untouched);
  expect(flows.value).toStrictEqual([blocked]);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("opening Studio holds back mutations until its subscription is current", () => {
  // Arrange
  const { definitions, live, socket } = currentWindow();

  // Act
  definitions.open();

  // Assert
  expect(socket.watches).toContainEqual({ rpc: "WatchStudio" });
  expect(live.delivery()).toBe("synchronizing");
});

it("closing Studio releases its subscription, so it no longer holds back mutations", () => {
  // Arrange
  const { definitions, live } = currentWindow();
  const close = definitions.open();

  // Act
  close();
  live.elapse();

  // Assert
  expect(live.owner.view("studio")).toStrictEqual({
    value: null,
    synchronized: false,
    error: null,
  });
  expect(live.delivery()).toBe("current");
});

it("a refused subscription keeps the lists unsynchronized with its error", () => {
  // Arrange
  const { definitions, studio, live } = deliveredStudio({
    agents: [savedAgent()],
    flows: [savedFlow("Live")],
  });

  // Act
  studio.failed({ code: "internal", message: "Studio could not be read.", issues: [] });

  // Assert
  expect(definitions.getSnapshot().flows).toStrictEqual({
    value: [savedFlow("Live")],
    synchronized: false,
    error: new Error("Studio could not be read."),
  });
  expect(definitions.getSnapshot().agents.synchronized).toBe(false);
  expect(live.delivery()).toBe("synchronizing");
});

it("an accepted write cannot mark the lists synchronized", async () => {
  // Arrange
  const { definitions } = liveStudio();

  // Act
  await definitions.createFlow({ name: "Release" });

  // Assert
  expect(definitions.getSnapshot().flows).toStrictEqual({
    value: null,
    synchronized: false,
    error: null,
  });
});
