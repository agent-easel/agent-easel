import type { ReportingInstallation } from "@agent-easel/contracts";
import { api, ApiError } from "./api.ts";

export async function installReportingHomes(
  ids: readonly string[],
  update: {
    running(id: string): void;
    installed(target: ReportingInstallation): void;
    failed(id: string, cause: unknown): void;
  },
) {
  const attempts: string[] = [];
  for (const targetId of ids) {
    update.running(targetId);
    await api.installReporting({ targetId }).then(
      (target) => {
        update.installed(target);
        attempts.push(...(target.diagnosticAttempts ?? []));
      },
      (cause: unknown) => {
        update.failed(targetId, cause);
        if (cause instanceof ApiError) attempts.push(...(cause.detail.diagnosticAttempts ?? []));
      },
    );
  }
  return attempts;
}
