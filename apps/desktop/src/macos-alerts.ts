import { createRequire } from "node:module";
import type { Dock } from "electron";
import type { NotificationPermission } from "@t3-factory/contracts/desktop-bridge";
import type { DesktopAlertPort } from "./attention-coordinator.ts";

/** The staged N-API module (native/notifications.mm); macOS only, never loaded by tests. */
interface NativeNotifications {
  authorizationStatus(): Promise<
    "notDetermined" | "denied" | "authorized" | "provisional" | "unknown"
  >;
  requestAuthorization(): Promise<boolean>;
  /** Resolves with macOS's refusal message, or null once Notification Center accepted it. */
  post(id: string, title: string, body: string, threadId: string): Promise<string | null>;
  remove(ids: readonly string[]): void;
  delivered(): Promise<readonly string[]>;
  bundleIdentifier(): string;
}

/** Loads the module staged beside the bundle (unpacked from asar in a package). */
export function loadNativeNotifications(path: string): NativeNotifications {
  return createRequire(import.meta.url)(path) as NativeNotifications;
}

/**
 * The thin macOS adapter. It never touches Electron's Notification API: any call into it asks
 * for permission, and Electron withdraws what it posted when the app quits. No sound and no
 * Dock bounce are ever requested.
 */
export class MacAlerts implements DesktopAlertPort {
  /** macOS reports `denied` while this installation's own request is unanswered. */
  private requesting = false;

  constructor(
    private readonly native: NativeNotifications,
    private readonly dock: Dock,
  ) {}

  async show(notification: Parameters<DesktopAlertPort["show"]>[0]) {
    const refusal = await this.native.post(
      notification.id,
      notification.title,
      notification.body,
      notification.groupId,
    );
    return refusal === null ? ({ kind: "accepted" } as const) : ({ kind: "failed" } as const);
  }

  withdraw(ids: readonly string[]) {
    this.native.remove(ids);
  }

  /** This app's page in System Settings → Notifications, where a denial can be changed. */
  get systemSettingsUrl() {
    const id = encodeURIComponent(this.native.bundleIdentifier());
    return `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${id}`;
  }

  setBadge(label: string) {
    this.dock.setBadge(label);
  }

  async permission(): Promise<NotificationPermission> {
    const status = await this.native.authorizationStatus();
    if (status === "notDetermined") return "undetermined";
    if (status === "authorized" || status === "provisional") return "granted";
    return this.requesting ? "requesting" : "denied";
  }

  async requestPermission(): Promise<NotificationPermission> {
    this.requesting = true;
    try {
      return (await this.native.requestAuthorization()) ? "granted" : "denied";
    } finally {
      this.requesting = false;
    }
  }
}
