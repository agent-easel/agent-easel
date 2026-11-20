import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { DetectedT3, FirstRunSetup, Result } from "@t3-factory/contracts";
import { parseEndpoint } from "./connection.ts";

/**
 * T3's runtime file is T3's internal state, not a published contract, and may be stale or drift:
 * only the origin and version are read, unknown fields are ignored, and anything else means
 * "no running T3 found".
 */
async function detectT3(stateDirectory: string): Promise<DetectedT3 | null> {
  try {
    const file: unknown = JSON.parse(
      await readFile(join(stateDirectory, "server-runtime.json"), "utf8"),
    );
    if (typeof file !== "object" || file === null || !("origin" in file)) return null;
    if (typeof file.origin !== "string") return null;
    const endpoint = parseEndpoint({ endpoint: `${file.origin.replace(/\/+$/, "")}/mcp` });
    if (!endpoint.ok) return null;
    const serverVersion =
      "serverVersion" in file && typeof file.serverVersion === "string" && file.serverVersion
        ? file.serverVersion
        : null;
    return { endpoint: endpoint.value, serverVersion };
  } catch {
    return null;
  }
}

/** Setup completion is durable installation state; detection reads the shared T3 state directory. */
export const makeFirstRunSetup = (stateDirectory: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const read = Effect.gen(function* (): Effect.fn.Return<Result<FirstRunSetup>, unknown> {
      const rows = yield* sql<{
        completed: number;
      }>`SELECT completed FROM first_run_setup WHERE singleton = 1`;
      const detectedT3 = yield* Effect.promise(() => detectT3(stateDirectory));
      return { ok: true, value: { completed: rows[0]?.completed === 1, detectedT3 } };
    });
    return {
      getFirstRunSetup: () => read,
      /** Host only (enforced by the route). */
      completeFirstRunSetup: () =>
        Effect.gen(function* () {
          yield* sql`UPDATE first_run_setup SET completed = 1 WHERE singleton = 1`;
          return yield* read;
        }),
    };
  });
