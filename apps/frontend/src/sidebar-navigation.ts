export type VisibleSidebarRow = { kind: "run"; id: string } | { kind: "draft"; id: string };

export type SidebarNavigationSnapshot = {
  visibleRows: readonly VisibleSidebarRow[];
  /** Title search is active, so a Run action keeps focus on the Run's row. */
  searching: boolean;
  focusSearch: () => void;
};

const idle: SidebarNavigationSnapshot = {
  visibleRows: [],
  searching: false,
  focusSearch: () => undefined,
};

let snapshot = idle;
export function publishSidebarNavigation(next: SidebarNavigationSnapshot) {
  snapshot = next;
}

export function getSidebarNavigation() {
  return snapshot;
}
