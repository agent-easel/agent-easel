import { operation } from "./operation.ts";

export interface TelemetrySetting {
  readonly telemetryEnabled: boolean;
  readonly effectiveEnabled: boolean;
  readonly disabledReason: "environment" | "unavailable" | null;
}

export const privacyOperations = {
  getTelemetrySetting: operation<never, TelemetrySetting>()({
    method: "GET",
    path: "/api/settings/telemetry",
  }),
  updateTelemetrySetting: operation<{ telemetryEnabled: boolean }, TelemetrySetting>()({
    method: "PUT",
    path: "/api/settings/telemetry",
    body: "json",
  }),
};
