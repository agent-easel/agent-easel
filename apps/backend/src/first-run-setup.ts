import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  DetectedT3,
  FirstRunSetup,
  ReportingInstallation,
  Result,
  T3Connection,
} from "@agent-easel/contracts";
import { parseEndpoint } from "./connection.ts";
import { reportingDriversOffInT3 } from "./reporting-discovery.ts";
import { telemetryDuration, type Telemetry } from "./telemetry.ts";

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
    // Only an exact origin is one: a path, credentials or text the URL parser would repair are not.
    if (typeof file.origin !== "string" || !URL.canParse(file.origin)) return null;
    if (new URL(file.origin).origin !== file.origin) return null;
    const endpoint = parseEndpoint({ endpoint: `${file.origin}/mcp` });
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
export const makeFirstRunSetup = (
  stateDirectory: string,
  telemetry: Telemetry,
  getConnection: () => Effect.Effect<Result<T3Connection>>,
  getInstallations: () => Effect.Effect<Result<readonly ReportingInstallation[]>, unknown>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const started = yield* Clock.currentTimeMillis;
    const read = Effect.gen(function* (): Effect.fn.Return<Result<FirstRunSetup>, unknown> {
      const rows = yield* sql<{
        completed: number;
      }>`SELECT completed FROM first_run_setup WHERE singleton = 1`;
      const [detectedT3, harnessesOffInT3] = yield* Effect.promise(() =>
        Promise.all([detectT3(stateDirectory), reportingDriversOffInT3(stateDirectory)]),
      );
      return {
        ok: true,
        value: { completed: rows[0]?.completed === 1, detectedT3, harnessesOffInT3 },
      };
    });
    const recordCompletion = Effect.fn(function* () {
      if (!telemetry.enabled) return;
      const duration = telemetryDuration((yield* Clock.currentTimeMillis) - started);
      const connection = yield* getConnection();
      const installations = yield* getInstallations().pipe(Effect.option);
      const t3Connection =
        connection.ok && connection.value.state === "ready"
          ? "completed"
          : connection.ok && connection.value.endpoint
            ? "incomplete"
            : "skipped";
      const targets =
        installations._tag === "Some" && installations.value.ok ? installations.value.value : [];
      const listed = targets.filter(
        (target) => target.kind === "instance" && target.status !== "unsupported",
      );
      const agentInstallation =
        listed.length > 0 && listed.every((target) => target.status === "installed")
          ? "completed"
          : t3Connection !== "skipped" && targets.some((target) => target.kind !== "none-enabled")
            ? "incomplete"
            : "skipped";
      yield* telemetry.record("setup.completed", {
        duration,
        t3Connection,
        agentInstallation,
      });
    });
    return {
      getFirstRunSetup: () => read,
      /** Host only (enforced by the route). */
      completeFirstRunSetup: () =>
        Effect.gen(function* () {
          const changed =
            yield* sql`UPDATE first_run_setup SET completed = 1 WHERE singleton = 1 AND completed = 0 RETURNING singleton`;
          if (changed.length) yield* telemetry.recordLater(recordCompletion());
          return yield* read;
        }),
    };
  });
