import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NotificationPermission } from "@agent-easel/contracts/desktop-bridge";

/** Why a pending appearance has not been notified yet; it stays eligible for catch-up. */
export type DeferReason =
  | "notifications-off"
  | "permission-undetermined"
  | "permission-denied"
  | "navigation-not-ready";

/**
 * What became of one appearance (or native increase revision) of a matter. Foreground-,
 * snooze-accounted, attempted-unknown and delivered never notify again; deferred and
 * definitely-failed retry only at catch-up; resolved never notifies.
 */
export type AppearanceState =
  | { readonly state: "deferred"; readonly reason: DeferReason }
  | { readonly state: "foreground-accounted" }
  | { readonly state: "snooze-accounted" }
  | { readonly state: "attempted-unknown"; readonly notification: string }
  | { readonly state: "delivered"; readonly notification: string }
  | { readonly state: "definitely-failed"; readonly notification: string }
  | { readonly state: "resolved"; readonly notification: string | null };

export interface MatterRecord {
  readonly runId: string;
  /** The last observed native pending request count; null until one was observed. */
  count: number | null;
  /** Monotonic: each observed increase of `count` is a new revision that may notify. */
  revision: number;
  /** Keyed by revision. */
  appearances: Record<string, AppearanceState>;
}

/** What a posted notification represents, for withdrawal and routing after a relaunch. */
export interface AttentionNotificationRecord {
  readonly kind?: undefined;
  readonly runId: string;
  /** The Block when every represented matter is about the same Block. */
  readonly blockId: string | null;
  readonly matters: readonly { readonly id: string; readonly revision: number }[];
  readonly postedAt: string;
  /** Asked to leave Notification Center; withdrawal never changes the matters' accounting. */
  withdrawn: boolean;
}

export interface CompletionNotificationRecord {
  readonly kind: "completion";
  readonly runId: string;
  readonly cycle: number;
  readonly postedAt: string;
  withdrawn: boolean;
  unreferencedAtLaunch?: boolean;
}

export type NotificationRecord = AttentionNotificationRecord | CompletionNotificationRecord;

export type CompletionState =
  | { readonly state: "seen" }
  | { readonly state: "attempted-unknown"; readonly notification: string }
  | { readonly state: "delivered"; readonly notification: string }
  | { readonly state: "definitely-failed"; readonly notification: string };

export type CompletionRecord = CompletionState & { readonly cycle: number };

export interface CompletionLedger {
  baselinePending: boolean;
  runs: Record<string, CompletionRecord>;
}

export interface ServerLedger {
  matters: Record<string, MatterRecord>;
  notifications: Record<string, NotificationRecord>;
  completions?: CompletionLedger;
}

interface LedgerFile {
  readonly version: 1;
  servers: Record<string, ServerLedger>;
  permission?: NotificationPermission;
}

const fileName = "desktop-attention.json";

const notificationPermissions: readonly NotificationPermission[] = [
  "undetermined",
  "requesting",
  "granted",
  "denied",
];

const notifiedBy = (appearance: AppearanceState | CompletionState) =>
  "notification" in appearance ? appearance.notification : null;

/** Resolved history is only needed while its process can still act on it. */
function withoutResolved(ledger: ServerLedger, delivered: ReadonlySet<string>): ServerLedger {
  const matters = Object.fromEntries(
    Object.entries(ledger.matters).filter(([, record]) =>
      Object.values(record.appearances).some((appearance) => appearance.state !== "resolved"),
    ),
  );
  const referenced = new Set([
    ...Object.values(matters).flatMap((record) =>
      Object.values(record.appearances).map(notifiedBy),
    ),
    ...Object.values(ledger.completions?.runs ?? {}).map(notifiedBy),
  ]);
  const notifications = Object.fromEntries(
    Object.entries(ledger.notifications).flatMap(
      ([id, notification]): [string, NotificationRecord][] => {
        if (referenced.has(id)) return [[id, notification]];
        if (notification.kind !== "completion") return [];
        if (delivered.has(id)) return [[id, { ...notification, unreferencedAtLaunch: false }]];
        if (notification.unreferencedAtLaunch) return [];
        return [[id, { ...notification, unreferencedAtLaunch: true }]];
      },
    ),
  );
  return { ...ledger, matters, notifications };
}

function parseLedger(raw: unknown): LedgerFile | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as { version?: unknown; servers?: unknown; permission?: unknown };
  if (value.version !== 1 || typeof value.servers !== "object" || value.servers === null)
    return undefined;
  const permission = notificationPermissions.find((known) => known === value.permission);
  return {
    version: 1,
    servers: value.servers as Record<string, ServerLedger>,
    ...(permission && { permission }),
  };
}

/**
 * The persistent, per-installation attention ledger. Each change is written atomically before
 * the coordinator acts on it; a failed write leaves the previous state in memory and on disk.
 */
export class AttentionLedger {
  private observedPermission: NotificationPermission | undefined;
  private grantUnrecorded = false;

  private constructor(
    private readonly path: string,
    private data: LedgerFile,
  ) {}

  /** An unreadable file is kept beside a fresh ledger: catch-up then notifies once per Run. */
  static async open(directory: string, delivered: ReadonlySet<string>): Promise<AttentionLedger> {
    const path = join(directory, fileName);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return new AttentionLedger(path, { version: 1, servers: {} });
    }
    let parsed: LedgerFile | undefined;
    try {
      parsed = parseLedger(JSON.parse(text));
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      await rename(path, `${path}.unreadable-${Date.now()}`);
      return new AttentionLedger(path, { version: 1, servers: {} });
    }
    for (const [server, ledger] of Object.entries(parsed.servers))
      parsed.servers[server] = withoutResolved(ledger, delivered);
    return new AttentionLedger(path, parsed);
  }

  /** Forgetting a server deletes its history: reconnecting later starts fresh. */
  async forget(server: string): Promise<void> {
    await this.write(() => {
      delete this.data.servers[server];
    });
  }

  async requireCompletionBaseline(): Promise<void> {
    await this.write(() => this.requireBaseline());
  }

  async notePermission(permission: NotificationPermission): Promise<boolean> {
    const previous = this.observedPermission ?? this.data.permission;
    this.observedPermission = permission;
    this.grantUnrecorded =
      permission === "granted" &&
      (this.grantUnrecorded || (previous !== undefined && previous !== "granted"));
    if (this.data.permission === permission && !this.grantUnrecorded) return false;
    const granted = this.grantUnrecorded;
    await this.write(() => {
      this.data.permission = permission;
      if (granted) this.requireBaseline();
    });
    this.grantUnrecorded = false;
    return granted;
  }

  private requireBaseline() {
    for (const ledger of Object.values(this.data.servers))
      if (ledger.completions) ledger.completions.baselinePending = true;
  }

  /** What a notification of `server` represents, if this installation posted it for that server. */
  notification(server: string, id: string): NotificationRecord | undefined {
    return this.data.servers[server]?.notifications[id];
  }

  follows(server: string): boolean {
    return Object.hasOwn(this.data.servers, server);
  }

  /** Applies `change` to the server's ledger and persists it, or leaves everything unchanged. */
  async change<A>(server: string, change: (ledger: ServerLedger) => A): Promise<A> {
    return this.write(() =>
      change((this.data.servers[server] ??= { matters: {}, notifications: {} })),
    );
  }

  private async write<A>(change: () => A): Promise<A> {
    const before = structuredClone(this.data);
    const result = change();
    try {
      await writeFile(`${this.path}.next`, JSON.stringify(this.data) + "\n", { mode: 0o600 });
      await rename(`${this.path}.next`, this.path);
    } catch (error) {
      this.data = before;
      throw error;
    }
    return result;
  }
}
