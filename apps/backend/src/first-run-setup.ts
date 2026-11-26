import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  DetectedT3,
  DiagnosticEntry,
  FirstRunSetup,
  Result,
  T3DetectionReason,
} from "@agent-easel/contracts";
import { diagnosticHost, diagnosticVersion } from "@agent-easel/domain-validation";
import { parseEndpoint } from "./connection.ts";
import type { DiagnosticLog } from "./diagnostic-log.ts";
import { firstRunReportingState } from "./reporting-discovery.ts";

type Detection = {
  readonly detected: DetectedT3 | null;
  readonly entry: Extract<DiagnosticEntry, { type: "t3_detection" }>;
};

const RUNTIME_FILE = "<T3_STATE>/server-runtime.json";

const refused = (reason: T3DetectionReason, origin?: string): Detection => ({
  detected: null,
  entry: {
    type: "t3_detection",
    outcome: "failed",
    reason,
    file: RUNTIME_FILE,
    host: origin === undefined ? null : diagnosticHost(new URL(origin).hostname),
    t3Version: null,
  },
});

async function readRuntimeFile(
  stateDirectory: string,
): Promise<{ readonly text: string } | { readonly reason: T3DetectionReason }> {
  try {
    return { text: await readFile(join(stateDirectory, "server-runtime.json"), "utf8") };
  } catch (error) {
    return {
      reason:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "runtime_file_missing"
          : "runtime_file_unreadable",
    };
  }
}

function parseRuntimeFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * T3's runtime file is T3's internal state, not a published contract, and may be stale or drift:
 * only the origin and version are read, unknown fields are ignored, and anything else means
 * "no running T3 found".
 */
async function detectT3(stateDirectory: string): Promise<Detection> {
  const read = await readRuntimeFile(stateDirectory);
  if ("reason" in read) return refused(read.reason);
  const file = parseRuntimeFile(read.text);
  if (typeof file !== "object" || file === null || !("origin" in file))
    return refused("runtime_file_malformed");
  // Only an exact origin is one: a path, credentials or text the URL parser would repair are not.
  if (typeof file.origin !== "string" || !URL.canParse(file.origin))
    return refused("runtime_origin_invalid");
  if (new URL(file.origin).origin !== file.origin) return refused("runtime_origin_invalid");
  const endpoint = parseEndpoint({ endpoint: `${file.origin}/mcp` });
  if (!endpoint.ok) return refused("runtime_endpoint_refused", file.origin);
  const serverVersion =
    "serverVersion" in file && typeof file.serverVersion === "string" && file.serverVersion
      ? file.serverVersion
      : null;
  return {
    detected: { endpoint: endpoint.value, serverVersion },
    entry: {
      type: "t3_detection",
      outcome: "ok",
      reason: "runtime_file_found",
      file: RUNTIME_FILE,
      host: diagnosticHost(new URL(file.origin).hostname),
      t3Version: serverVersion === null ? null : diagnosticVersion(serverVersion),
    },
  };
}

/** Setup completion is durable installation state; detection reads the shared T3 state directory. */
export const makeFirstRunSetup = (stateDirectory: string, diagnostics: DiagnosticLog) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const detect = Effect.gen(function* () {
      const attempt = yield* diagnostics.attempt("t3_detection");
      const detection = yield* attempt.guard(
        "t3_detection",
        Effect.promise(() => detectT3(stateDirectory)),
      );
      yield* attempt.record(detection.entry);
      yield* attempt.finish(detection.detected === null ? "failed" : "ok");
      return detection.detected;
    });
    const read = Effect.gen(function* (): Effect.fn.Return<Result<FirstRunSetup>, unknown> {
      const rows = yield* sql<{
        completed: number;
      }>`SELECT completed FROM first_run_setup WHERE singleton = 1`;
      const [detectedT3, reporting] = yield* Effect.all(
        [detect, Effect.promise(() => firstRunReportingState(stateDirectory))],
        { concurrency: "unbounded" },
      );
      return {
        ok: true,
        value: {
          completed: rows[0]?.completed === 1,
          detectedT3,
          harnessesOffInT3: reporting.harnessesOffInT3,
          reportingEligibility: reporting.reportingEligibility,
        },
      };
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
