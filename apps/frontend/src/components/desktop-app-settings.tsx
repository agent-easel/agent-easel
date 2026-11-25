import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  DesktopAlertSettings,
  DesktopResult,
  DesktopState,
  FactoryDesktop,
  NotificationPermission,
} from "@agent-easel/contracts/desktop-bridge";
import { desktopBridge } from "../desktop-bridge.ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useDesktopState } from "../desktop-state.ts";
import { AppearanceChoice } from "./appearance-choice.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { cn } from "@/lib/utils";
import { SettingsDetailRow, SettingsGroup, SettingsPage, SettingsRow } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { UpdateSettings, useSettingsUpdate } from "./update-settings.tsx";

export function DesktopAppSettings() {
  return <DesktopAppControls local={false} />;
}

function DesktopAppControls({ local }: { local: boolean }) {
  const desktop = desktopBridge();
  const state = useDesktopState();
  const update = useSettingsUpdate(local);
  const [error, setError] = useState("");
  if (!desktop || !state) return null;
  const run = async (operation: () => Promise<DesktopResult>) => {
    await operation().then(
      (result) => setError(result.ok ? "" : result.message),
      (cause: unknown) => setError(String(cause)),
    );
  };
  const controls = (
    <>
      {error && (
        <ProblemCard tone="error" title="Couldn’t change a setting" details={error}>
          Try again.
        </ProblemCard>
      )}
      {update.feedback}
      <UpdateSettings
        state={state}
        desktop={desktop}
        downloading={update.phase === "downloading"}
        onChange={(op) => void run(op)}
      />
      <SettingsGroup label="Startup">
        <SettingsRow
          title="Open in the background at login"
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              checked={state.launchAtLogin}
              onCheckedChange={(checked) => void run(() => desktop.setLaunchAtLogin(checked))}
            />
          )}
        />
        <SettingsRow
          title="Show in the menu bar"
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              checked={state.menuBarIcon}
              onCheckedChange={(checked) => void run(() => desktop.setMenuBarIcon(checked))}
            />
          )}
        />
      </SettingsGroup>
      <NotificationSettings desktop={desktop} state={state} run={run} />
      <SettingsGroup label="Role">
        <SettingsDetailRow
          label="Role"
          value={
            state.role === "server"
              ? "Runs the AgentEasel server"
              : state.role === "client"
                ? "Connected to a server"
                : "—"
          }
          action={
            state.role && (
              <Button
                variant="outline"
                onClick={() =>
                  void run(() => desktop.chooseRole(state.role === "server" ? "client" : "server"))
                }
              >
                {state.role === "server" ? "Connect to a server…" : "Run a server here…"}
              </Button>
            )
          }
        />
        {state.role === "client" && (
          <SettingsDetailRow
            label="Server"
            value={state.server ? new URL(state.server.url).host : "—"}
            action={
              <Button variant="outline" onClick={() => void run(() => desktop.forgetServer())}>
                Change server
              </Button>
            }
          />
        )}
      </SettingsGroup>
    </>
  );
  return local ? (
    <>
      <div className="flex items-center justify-between gap-2">
        {update.badge}
        {update.action}
      </div>
      {controls}
    </>
  ) : (
    <SettingsPage title="Desktop app" badge={update.badge} action={update.action}>
      {controls}
    </SettingsPage>
  );
}

const alertSwitches: readonly (readonly [keyof DesktopAlertSettings, string])[] = [
  ["dockBadge", "Dock badge"],
  ["showRunDetails", "Run details in notifications"],
];

const permissionStatus: Record<NotificationPermission, string> = {
  undetermined: "—",
  requesting: "Waiting for permission",
  granted: "Allowed",
  denied: "Not allowed",
};

function NotificationSettings({
  desktop,
  state,
  run,
}: {
  desktop: FactoryDesktop;
  state: DesktopState;
  run: (operation: () => Promise<DesktopResult>) => Promise<void>;
}) {
  const denied = state.notificationPermission === "denied";
  const notificationsOn = state.alerts.notifications;
  return (
    <>
      <SettingsGroup label="Notifications">
        <SettingsRow
          title="Notifications"
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              checked={state.alerts.notifications}
              onCheckedChange={(checked) =>
                void run(() => desktop.setAlertSetting("notifications", checked))
              }
            />
          )}
        />
        <div className={cn(!notificationsOn && "opacity-50")}>
          <SettingsRow
            title="Notify when a Run finishes"
            control={(text) => (
              <Switch
                aria-labelledby={text.title}
                checked={state.alerts.notifyRunFinished}
                disabled={!notificationsOn}
                className="disabled:opacity-100"
                onCheckedChange={(checked) =>
                  void run(() => desktop.setAlertSetting("notifyRunFinished", checked))
                }
              />
            )}
          />
        </div>
        {alertSwitches.map(([name, title]) => (
          <SettingsRow
            key={name}
            title={title}
            control={(text) => (
              <Switch
                aria-labelledby={text.title}
                checked={state.alerts[name]}
                onCheckedChange={(checked) =>
                  void run(() => desktop.setAlertSetting(name, checked))
                }
              />
            )}
          />
        ))}
        <SettingsDetailRow
          label="macOS permission"
          value={
            denied ? (
              <StatusBadge kind="attention">Not allowed</StatusBadge>
            ) : (
              permissionStatus[state.notificationPermission]
            )
          }
        />
      </SettingsGroup>
      {denied && (
        <ProblemCard
          tone="attention"
          title="macOS blocks AgentEasel’s notifications"
          action={
            <Button
              variant="outline"
              onClick={() => void run(() => desktop.openNotificationSettings())}
            >
              Open System Settings
            </Button>
          }
        >
          Allow them in System Settings.
        </ProblemCard>
      )}
    </>
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
        <DialogContent
          title="Local application settings"
          description={
            desktopBridge()
              ? "Settings and updates for this computer, available independently of the server."
              : "Settings for this browser, available independently of the server."
          }
        >
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
