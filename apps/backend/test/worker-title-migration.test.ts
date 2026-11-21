import { assert, expect, it } from "@effect/vitest";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData, restoreCapturedAdapter } from "./support/migration-data.ts";

it("upgrade recovers the saved legacy launch and preserves the bound legacy title until Rename", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const capture = await loadMigrationData<{
    boundId: string;
    lostId: string;
    t3: Record<string, unknown>;
  }>(h.databasePath, "worker-title-upgrade-data.json");
  const t3 = await restoreCapturedAdapter(capture.t3, h.processHome);
  const recovered = t3.threads.nextRename();

  // Act
  const factory = await h.open({ t3 });

  // Assert
  expect(await recovered).toMatchObject({
    threadId: "thread-2",
    title: "F#2 Entry worker · Improve search",
  });
  expect(await factory.getRun(capture.lostId)).toMatchObject({
    ok: true,
    value: { blocks: [{ threadId: "thread-2" }] },
  });
  await factory.awaitWorkerTitles();
  expect(t3.threads.launchCalls).toBe(0);
  expect(t3.threads.renames).toHaveLength(1);
  expect(t3.threads.threadTitle("thread-1")).toBe("Factory #1 · 1 Entry worker");
});

it("Rename updates a bound worker after upgrade from the released database", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const capture = await loadMigrationData<{
    boundId: string;
    lostId: string;
    t3: Record<string, unknown>;
  }>(h.databasePath, "worker-title-upgrade-data.json");
  const t3 = await restoreCapturedAdapter(capture.t3, h.processHome);
  const recovered = t3.threads.nextRename();

  const factory = await h.open({ t3 });
  await recovered;
  const renamed = t3.threads.nextRename();

  // Act
  assert((await factory.renameRun(capture.boundId, { title: "Ship" })).ok);

  // Assert
  expect(await renamed).toMatchObject({ threadId: "thread-1", title: "F#1 Entry worker · Ship" });
});
