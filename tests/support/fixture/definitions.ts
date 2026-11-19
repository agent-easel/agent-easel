import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/** Temporarily removes definitions through Factory so journeys can exercise empty lists. */
export function definitionsFixture({ factory, home }: Host) {
  const removedFlows = new Set<string>();
  const removedAgents = new Set<string>();

  async function removeFlow(id: string) {
    removedFlows.add(id);
    requireSuccess(await factory.removeFlow(id));
  }

  return {
    actions: {
      async removeFlow({ id }: { id: string }) {
        requireSuccess(await factory.getFlow(id));
        await removeFlow(id);
      },
      async removeFlows({ keepId }: { keepId?: string } = {}) {
        for (const { id } of requireSuccess(await factory.listFlows())) {
          if (id !== keepId) await removeFlow(id);
        }
      },
      async removeAgents() {
        for (const { id } of requireSuccess(await factory.listAgents())) {
          removedAgents.add(id);
          requireSuccess(await factory.removeAgent(id));
        }
      },
    },
    reset() {
      if (removedFlows.size === 0 && removedAgents.size === 0) return;
      // Undo only these soft removals in the disposable database. Recreating definitions
      // would change the IDs held by saved Flow graphs and the Run scenarios module.
      using database = new DatabaseSync(join(home, "factory.sqlite"));
      database.exec("BEGIN IMMEDIATE");
      database
        .prepare("UPDATE agents SET removed_at = NULL WHERE id IN (SELECT value FROM json_each(?))")
        .run(JSON.stringify([...removedAgents]));
      database
        .prepare("UPDATE flows SET removed_at = NULL WHERE id IN (SELECT value FROM json_each(?))")
        .run(JSON.stringify([...removedFlows]));
      database.exec("COMMIT");
      removedAgents.clear();
      removedFlows.clear();
    },
  };
}
