import { useMemo } from "react";
import { applyRunChange, type RunDetail, type RunLiveMessage } from "@agent-easel/contracts";
import type { LiveScope } from "./owner.ts";
import { useLiveScope } from "./live-connection.ts";

export function runScope(runId: string): LiveScope<RunLiveMessage, RunDetail> {
  return {
    key: `run:${runId}`,
    part: { kind: "run", runId },
    snapshot: (message) => message.run,
    apply: applyRunChange,
  };
}

export function useLiveRun(runId: string) {
  const scope = useMemo(() => runScope(runId), [runId]);
  return useLiveScope(scope);
}
