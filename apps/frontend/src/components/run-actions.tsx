import { Archive, CircleCheck, Copy, Fingerprint, Hash, Moon, Pencil, Undo2 } from "lucide-react";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { shortcutAriaKeys } from "../keyboard-shortcuts.ts";
import { KeyChip } from "./ui/key-chip";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./ui/dropdown-menu";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RunNavigationEntry } from "@t3-factory/contracts";
import { api } from "../api.ts";
import { useMutationsAllowed } from "../client-gate.tsx";
import { useLiveNavigation } from "../live/navigation.ts";
import {
  createRunActions,
  focusStep,
  runActionAvailability,
  runCopyText,
  type FocusRequest,
  type RunActionPorts,
  type RunActionSubject,
} from "../run-actions.ts";
import { getSidebarNavigation } from "../sidebar-navigation.ts";
import { transport } from "../transport.ts";
import { ArchiveRunDialog } from "./archive-run-dialog.tsx";
import { RenameDialog } from "./rename-dialog.tsx";
import { useSettleRun } from "./settle-run.tsx";

/** The ports that live in React: the Settle confirmation, focus and the navigation they follow. */
type HostPorts = Pick<RunActionPorts, "settle" | "requestFocus" | "navigationEntry">;
let host: HostPorts | undefined;
function mountedHost() {
  if (!host) throw new Error("Run actions run only while the app shell is mounted.");
  return host;
}

export const runActions = createRunActions({
  snooze: (runId) => api.snoozeRun(runId),
  restore: (runId) => api.restoreRun(runId),
  settle: (...request) => mountedHost().settle(...request),
  mutationsAllowed: transport.acceptsMutations,
  searching: () => getSidebarNavigation().searching,
  navigationEntry: (runId) => mountedHost().navigationEntry(runId),
  requestFocus: (request) => mountedHost().requestFocus(request),
  copy: (text) => navigator.clipboard.writeText(text),
});

type RunActionsState = ReturnType<typeof runActions.getSnapshot>;

/** One part of the Run actions state; the open Run changes with every live update, so a
 * component re-renders only when its own part changes. */
export function useRunActionsState<Part>(select: (state: RunActionsState) => Part) {
  return useSyncExternalStore(runActions.subscribe, () => select(runActions.getSnapshot()));
}

/** Which actions `subject` offers now, and whether its own action is running. */
export function useRunActions(subject: RunActionSubject) {
  const mutationsAllowed = useMutationsAllowed();
  const busyRunId = useRunActionsState((state) => state.busyRunId);
  const id = subject.entry?.id ?? subject.detail?.id;
  return {
    available: runActionAvailability(subject, { mutationsAllowed, busyRunId }),
    busy: id !== undefined && busyRunId === id,
  };
}

/** Both Run menus show the same actions, availability and shortcuts. */
export function RunActionItems({
  subject,
  surface,
  returnFocusId,
}: {
  subject: RunActionSubject;
  surface: "row" | "header";
  returnFocusId: string;
}) {
  const { entry, detail } = subject;
  const lifecycle = detail?.lifecycle ?? entry?.lifecycle;
  const { available } = useRunActions(subject);
  const { bindings, hint } = useShortcutPreferences();
  const row = surface === "row";
  const Item = row ? ContextMenuItem : DropdownMenuItem;
  const Separator = row ? ContextMenuSeparator : DropdownMenuSeparator;
  const Sub = row ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = row ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = row ? ContextMenuSubContent : DropdownMenuSubContent;
  const snoozed = entry?.presentation.snoozed;
  const items = [
    ...(lifecycle === "active"
      ? ([
          {
            id: "snoozeRestore",
            label: snoozed ? "Restore" : "Snooze",
            Icon: snoozed ? Undo2 : Moon,
          },
          { id: "settle", label: "Settle", Icon: CircleCheck },
        ] as const)
      : []),
    { id: "rename", label: "Rename", Icon: Pencil },
    { id: "archive", label: "Archive…", Icon: Archive },
  ] as const;
  const copies = [
    { target: "number", label: "Run number", Icon: Hash },
    { target: "id", label: "Run ID", Icon: Fingerprint },
  ] as const;
  return items.map(({ id, label, Icon }) => (
    <Fragment key={id}>
      {id === "archive" && (
        <>
          <Sub>
            <SubTrigger className="px-2">
              <Copy aria-hidden strokeWidth={1.5} />
              Copy
            </SubTrigger>
            <SubContent className="min-w-40">
              {copies.map((copy) => (
                <Item
                  key={copy.target}
                  disabled={runCopyText(subject, copy.target) === undefined}
                  onSelect={() => void runActions.copy(subject, copy.target)}
                >
                  <copy.Icon aria-hidden strokeWidth={1.5} />
                  {copy.label}
                </Item>
              ))}
            </SubContent>
          </Sub>
          <Separator />
        </>
      )}
      <Item
        disabled={!available[id]}
        variant={id === "archive" ? "destructive" : "default"}
        aria-keyshortcuts={shortcutAriaKeys(bindings[id])}
        onSelect={() => {
          if (id === "archive" || id === "rename")
            runActions.openDialog(id, subject, returnFocusId);
          else void runActions.run(subject, id);
        }}
      >
        <Icon aria-hidden strokeWidth={1.5} />
        {label}
        {hint(id) && (
          <KeyChip aria-hidden className="ml-auto">
            {hint(id)}
          </KeyChip>
        )}
      </Item>
    </Fragment>
  ));
}

const noRuns: readonly RunNavigationEntry[] = [];

/** Mounted once in the app shell: the Settle confirmation, focus after an action, and the one
 * Archive and one Run Rename dialog. */
export function RunActionsHost() {
  const { value } = useLiveNavigation();
  const runs = value ?? noRuns;
  const requestFocus = useRunActionFocus(runs);
  const { settle, dialog: settlementDialog } = useSettleRun();
  // Reconnected after every commit, so a Settle answer reads the navigation it arrives at, which
  // tells a lagging entry from a later one.
  useLayoutEffect(() => {
    host = {
      settle,
      requestFocus,
      navigationEntry: (runId) => runs.find((run) => run.id === runId),
    };
    return () => {
      host = undefined;
    };
  });
  const dialog = useRunActionsState((state) => state.dialog);
  return (
    <>
      {settlementDialog}
      {dialog?.kind === "archive" && (
        <ArchiveRunDialog
          run={{ id: dialog.runId, title: dialog.title }}
          entry={runs.find((run) => run.id === dialog.runId)}
          open
          returnFocusId={dialog.returnFocusId}
          onOpenChange={(open) => !open && runActions.closeDialog()}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          id={dialog.runId}
          title={dialog.title}
          kind="Run"
          description="Change the title of this execution."
          onClose={runActions.closeDialog}
          save={async (title) => {
            await api.renameRun(dialog.runId, { title });
          }}
        />
      )}
    </>
  );
}

/** Focus progress belongs to the DOM interaction and does not render any UI. */
function useRunActionFocus(runs: readonly RunNavigationEntry[]) {
  const [request, setRequest] = useState<FocusRequest>();
  const pending = useRef<FocusRequest | undefined>(undefined);
  useLayoutEffect(() => {
    let focus = pending.current;
    if (!focus) return;
    const runId = focus.runId;
    const run = runs.find((candidate) => candidate.id === runId);
    if (focus.owner && !focus.ownerFocused) {
      document.getElementById(focus.owner)?.focus();
      focus = { ...focus, ownerFocused: true };
      pending.current = focus;
    }
    const step = focusStep(focus, run);
    if (step === "drop") {
      pending.current = undefined;
      return;
    }
    if (step === "stopping") {
      pending.current = { ...focus, stopping: true };
    }
    if (step === "focus") {
      const target = document.getElementById(focus.id);
      if (target) {
        if (!focus.owner || ownsFocus(focus.owner, runId)) target.focus();
        pending.current = undefined;
        return;
      }
    }
    const owner = focus.owner;
    if (!owner) return;
    // Track ownership only while this request still waits for its destination. The layout
    // effect's cleanup releases these listeners before navigation advances or replaces it.
    const tracking = new AbortController();
    const revoke = () => {
      if (pending.current?.owner === owner) {
        pending.current = undefined;
        tracking.abort();
      }
    };
    const focusIn = (event: FocusEvent) => {
      if (!closingConfirmation() && !holdsFocus(event.target, owner, runId)) revoke();
    };
    // Losing the row can drop focus to the page; only a press there revokes the request.
    const holders = `#${CSS.escape(owner)}, [data-focus-fallback="${CSS.escape(runId)}"]`;
    const press = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(holders)) revoke();
    };
    document.addEventListener("focusin", focusIn, { signal: tracking.signal });
    document.addEventListener("pointerdown", press, { capture: true, signal: tracking.signal });
    return () => tracking.abort();
  }, [request, runs]);
  return useCallback((next: FocusRequest) => {
    pending.current = next;
    setRequest(next);
  }, []);
}

/** Focus is still on the `owner` element, on the fallback of the same Run that took over when an
 * action's own control left the page, or lost to the page because its holder left. */
function ownsFocus(owner: string, runId: string) {
  const active = document.activeElement;
  return !active || active === document.body || holdsFocus(active, owner, runId);
}

/** The answered Settle confirmation is still closing. Until it unmounts and returns focus to the
 * row, its focus trap and its disabled or removed controls move focus, which is not the user
 * leaving. */
function closingConfirmation() {
  return !!document.querySelector('[role="alertdialog"][data-state="closed"]');
}

/** `element` is the `owner` element or the fallback of the same Run. */
function holdsFocus(element: EventTarget | null, owner: string, runId: string) {
  return (
    element instanceof HTMLElement &&
    (element.id === owner || element.dataset.focusFallback === runId)
  );
}
