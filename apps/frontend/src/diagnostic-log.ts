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

async function readWholeLog(windowSize: number) {
  const attempts: DiagnosticAttempt[] = [];
  let cursor: string | null = "";
  while (cursor !== null && attempts.length < windowSize) {
    const wholePageLimit = cursor === "" ? attemptPageSize : DIAGNOSTIC_ATTEMPT_PAGE_LIMIT;
    const size = Math.min(windowSize - attempts.length, wholePageLimit);
    const page = await api.listDiagnosticAttempts(cursor, String(size), "");
    attempts.push(...page.attempts);
    cursor = page.nextCursor;
  }
  return { attempts, missing: [], more: cursor !== null };
}

async function readFilteredLog(filter: string) {
  const remaining = new Set(filter ? filter.split(",") : []);
  const scan = remaining.size > DIAGNOSTIC_ATTEMPT_PAGE_LIMIT;
  const query = scan ? "" : [...remaining].join(",");
  const size = String(scan ? DIAGNOSTIC_ATTEMPT_PAGE_LIMIT : attemptPageSize);
  const attempts: DiagnosticAttempt[] = [];
  let cursor: string | null = "";
  while (cursor !== null && remaining.size > 0) {
    const page = await api.listDiagnosticAttempts(cursor, size, query);
    attempts.push(...page.attempts.filter((attempt) => remaining.delete(attempt.id)));
    cursor = page.nextCursor;
  }
  return { attempts, missing: [...remaining], more: false };
}

async function readDiagnosticLog(filter: string | null, pages: number): Promise<DiagnosticLogView> {
  const status = await api.getDiagnosticLog();
  const selection =
    filter === null ? await readWholeLog(pages * attemptPageSize) : await readFilteredLog(filter);
  return { status, ...selection };
}

export function useDiagnosticLog(ids: readonly string[] | null) {
  const [pages, setPages] = useState(1);
  const [answer, setAnswer] = useState<{ filter: string | null; view: DiagnosticLogView }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filter = ids?.join(",") ?? null;
  const view = answer?.filter === filter ? answer.view : null;
  const { failure, pending, refresh, supersede } = useRefreshSchedule({
    read: async () => ({ filter, view: await readDiagnosticLog(filter, pages) }),
    apply: setAnswer,
    intervalMs: view?.status.enabled ? recordingRefreshMs : idleRefreshMs,
  });
  useEffect(() => {
    void refresh();
  }, [refresh, filter, pages]);
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
    pending,
    busy,
    error,
    refresh,
    setRecording: (enabled: boolean) => change(() => api.setDiagnosticRecording({ enabled })),
    deleteLog: () => change(() => api.deleteDiagnosticLog()),
    showOlder: view?.more ? () => setPages(pages + 1) : undefined,
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
