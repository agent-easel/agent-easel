import type { TestContext } from "@effect/vitest";
import type { DesktopAlertSettings } from "@t3-factory/contracts/desktop-bridge";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttentionCoordinator,
  type AlertNotification,
  type DesktopAlertPort,
} from "../../../desktop/src/attention-coordinator.ts";
import {
  AttentionSubscription,
  type AttentionSelection,
} from "../../../desktop/src/attention-subscription.ts";

/** The Dock and Notification Center as a desktop installation's coordinator drives them. */
function recordingAlerts() {
  const shown: AlertNotification[] = [];
  const withdrawn: string[] = [];
  const badges: string[] = [];
  const waiters = new Set<() => void>();
  const changed = () => {
    for (const wake of waiters) wake();
  };
  const port: DesktopAlertPort = {
    show: (notification) => {
      shown.push(notification);
      changed();
      return Promise.resolve({ kind: "accepted" });
    },
    withdraw: (ids) => {
      withdrawn.push(...ids);
      changed();
    },
    setBadge: (label) => {
      badges.push(label);
      changed();
    },
    permission: () => Promise.resolve("granted"),
    requestPermission: () => Promise.resolve("granted"),
  };
  return {
    port,
    shown,
    withdrawn,
    badges,
    /** Resolves once `condition` holds for what the installation has shown. */
    until(condition: () => boolean): Promise<void> {
      return new Promise((resolve) => {
        const check = () => {
          if (!condition()) return;
          waiters.delete(check);
          resolve();
        };
        waiters.add(check);
        check();
      });
    },
  };
}

/**
 * One desktop installation's coordinator, following `selection` with its own subscription.
 * `follow` and `forget` act as the shell does on a selection change and on Forget server.
 */
export async function desktopAttention(
  context: TestContext,
  selection: AttentionSelection,
  settings: Partial<DesktopAlertSettings> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "t3-factory-desktop-attention-"));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const alerts = recordingAlerts();
  const coordinator = await AttentionCoordinator.open(directory, alerts.port, {
    settings: {
      notifications: true,
      notifyRunFinished: false,
      dockBadge: true,
      showRunDetails: false,
      ...settings,
    },
    permissionChanged: () => undefined,
  });
  const subscription = new AttentionSubscription(coordinator);
  context.onTestFinished(async () => {
    subscription.stop();
    await coordinator.close();
  });
  subscription.follow(selection);
  return {
    ...alerts,
    follow: (next: AttentionSelection | null) => subscription.follow(next),
    async forget(server: string) {
      subscription.follow(null);
      await coordinator.forget(server);
    },
  };
}
