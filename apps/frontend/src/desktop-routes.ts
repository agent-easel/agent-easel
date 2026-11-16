import { useEffect } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { desktopBridge } from "./desktop-bridge.ts";
import { runListView } from "./run-list-view.ts";

/**
 * Applies notification and Dock click routes from the desktop shell. Mounted in the app shell, so
 * a route chosen at launch waits behind the connection gate. Routes use ordinary navigation:
 * closing Settings or Studio still asks about unsaved edits, and leaving the New Run view keeps
 * its draft. A route never performs a Run action.
 */
export function useDesktopRoutes() {
  const navigate = useNavigate();
  const router = useRouter();
  useEffect(() => {
    const desktop = desktopBridge();
    if (!desktop) return;
    return desktop.onRoute((route) => {
      if (route.kind === "needs-you") {
        runListView.showNeedsYou();
        // The Run list shows behind no Settings or Studio.
        void navigate({ to: router.state.location.pathname, search: {}, resetScroll: false });
        return;
      }
      void navigate({
        to: "/runs/$runId",
        params: { runId: route.runId },
        search: {},
        state: { routedBlock: route.blockId },
      });
    });
  }, [navigate, router]);
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** A desktop route's Block to select in the Run it opened; null opens the Run overview. */
    routedBlock?: string | null;
  }
}
