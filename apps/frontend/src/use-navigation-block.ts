import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, type ParsedLocation } from "@tanstack/react-router";

export type NavigationBlock<Unsaved> =
  | { status: "blocked"; unsaved: Unsaved; reset: () => void; proceed: () => void }
  | { status: "idle" };

/**
 * While `active`, asks `blocking` about each navigation, and warns before unload. A navigation
 * waits while `blocking` names unsaved work it would discard, until the user keeps editing
 * (`reset`) or discards them (`proceed`).
 */
export function useNavigationBlock<Unsaved>(
  active: boolean,
  blocking: (next: ParsedLocation) => Unsaved | undefined,
): NavigationBlock<Unsaved> {
  const router = useRouter();
  const pending = useRef<((block: boolean) => void) | undefined>(undefined);
  const blockingRef = useRef(blocking);
  useLayoutEffect(() => {
    blockingRef.current = blocking;
  }, [blocking]);
  const [decision, setDecision] = useState<NavigationBlock<Unsaved>>({ status: "idle" });
  useEffect(() => {
    const unblock = router.history.block({
      enableBeforeUnload: active,
      blockerFn: async ({ nextLocation }) => {
        const unsaved = blockingRef.current(router.parseLocation(nextLocation));
        if (unsaved === undefined) return false;
        if (pending.current) return true;
        const blocked = await new Promise<boolean>((resolve) => {
          pending.current = resolve;
          setDecision({
            status: "blocked",
            unsaved,
            reset: () => resolve(true),
            proceed: () => resolve(false),
          });
        });
        pending.current = undefined;
        setDecision({ status: "idle" });
        return blocked;
      },
    });
    return () => {
      pending.current?.(true);
      pending.current = undefined;
      unblock();
    };
  }, [active, router]);
  return decision;
}
