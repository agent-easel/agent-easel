import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

/** A failed read, shown until a later read succeeds. */
export interface RefreshFailure {
  readonly cause: unknown;
}

/** The page signals a watching schedule follows: the document in the app, fakes in tests. */
export interface RefreshPage {
  visible(): boolean;
  /** Follows visibility changes and window focus until the returned function is called. */
  subscribe(events: { readonly visibility: () => void; readonly focus: () => void }): () => void;
}

const documentPage: RefreshPage = {
  visible: () => document.visibilityState !== "hidden",
  subscribe({ visibility, focus }) {
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
    };
  },
};

export interface RefreshReads<T> {
  readonly read: () => Promise<T>;
  readonly apply: (value: T) => void;
  /** Called with a failed read, and with null once a later read succeeds. */
  readonly failed: (failure: RefreshFailure | null) => void;
}

/**
 * Periodic reads of server state that has no live scope. Only the newest read may apply its
 * answer, so a slower earlier read never replaces a later one; nothing applies after `close`.
 */
export function createRefreshSchedule<T>({ read, apply, failed }: RefreshReads<T>) {
  let latest = 0;
  let closed = false;
  let failing = false;

  function recovered() {
    if (failing) failed(null);
    failing = false;
  }

  async function refresh() {
    const ticket = ++latest;
    const current = () => !closed && ticket === latest;
    await read().then(
      (value) => {
        if (!current()) return;
        apply(value);
        recovered();
      },
      (cause: unknown) => {
        if (!current()) return;
        failing = true;
        failed({ cause });
      },
    );
  }

  /** Reads now and every `intervalMs` while the page is visible, and again on focus. */
  function watch(intervalMs: number, page: RefreshPage) {
    let timer: ReturnType<typeof setInterval> | undefined;
    const pause = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const resume = () => {
      pause();
      if (!page.visible()) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const unsubscribe = page.subscribe({ visibility: resume, focus: () => void refresh() });
    resume();
    return () => {
      pause();
      unsubscribe();
    };
  }

  return {
    refresh,
    watch,
    /** A newer answer, such as an action's, applied: drops reads in flight and the failure. */
    supersede: () => {
      latest++;
      recovered();
    },
    close: () => {
      closed = true;
    },
  };
}

type RefreshSchedule = ReturnType<typeof createRefreshSchedule>;

/**
 * Holds a refresh schedule while the calling component is mounted. It reads every `intervalMs`
 * while `watching`; `refresh` reads once at any time. The failure clears after a later success.
 */
export function useRefreshSchedule<T>({
  read,
  apply,
  intervalMs,
  watching = true,
}: {
  read: () => Promise<T>;
  apply: (value: T) => void;
  intervalMs: number;
  watching?: boolean;
}) {
  const [failure, setFailure] = useState<RefreshFailure | null>(null);
  const readNow = useEffectEvent(read);
  const applyAnswer = useEffectEvent(apply);
  const schedule = useRef<RefreshSchedule | null>(null);
  useEffect(() => {
    const created = createRefreshSchedule({
      read: () => readNow(),
      apply: (value: T) => applyAnswer(value),
      failed: setFailure,
    });
    schedule.current = created;
    return () => {
      created.close();
      schedule.current = null;
    };
  }, []);
  useEffect(
    () => (watching ? schedule.current?.watch(intervalMs, documentPage) : undefined),
    [intervalMs, watching],
  );
  const refresh = useCallback(async () => await schedule.current?.refresh(), []);
  const supersede = useCallback(() => schedule.current?.supersede(), []);
  return { failure, refresh, supersede };
}
