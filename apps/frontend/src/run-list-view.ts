import { useSyncExternalStore } from "react";

/**
 * What the Run list shows: a title search, or the Needs you filter. They are exclusive: Needs
 * you clears the search, and typing a search ends Needs you.
 */
export type RunListView = { readonly search: string; readonly needsYou: boolean };

let view: RunListView = { search: "", needsYou: false };
const listeners = new Set<() => void>();

function change(next: RunListView) {
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const runListView = {
  search: (search: string) => change({ search, needsYou: view.needsYou && !search }),
  showNeedsYou: () => change({ search: "", needsYou: true }),
  clearNeedsYou: () => change({ ...view, needsYou: false }),
};

export function useRunListView(): RunListView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => view,
  );
}
