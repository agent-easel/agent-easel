export type VisibleSidebarRow = { kind: "run"; id: string } | { kind: "draft"; id: string };

export type SidebarRunAction = "snooze" | "restore" | "settle";

export type SidebarNavigationSnapshot = {
  busy: boolean;
  visibleRows: readonly VisibleSidebarRow[];
  /** Title search is active, so a Run action keeps focus on the Run's row. */
  searching: boolean;
  focusSearch: () => void;
  actOnRun: (runId: string, action: SidebarRunAction) => void;
};

const idle: SidebarNavigationSnapshot = {
  visibleRows: [],
  searching: false,
  busy: false,
  focusSearch: () => undefined,
  actOnRun: () => undefined,
};

let snapshot = idle;
export function publishSidebarNavigation(next: SidebarNavigationSnapshot) {
  snapshot = next;
}

export function getSidebarNavigation() {
  return snapshot;
}
