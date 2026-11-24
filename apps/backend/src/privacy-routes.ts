import * as Effect from "effect/Effect";
import type { privacyOperations, Result, TelemetrySetting } from "@agent-easel/contracts";
import type { configurationWriter } from "./config.ts";
import { resultResponse, standardBody } from "./http-support.ts";
import type { Factory } from "./open-factory.ts";
import { failure } from "./result.ts";
import type { RouteEntries } from "./route-table.ts";

export function privacyRoutes(
  telemetry: Factory["telemetry"],
  writeConfiguration: ReturnType<typeof configurationWriter>,
  preference: boolean,
): RouteEntries<typeof privacyOperations> {
  const snapshot = (telemetryEnabled: boolean): TelemetrySetting => ({
    telemetryEnabled,
    effectiveEnabled: telemetry.enabled,
    disabledReason: telemetry.disabledReason,
  });
  let current = snapshot(preference);
  const setting = (): Result<TelemetrySetting> => ({ ok: true, value: current });
  return {
    getTelemetrySetting: {
      handle: () => Effect.sync(() => resultResponse(setting())),
    },
    updateTelemetrySetting: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => {
        const next =
          typeof input === "object" && input !== null && "telemetryEnabled" in input
            ? input.telemetryEnabled
            : undefined;
        if (typeof next !== "boolean")
          return Effect.succeed(
            resultResponse(failure("validation", "Send { telemetryEnabled: boolean }.")),
          );
        return Effect.promise(() =>
          writeConfiguration(
            (saved) => ({ ...saved, telemetryEnabled: next }),
            async () => {
              await telemetry.setPreference(next);
              current = snapshot(next);
              return resultResponse(setting());
            },
          ),
        );
      },
    },
  };
}
