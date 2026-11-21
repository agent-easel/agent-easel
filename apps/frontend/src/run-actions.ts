import type { RunDetail, RunNavigationEntry, RunSettlementOutcome } from "@t3-factory/contracts";

/** The Run actions, with the ids of their shortcut and desktop menu commands. */
export type RunActionId = "snoozeRestore" | "settle" | "archive" | "rename";

/** A Run as a surface knows it: its navigation entry, its open detail, or both. */
export type RunActionSubject = {
  readonly entry?: RunNavigationEntry | undefined;
  readonly detail?: RunDetail | undefined;
};

export type RunActionAvailability = Readonly<Record<RunActionId, boolean>>;

export type RunCopyTarget = "number" | "id";

export function runCopyText({ entry, detail }: RunActionSubject, target: RunCopyTarget) {
  if (target === "id") return entry?.id ?? detail?.id;
  const number = entry?.number ?? detail?.number ?? null;
  return number === null ? undefined : `#${number}`;
}

/**
 * Keyboard shortcuts "Command behaviour": nothing for an archived Run; Snooze or restore and
 * Settle need an Active Run, Archive and Rename any other Run; every action needs mutations
 * allowed. While a Run action is running, Snooze or restore and Settle wait for it, and the busy
 * Run offers nothing. Observation being unavailable does not change availability.
 */
export function runActionAvailability(
  { entry, detail }: RunActionSubject,
  { mutationsAllowed, busyRunId }: { mutationsAllowed: boolean; busyRunId: string | undefined },
): RunActionAvailability {
  const id = entry?.id ?? detail?.id;
  const usable =
    id !== undefined && detail?.lifecycle !== "archived" && mutationsAllowed && busyRunId !== id;
  const movable = usable && entry?.lifecycle === "active" && busyRunId === undefined;
  return { snoozeRestore: movable, settle: movable, archive: usable, rename: usable };
}

/** The action a focus request follows, which tells where the Run's row moves. */
type RunMove = "snooze" | "restore" | "settle";

/** A focus request after a Run action. A Settle still stopping has an `owner`, the row it
 * focuses at once; `seen` is the Run's navigation entry when the answer arrived and `stopping`
 * whether navigation has shown it stopping since. */
export type FocusRequest = {
  readonly id: string;
  readonly runId: string;
  readonly action: RunMove | undefined;
  readonly owner?: string;
  readonly ownerFocused?: boolean;
  readonly seen?: RunNavigationEntry | undefined;
  readonly stopping?: boolean;
};

/** What a focus request does with the Run as navigation shows it: wait until the Run moved, then
 * focus. A stopping Settle's request is dropped once the Run leaves navigation, such as by
 * Archive, or navigation newer than the answer shows it neither stopping nor settled, such as
 * unresolved again; only the entry the answer arrived at may still lag behind it. */
export function focusStep(request: FocusRequest, run: RunNavigationEntry | undefined) {
  if (request.owner && request.action) {
    if (!run) return "drop";
    if (run.settlement === "stopping") return request.stopping ? "wait" : "stopping";
    const later = request.stopping || !sameSettlementState(run, request.seen);
    if (later && !moved(run, request.action)) return "drop";
  }
  return run && request.action && !moved(run, request.action) ? "wait" : "focus";
}

/** A replaced navigation snapshot gives the Run a new entry object even when nothing about it
 * changed, so only a different lifecycle or settlement counts as newer navigation. */
function sameSettlementState(run: RunNavigationEntry, seen: RunNavigationEntry | undefined) {
  return run.lifecycle === seen?.lifecycle && run.settlement === seen?.settlement;
}

/** Navigation already shows the Run where `action` puts it. */
function moved(run: RunNavigationEntry, action: RunMove) {
  if (action === "settle") return run.lifecycle === "settled";
  return run.presentation.snoozed === (action === "snooze");
}

/** The group a Run moves to, whose toggle takes focus after the row leaves the open list. */
const actionGroup = { snooze: "snoozed", settle: "settled" } as const;

type RunActionDialog = {
  readonly kind: "archive" | "rename";
  readonly runId: string;
  readonly title: string;
  /** Receives focus when the dialog closes, if it is still on the page. */
  readonly returnFocusId?: string | undefined;
};

type RunActionsState = {
  /** The Run whose Snooze, Restore or Settle request is running. */
  readonly busyRunId: string | undefined;
  readonly error: string;
  readonly dialog: RunActionDialog | undefined;
  /** The Run open in detail, which the keyboard and the desktop menu act on. */
  readonly openRun: RunActionSubject;
};

const noRun: RunActionSubject = {};

export type RunActionPorts = {
  readonly snooze: (runId: string) => Promise<unknown>;
  readonly restore: (runId: string) => Promise<unknown>;
  /** Settles after any confirmation. `requesting(false)` reports that the confirmation waits for
   * the user; `requesting(true)` and `requesting(false)` bracket each confirmed request. */
  readonly settle: (
    runId: string,
    retry: boolean,
    requesting: (running: boolean) => void,
  ) => Promise<RunSettlementOutcome | undefined>;
  readonly mutationsAllowed: () => boolean;
  /** Sidebar title search is active, so a moved Run stays in its row. */
  readonly searching: () => boolean;
  /** The Run's entry in the latest navigation. */
  readonly navigationEntry: (runId: string) => RunNavigationEntry | undefined;
  readonly requestFocus: (request: FocusRequest) => void;
  readonly copy: (text: string) => Promise<void>;
};

/** Runs Snooze, Restore and Settle and holds the Archive and Rename dialog, whichever surface asks. */
export function createRunActions(ports: RunActionPorts) {
  let state: RunActionsState = {
    busyRunId: undefined,
    error: "",
    dialog: undefined,
    openRun: noRun,
  };
  const listeners = new Set<() => void>();
  /** The `run` call whose request makes `busyRunId` busy; a confirmation answered after another
   * request started cannot clear that request's busy state. */
  let busyRequest: object | undefined;
  function update(next: Partial<RunActionsState>) {
    state = { ...state, ...next };
    for (const notify of listeners) notify();
  }
  const availability = (subject: RunActionSubject) =>
    runActionAvailability(subject, {
      mutationsAllowed: ports.mutationsAllowed(),
      busyRunId: state.busyRunId,
    });

  // A new request object also refocuses the same target after consecutive row actions. The
  // command's response can arrive before live navigation moves the row, so the request waits
  // until navigation shows the Run where the action puts it, then focuses that target.
  // A Settle still stopping workers focuses its row now and moves the Run later; by then the
  // user may have moved on, so that request focuses the destination only while focus is still
  // on the row, on that Run's fallback, or lost to the page because the holder left. Focus the
  // user moves anywhere else, or a press outside them, such as on page content, revokes it.
  async function run(subject: RunActionSubject, action: "snoozeRestore" | "settle") {
    const entry = subject.entry;
    if (!entry || !availability(subject)[action]) return;
    const move: RunMove =
      action === "settle" ? "settle" : entry.presentation.snoozed ? "restore" : "snooze";
    const searching = ports.searching();
    const request = {};
    const requesting = (running: boolean) => {
      if (running) {
        busyRequest = request;
        update({ busyRunId: entry.id });
      } else if (busyRequest === request) {
        busyRequest = undefined;
        update({ busyRunId: undefined });
      }
    };
    update({ error: "" });
    requesting(true);
    const row = `run-row-${entry.id}`;
    const operation =
      move === "settle"
        ? ports.settle(entry.id, entry.settlement === "unresolved", requesting)
        : ports[move](entry.id).then(() => undefined);
    return await operation
      .then((outcome) => {
        let focusAction: RunMove | undefined = move;
        let owner: Pick<FocusRequest, "owner" | "seen"> = {};
        if (move === "settle") {
          if (!outcome) return;
          if (outcome.outcome === "stopping")
            owner = { owner: row, seen: ports.navigationEntry(entry.id) };
          else if (outcome.outcome !== "settled") focusAction = undefined;
        }
        const id =
          searching || focusAction === "restore" || !focusAction
            ? row
            : `${actionGroup[focusAction]}-toggle`;
        ports.requestFocus({ id, runId: entry.id, action: focusAction, ...owner });
      })
      .catch((error: unknown) => {
        update({ error: error instanceof Error ? error.message : "Could not update the Run." });
      })
      .finally(() => requesting(false));
  }

  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    availability,
    run,
    /** Opens the one Archive or Rename dialog for an available Run. */
    openDialog(kind: RunActionDialog["kind"], subject: RunActionSubject, returnFocusId?: string) {
      const target = subject.entry ?? subject.detail;
      if (!target || !availability(subject)[kind]) return;
      update({ dialog: { kind, runId: target.id, title: target.title, returnFocusId } });
    },
    closeDialog: () => update({ dialog: undefined }),
    async copy(subject: RunActionSubject, target: RunCopyTarget) {
      const text = runCopyText(subject, target);
      if (text === undefined) return;
      update({ error: "" });
      try {
        await ports.copy(text);
      } catch {
        update({ error: "Copy unavailable here." });
      }
    },
    /** Declares the Run open in detail, or none once its screen closes. */
    setOpenRun: (subject: RunActionSubject | undefined) => update({ openRun: subject ?? noRun }),
  };
}
