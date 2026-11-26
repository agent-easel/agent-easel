import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  ConflictReason,
  HomeReason,
  HomeSource,
  InstallWriteReason,
  ReportingHarnessName,
} from "@agent-easel/contracts";
import { diagnosticPath } from "@agent-easel/domain-validation";
import { RepairableInstallationError } from "./reporting-installation-actions.ts";
import { isReportingDriver } from "./reporting-drivers.ts";

export class HomeRefusal extends Error {
  reason: HomeReason;
  source: HomeSource;
  constructor(message: string, reason: HomeReason, source: HomeSource) {
    super(message);
    this.reason = reason;
    this.source = source;
  }
}

export class ConfigRefusal extends Error {
  reason: ConflictReason;
  constructor(message: string, reason: ConflictReason) {
    super(message);
    this.reason = reason;
  }
}

const recorded = new WeakSet<object>();

export function markRecorded(error: unknown): void {
  if (typeof error === "object" && error !== null) recorded.add(error);
}

export const isRecorded = (error: unknown): boolean =>
  typeof error === "object" && error !== null && recorded.has(error);

export const reportingHarnessName = (driver: unknown): ReportingHarnessName =>
  isReportingDriver(driver) ? driver : "unknown";

const errnoCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

export function writeFailureReason(error: unknown): InstallWriteReason {
  const code = errnoCode(error);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "permission_denied";
  if (code === "ENOENT" || code === "ENOTDIR") return "missing_directory";
  if (code === "ENOSPC") return "no_space";
  if (error instanceof Error && error.message.startsWith("Configuration changed during"))
    return "changed_during_install";
  if (error instanceof Error && error.message.startsWith("Symlink, special"))
    return "unmanageable_file";
  return "write_failed";
}

export function homeFailureReason(error: unknown): HomeReason {
  const code = errnoCode(error);
  if (code === "ENOENT") return "home_missing";
  return "home_unreadable";
}

export function configFailureReason(error: unknown): ConflictReason {
  if (error instanceof ConfigRefusal) return error.reason;
  if (error instanceof RepairableInstallationError) return "entry_other_address";
  if (error instanceof Error && error.message.startsWith("Symlink, special"))
    return "config_unmanageable";
  if (errnoCode(error) !== undefined) return "config_unreadable";
  return "config_invalid";
}

type PathRoot = {
  readonly root: string;
  readonly placeholder: "~" | "<T3_STATE>" | "<CODEX_HOME>";
};

export async function reportingPaths(stateDirectory: string) {
  const resolved = async (directory: string) => [
    directory,
    await realpath(directory).catch(() => directory),
  ];
  const roots: PathRoot[] = [
    ...(await resolved(homedir())).map((root) => ({ root, placeholder: "~" as const })),
    ...(await resolved(stateDirectory)).map((root) => ({
      root,
      placeholder: "<T3_STATE>" as const,
    })),
  ];
  return {
    path: (path: string) => diagnosticPath(path, roots),
    codexPath: (path: string, home: string) =>
      diagnosticPath(path, [{ root: home, placeholder: "<CODEX_HOME>" }, ...roots]),
  };
}

export type ReportingPaths = Awaited<ReturnType<typeof reportingPaths>>;
