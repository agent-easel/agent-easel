import { useEffect, useState } from "react";
import type { TriggerReadiness } from "@t3-factory/contracts";
import { api } from "../../api.ts";

type ReadinessRead =
  | { readonly status: "checking" }
  | { readonly status: "answered"; readonly readiness: TriggerReadiness }
  | { readonly status: "failed"; readonly message: string };

/**
 * What a GitHub Issues Trigger needs on the Factory host for the chosen Project (which
 * may be empty), read again whenever it changes; an answer for an earlier choice is dropped.
 */
export function useTriggerReadiness(projectId: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}\n${attempt}`;
  const [read, setRead] = useState<{ key: string; value: ReadinessRead }>({
    key,
    value: { status: "checking" },
  });
  if (read.key !== key) setRead({ key, value: { status: "checking" } });
  useEffect(() => {
    let active = true;
    void api.getTriggerReadiness(projectId, "").then(
      (readiness) => {
        if (active) setRead({ key, value: { status: "answered", readiness } });
      },
      (cause: unknown) => {
        if (active)
          setRead({
            key,
            value: {
              status: "failed",
              message:
                cause instanceof Error ? cause.message : "Factory could not check readiness.",
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [key, projectId]);
  return {
    read: read.key === key ? read.value : ({ status: "checking" } as const),
    retry: () => setAttempt((previous) => previous + 1),
  };
}
