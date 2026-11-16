import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  DesktopAlertSettings,
  DesktopResult,
  DesktopState,
  FactoryDesktop,
  NotificationPermission,
} from "@t3-factory/contracts/desktop-bridge";
import { desktopBridge } from "../desktop-bridge.ts";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useDesktopState } from "../desktop-state.ts";
import { AppearanceChoice } from "./appearance-choice.tsx";
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-page.tsx";
import { UpdateSettings } from "./update-settings.tsx";

/** Settings → Desktop app: everything that only applies to this desktop installation. */
export function DesktopAppSettings() {
  const state = useDesktopState();
  if (!desktopBridge() || !state) return null;
  return (
    <SettingsPage
      title="Desktop app"
      description={`Version ${state.version} for macOS (Apple Silicon).`}
    >
      <DesktopAppControls local={false} />
    </SettingsPage>
  );
}

/**
 * Updates, start-up and role of this desktop installation; the role change comes last as the
 * most consequential. `local` is the gate dialog without a usable server, where only this app
 * can be updated.
 */
function DesktopAppControls({ local }: { local: boolean }) {
  const desktop = desktopBridge();
  const state = useDesktopState();
  const [error, setError] = useState("");
  if (!desktop || !state) return null;
  const run = async (operation: () => Promise<DesktopResult>) => {
    const result = await operation();
    setError(result.ok ? "" : result.message);
  };
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <UpdateSettings state={state} local={local} />
      <SettingsGroup label="Startup">
        <SettingsRow
          title="Open Factory in the background at login"
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              checked={state.launchAtLogin}
              onCheckedChange={(checked) => void run(() => desktop.setLaunchAtLogin(checked))}
            />
          )}
        />
        <SettingsRow
          title="Show Factory in the menu bar"
          description="Adds Open Factory and Quit Factory to the macOS menu bar. The Dock icon reopens Factory either way."
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              aria-describedby={text.description}
              checked={state.menuBarIcon}
              onCheckedChange={(checked) => void run(() => desktop.setMenuBarIcon(checked))}
            />
          )}
        />
      </SettingsGroup>
      <NotificationSettings desktop={desktop} state={state} run={run} />
      <SettingsGroup label="Role">
        {state.role === "server" ? (
          <SettingsRow
            title="This computer runs the Factory server"
            description="Closing the window keeps the server running. Quit stops Factory control but never archives Runs."
            control={
              <Button
                variant="outline"
                onClick={() => void run(() => desktop.chooseRole("client"))}
              >
                Switch to Connect to a server
              </Button>
            }
          />
        ) : (
          <SettingsRow
            title={`This computer operates the server at ${state.server?.url ?? "—"}`}
            description="Closing it never stops that server."
            control={
              <>
                <Button variant="outline" onClick={() => void run(() => desktop.forgetServer())}>
                  Choose another server
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void run(() => desktop.chooseRole("server"))}
                >
                  Switch to Run a server
                </Button>
              </>
            }
          />
        )}
      </SettingsGroup>
    </>
  );
}

const alertSwitches: readonly {
  name: keyof DesktopAlertSettings;
  title: string;
  description: string;
}[] = [
  {
    name: "notifications",
    title: "Notifications",
    description:
      "A macOS notification when a Run newly needs you. None show while a Factory window is focused.",
  },
  {
    name: "dockBadge",
    title: "Dock badge",
    description: "The number of Runs that need you, also while every window is closed.",
  },
  {
    name: "showRunDetails",
    title: "Show Run details in notifications",
    description:
      "Adds the project, Run title and Block name. Message, report and question text never appear.",
  },
];

const permissionStatus: Record<NotificationPermission, string> = {
  undetermined: "macOS asks the first time Factory would show a notification.",
  requesting: "Waiting for your answer to the macOS prompt.",
  granted: "Allowed.",
  denied: "Not allowed. Factory won't ask again; the Dock badge still works.",
};

/** This installation's alert switches and macOS permission; never synchronized. */
function NotificationSettings({
  desktop,
  state,
  run,
}: {
  desktop: FactoryDesktop;
  state: DesktopState;
  run: (operation: () => Promise<DesktopResult>) => Promise<void>;
}) {
  return (
    <SettingsGroup label="Notifications">
      {alertSwitches.map(({ name, title, description }) => (
        <SettingsRow
          key={name}
          title={title}
          description={description}
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              aria-describedby={text.description}
              checked={state.alerts[name]}
              onCheckedChange={(checked) => void run(() => desktop.setAlertSetting(name, checked))}
            />
          )}
        />
      ))}
      <SettingsRow
        title="macOS permission"
        description={permissionStatus[state.notificationPermission]}
        control={
          state.notificationPermission === "denied" && (
            <Button
              variant="outline"
              onClick={() => void run(() => desktop.openNotificationSettings())}
            >
              Open System Settings
            </Button>
          )
        }
      />
    </SettingsGroup>
  );
}

/** Local controls stay available even when no server or compatible product UI is available. */
export function LocalApplicationControls() {
  const [open, setOpen] = useState(false);
  const state = useDesktopState();
  return (
    <>
      <Button className="justify-self-start" variant="secondary" onClick={() => setOpen(true)}>
        Application settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Local application settings</DialogTitle>
          <DialogDescription>
            {desktopBridge()
              ? "Settings and updates for this computer, available independently of the server."
              : "Settings for this browser, available independently of the server."}
          </DialogDescription>
          <div className="grid gap-5">
            {state && (
              <p className="text-sm text-muted-foreground">
                Version {state.version} for macOS (Apple Silicon).
              </p>
            )}
            <AppearanceChoice />
            <DesktopAppControls local />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
