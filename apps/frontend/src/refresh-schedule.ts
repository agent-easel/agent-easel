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
  /** Called when a read whose answer may still apply starts being, or stops being, outstanding. */
  readonly pending: (pending: boolean) => void;
}

/**
 * Periodic reads of server state that has no live scope. Only the newest read may apply its
 * answer, so a slower earlier read never replaces a later one; nothing applies after `close`.
 */
export function createRefreshSchedule<T>({ read, apply, failed, pending }: RefreshReads<T>) {
  let latest = 0;
  let closed = false;
  let failing = false;
  let outstanding = false;

  function recovered() {
    if (failing) failed(null);
    failing = false;
  }

  function settle(next: boolean) {
    if (outstanding !== next) pending(next);
    outstanding = next;
  }

  async function runRead(readOnce: () => Promise<T>, propagateFailure: boolean) {
    const ticket = ++latest;
    const current = () => !closed && ticket === latest;
    settle(true);
    return readOnce().then(
      (value) => {
        if (!current()) return undefined;
        apply(value);
        settle(false);
        recovered();
        return value;
      },
      (cause: unknown) => {
        if (!current()) return undefined;
        failing = true;
        settle(false);
        failed({ cause });
        if (propagateFailure) throw cause;
        return undefined;
      },
    );
  }

  async function refresh(readOnce = read) {
    await runRead(readOnce, false);
  }

  /** Reads now and every `intervalMs` while the page is visible, and again on focus. */
  function watch(intervalMs: number, page: RefreshPage, readWatch = read) {
    let timer: ReturnType<typeof setInterval> | undefined;
    const pause = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const resume = () => {
      pause();
      if (!page.visible()) return;
      void refresh(readWatch);
      timer = setInterval(() => void refresh(readWatch), intervalMs);
    };
    const unsubscribe = page.subscribe({
      visibility: resume,
      focus: () => void refresh(readWatch),
    });
    resume();
    return () => {
      pause();
      unsubscribe();
    };
  }

  return {
    refresh,
    refreshWith: (readOnce: () => Promise<T>) => runRead(readOnce, true),
    watch,
    /** A newer answer, such as an action's, applied: drops reads in flight and the failure. */
    supersede: () => {
      latest++;
      settle(false);
      recovered();
    },
    close: () => {
      closed = true;
    },
  };
}

type RefreshSchedule<T> = ReturnType<typeof createRefreshSchedule<T>>;

/**
 * Holds a refresh schedule while the calling component is mounted. It reads every `intervalMs`
 * while `watching`; `refresh` reads once at any time. The failure clears after a later success;
 * `pending` holds while a read whose answer may still apply is outstanding.
 */
export function useRefreshSchedule<T>({
  read,
  readWhileWatching = read,
  apply,
  intervalMs,
  watching = true,
}: {
  read: () => Promise<T>;
  readWhileWatching?: () => Promise<T>;
  apply: (value: T) => void;
  intervalMs: number;
  watching?: boolean;
}) {
  const [failure, setFailure] = useState<RefreshFailure | null>(null);
  const [pending, setPending] = useState(false);
  const readNow = useEffectEvent(read);
  const readWatch = useEffectEvent(readWhileWatching);
  const applyAnswer = useEffectEvent(apply);
  const schedule = useRef<RefreshSchedule<T> | null>(null);
  useEffect(() => {
    const created = createRefreshSchedule({
      read: () => readNow(),
      apply: (value: T) => applyAnswer(value),
      failed: setFailure,
      pending: setPending,
    });
    schedule.current = created;
    return () => {
      created.close();
      schedule.current = null;
    };
  }, []);
  useEffect(
    () =>
      watching ? schedule.current?.watch(intervalMs, documentPage, () => readWatch()) : undefined,
    [intervalMs, watching],
  );
  const refresh = useCallback(async () => {
    await schedule.current?.refresh();
  }, []);
  const refreshWith = useCallback(
    (read: () => Promise<T>) => schedule.current?.refreshWith(read),
    [],
  );
  const supersede = useCallback(() => schedule.current?.supersede(), []);
  return { failure, pending, refresh, refreshWith, supersede };
}
