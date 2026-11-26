import { useEffect, useState, useSyncExternalStore } from "react";
import {
  diagnosticOperations,
  operationPath,
  type DiagnosticAttempt,
  type DiagnosticLogStatus,
} from "@agent-easel/contracts";
import { DIAGNOSTIC_ATTEMPT_PAGE_LIMIT } from "@agent-easel/domain-validation";
import { api, ApiError } from "./api.ts";
import { useClientScope } from "./client-scope.ts";
import { useRefreshSchedule } from "./refresh-schedule.ts";

export const diagnosticExportPath = operationPath(diagnosticOperations.exportDiagnosticLog);

const recordingRefreshMs = 3_000;
const idleRefreshMs = 60_000;
const attemptPageSize = 20;

export interface DiagnosticLogView {
  readonly status: DiagnosticLogStatus;
  readonly attempts: readonly DiagnosticAttempt[];
  readonly missing: readonly string[];
  readonly more: boolean;
}

const diagnosticErrorMessage = (cause: unknown) =>
  cause instanceof ApiError
    ? [cause.message, ...cause.detail.issues.map((issue) => issue.message)].join(" ")
    : cause instanceof Error
      ? cause.message
      : "AgentEasel could not change the Diagnostic log.";

async function readDiagnosticLog(
  ids: readonly string[] | null,
  limit: number,
): Promise<DiagnosticLogView> {
  const status = await api.getDiagnosticLog();
  if (ids?.length === 0) return { status, attempts: [], missing: [], more: false };
  const page = await api.listDiagnosticAttempts("", String(limit), ids?.join(",") ?? "");
  const listed = new Set(page.attempts.map((attempt) => attempt.id));
  return {
    status,
    attempts: page.attempts,
    missing: ids?.filter((id) => !listed.has(id)) ?? [],
    more: page.nextCursor !== null,
  };
}

export function useDiagnosticLog(ids: readonly string[] | null) {
  const [limit, setLimit] = useState(attemptPageSize);
  const [view, setView] = useState<DiagnosticLogView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filter = ids?.join(",") ?? null;
  const { failure, refresh, supersede } = useRefreshSchedule({
    read: () => readDiagnosticLog(ids, limit),
    apply: setView,
    intervalMs: view?.status.enabled ? recordingRefreshMs : idleRefreshMs,
  });
  useEffect(() => {
    void refresh();
  }, [refresh, filter, limit]);
  const change = (mutation: () => Promise<DiagnosticLogStatus>) => {
    setBusy(true);
    setError("");
    return mutation()
      .then(async () => {
        supersede();
        await refresh();
      })
      .catch((cause: unknown) => setError(diagnosticErrorMessage(cause)))
      .finally(() => setBusy(false));
  };
  return {
    view,
    failure,
    busy,
    error,
    refresh,
    setRecording: (enabled: boolean) => change(() => api.setDiagnosticRecording({ enabled })),
    deleteLog: () => change(() => api.deleteDiagnosticLog()),
    showOlder:
      view?.more && limit < DIAGNOSTIC_ATTEMPT_PAGE_LIMIT
        ? () =>
            setLimit((current) =>
              Math.min(current + attemptPageSize, DIAGNOSTIC_ATTEMPT_PAGE_LIMIT),
            )
        : undefined,
  };
}

export function useDiagnosticLogStatus(refreshKey: unknown = null) {
  const [status, setStatus] = useState<DiagnosticLogStatus | null>(null);
  const { refresh } = useRefreshSchedule({
    read: api.getDiagnosticLog,
    apply: setStatus,
    intervalMs: status?.enabled ? recordingRefreshMs : idleRefreshMs,
  });
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);
  return status;
}

export function createDiagnosticRetry(
  enable: () => Promise<unknown> = () => api.setDiagnosticRecording({ enabled: true }),
) {
  let attempts: readonly string[] | null = null;
  const listeners = new Set<() => void>();
  const keep = (next: readonly string[]) => {
    attempts = next;
    listeners.forEach((notify) => notify());
  };
  return {
    getSnapshot: () => attempts,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    async retry(recover: () => Promise<readonly string[]>) {
      keep([]);
      await enable();
      keep(await recover());
    },
  };
}

export function useDiagnosticRetry() {
  const [retry] = useState(() => createDiagnosticRetry());
  const attempts = useSyncExternalStore(retry.subscribe, retry.getSnapshot);
  const [busy, setBusy] = useState(false);
  const status = useDiagnosticLogStatus(busy);
  const host = useClientScope() === "host";
  const [error, setError] = useState("");
  return {
    attempts: attempts?.length ? attempts : null,
    offer: host && !busy && status !== null && !status.enabled,
    busy,
    error,
    start(recover: () => Promise<readonly string[]>) {
      setBusy(true);
      setError("");
      retry
        .retry(recover)
        .catch((cause: unknown) => setError(diagnosticErrorMessage(cause)))
        .finally(() => setBusy(false));
    },
  };
}

export type DiagnosticRetry = ReturnType<typeof useDiagnosticRetry>;
