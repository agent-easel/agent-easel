import { Outlet, useLocation } from "@tanstack/react-router";
import { RunSidebar } from "./run-sidebar.tsx";
import { RunActionsHost } from "./run-actions.tsx";
import { SidebarFooter } from "./sidebar-footer.tsx";
import { AgentEaselNotice } from "./agenteasel-notice.tsx";
import { SettingsModal } from "./settings-modal.tsx";
import { Page, PageHeader } from "./page.tsx";
import { StudioModal } from "./studio-modal.tsx";
import { useStudio, useSettings } from "../settings-navigation.ts";
import { KeyboardCommandsProvider } from "../keyboard-commands.tsx";
import { DesktopTitlebar } from "./desktop-titlebar.tsx";
import { PanelResizeHandle, type PanelBounds } from "./panel-resize.tsx";
import { useDesktopRoutes } from "../desktop-routes.ts";

const sidebarBounds: PanelBounds = {
  variable: "--factory-sidebar-width",
  storageKey: "factory.sidebarWidth",
  min: 224,
  max: 480,
};

function AppShell() {
  const path = useLocation({ select: (location) => location.pathname });
  const studio = useStudio();
  const settings = useSettings();
  const backgroundInert = !!studio || !!settings;
  useDesktopRoutes();
  return (
    <div className="flex h-dvh">
      <aside className="@container/sidebar relative flex w-[var(--factory-sidebar-width,17.5rem)] max-w-[50vw] shrink-0 flex-col min-h-0 border-r bg-sidebar min-[1280px]:w-[var(--factory-sidebar-width,18.75rem)] max-sm:w-[var(--factory-sidebar-width,14rem)]">
        <DesktopTitlebar />
        <RunSidebar path={path} />
        <AgentEaselNotice />
        <SidebarFooter />
        <PanelResizeHandle label="Resize sidebar" side="right" bounds={sidebarBounds} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-app-main
          tabIndex={-1}
          inert={backgroundInert}
          className="min-h-0 flex-1 overflow-auto outline-none"
        >
          <Outlet />
        </div>
      </div>
      {studio && <StudioModal selection={studio} />}
      {settings && <SettingsModal />}
      <RunActionsHost />
    </div>
  );
}

export function AppLayout() {
  return (
    <KeyboardCommandsProvider>
      <AppShell />
    </KeyboardCommandsProvider>
  );
}

export function NotFoundPage() {
  const path = useLocation({ select: (location) => location.pathname });
  return (
    <Page>
      <PageHeader
        eyebrow="Workspace"
        title="Page not found"
        description="Choose a page from the navigation."
      />
      <p className="text-sm text-muted-foreground">No route matches {path}.</p>
    </Page>
  );
}
