/**
 * The desktop attention coordinator: every Dock badge and notification decision for this
 * installation, made from the main process's own navigation subscription and recorded in the
 * attention ledger. The macOS adapter behind `DesktopAlertPort` only carries the decisions out.
 */
import { createHash, randomUUID } from "node:crypto";
import type { RunAttentionMatter, RunNavigationEntry } from "@t3-factory/contracts";
import { AttentionLedger, type DeferReason, type ServerLedger } from "./attention-ledger.ts";

/** The coordinator's single output port; the macOS adapter implements it. */
export interface DesktopAlertPort {
  /**
   * Posts a new notification. Posting an existing id again would alert again, so the
   * coordinator never reuses an id and withdraws instead of updating.
   */
  show(notification: AlertNotification): Promise<ShowOutcome>;
  /** The Dock badge text; an empty label removes the badge. Independent of permission. */
  setBadge(label: string): void;
  /** Read without a window; never prompts. */
  permission(): Promise<PermissionState>;
  /** Called only at the first delivery while undetermined; resolves when the owner answers. */
  requestPermission(): Promise<PermissionState>;
}

export interface AlertNotification {
  /** Never reused for another notification. */
  readonly id: string;
  /** One thread per server, so a selection boundary can withdraw that server's notifications. */
  readonly groupId: string;
  readonly title: string;
  readonly body: string;
}

/** `accepted` means delivered to Notification Center, not that a banner was seen. */
export type ShowOutcome = { readonly kind: "accepted" } | { readonly kind: "failed" };

/** `requesting`: this installation's request is unanswered; macOS reports `denied` meanwhile. */
export type PermissionState = "undetermined" | "requesting" | "granted" | "denied";

/**
 * One committed navigation state from the coordinator's own subscription while it is ready.
 * `fresh` marks the first state after a new snapshot, which runs catch-up.
 */
export interface AttentionDelivery {
  /** The selected server's identity; the ledger is kept per server. */
  readonly server: string;
  readonly fresh: boolean;
  readonly rows: readonly RunNavigationEntry[];
}

const badgeLimit = 99;

const titles: Record<RunAttentionMatter["presentation"], string> = {
  "needs-input": "A Run needs your input",
  problem: "A Run has a problem",
};

/** Matters that count for the badge and may notify. */
function eligibleMatters(row: RunNavigationEntry): readonly RunAttentionMatter[] {
  return row.lifecycle === "active" ? row.attention.matters : [];
}

function badgeLabel(rows: readonly RunNavigationEntry[]): string {
  const counted = rows.filter((row) => eligibleMatters(row).length > 0).length;
  if (counted === 0) return "";
  return counted > badgeLimit ? `${badgeLimit}+` : String(counted);
}

type Appearance = { readonly matter: RunAttentionMatter; readonly revision: number };

/** One Run's appearances that a delivery would announce together. */
type Announcement = { readonly row: RunNavigationEntry; readonly appearances: Appearance[] };

/** Every appearance of a matter that is no longer pending is resolved and never notifies. */
function resolveMissing(ledger: ServerLedger, rows: readonly RunNavigationEntry[]) {
  const pending = new Set(rows.flatMap((row) => row.attention.matters.map((matter) => matter.id)));
  for (const [id, record] of Object.entries(ledger.matters)) {
    if (pending.has(id)) continue;
    for (const [revision, appearance] of Object.entries(record.appearances))
      if (appearance.state !== "resolved")
        record.appearances[revision] = {
          state: "resolved",
          notification: "notification" in appearance ? appearance.notification : null,
        };
  }
}

/** The matter's record after this observation; a native count increase is a new revision. */
function observeMatter(ledger: ServerLedger, runId: string, matter: RunAttentionMatter) {
  const count = matter.pendingRequestCount;
  const record = ledger.matters[matter.id];
  if (!record) return (ledger.matters[matter.id] = { runId, count, revision: 0, appearances: {} });
  if (count === null) return record;
  // A decrease only lowers the baseline, so 1, 2, 1, 2 is two increases.
  if (record.count !== null && count > record.count) record.revision++;
  record.count = count;
  return record;
}

const retriedAtCatchUp = new Set(["deferred", "definitely-failed"]);

/**
 * Records what this delivery observed: new appearances, native count increases and resolved
 * matters. Returns, per Run, the appearances to announce: new ones, plus deferred and failed
 * ones when `catchUp`.
 */
function observe(
  ledger: ServerLedger,
  rows: readonly RunNavigationEntry[],
  catchUp: boolean,
): Announcement[] {
  resolveMissing(ledger, rows);
  return rows.flatMap((row) => {
    const appearances = eligibleMatters(row).flatMap((matter) => {
      const record = observeMatter(ledger, row.id, matter);
      return Array.from({ length: record.revision + 1 }, (_, revision) => revision)
        .filter((revision) => {
          const state = record.appearances[revision]?.state;
          return state === undefined || (catchUp && retriedAtCatchUp.has(state));
        })
        .map((revision) => ({ matter, revision }));
    });
    return appearances.length > 0 ? [{ row, appearances }] : [];
  });
}

/** Generic by default: never message, report or question text, Run titles or paths. */
function content(appearances: readonly Appearance[]): Pick<AlertNotification, "title" | "body"> {
  const matters = [...new Set(appearances.map(({ matter }) => matter))];
  return {
    title: titles[matters[0]!.presentation],
    body: matters.length > 1 ? `+${matters.length - 1} more` : "",
  };
}

const groupOf = (server: string) =>
  `factory-${createHash("sha256").update(server).digest("hex").slice(0, 16)}`;

/** Without permission every due appearance waits for catch-up. */
function defer(
  ledger: ServerLedger,
  announcements: readonly Announcement[],
  permission: Exclude<PermissionState, "granted">,
): AlertNotification[] {
  const reason: DeferReason =
    permission === "denied" ? "permission-denied" : "permission-undetermined";
  for (const { appearances } of announcements)
    for (const { matter, revision } of appearances)
      ledger.matters[matter.id]!.appearances[revision] = { state: "deferred", reason };
  return [];
}

/** One notification per Run, recorded as attempted before the notifier is called. */
function intend(
  ledger: ServerLedger,
  server: string,
  announcements: readonly Announcement[],
): AlertNotification[] {
  return announcements.map(({ row, appearances }) => {
    const id = randomUUID();
    for (const { matter, revision } of appearances)
      ledger.matters[matter.id]!.appearances[revision] = {
        state: "attempted-unknown",
        notification: id,
      };
    const blocks = new Set(appearances.map(({ matter }) => matter.blockId));
    ledger.notifications[id] = {
      runId: row.id,
      blockId: blocks.size === 1 ? [...blocks][0]! : null,
      matters: appearances.map(({ matter, revision }) => ({ id: matter.id, revision })),
      postedAt: new Date().toISOString(),
    };
    return { id, groupId: groupOf(server), ...content(appearances) };
  });
}

export class AttentionCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  /** The latest ready delivery; null while the subscription is not ready. */
  private latest: AttentionDelivery | null = null;
  private requesting = false;

  private constructor(
    private readonly ledger: AttentionLedger,
    private readonly port: DesktopAlertPort,
  ) {}

  static async open(directory: string, port: DesktopAlertPort): Promise<AttentionCoordinator> {
    return new AttentionCoordinator(await AttentionLedger.open(directory), port);
  }

  /** A committed state from the coordinator's subscription while it is ready. */
  deliver(delivery: AttentionDelivery): Promise<void> {
    return this.enqueue(async () => {
      this.latest = delivery;
      this.port.setBadge(badgeLabel(delivery.rows));
      await this.announce(delivery, delivery.fresh);
    });
  }

  /**
   * The subscription lost readiness (offline, incompatible, unauthorized, a delivery gap or a
   * stopped backend): the badge clears and retained data never notifies.
   */
  notReady(): Promise<void> {
    return this.enqueue(async () => {
      this.latest = null;
      this.port.setBadge("");
    });
  }

  /** Waits for recorded decisions; a notifier that never answers is not awaited. */
  async close(): Promise<void> {
    // Settled answers enqueue their records while earlier tasks finish.
    let drained: Promise<void>;
    do {
      drained = this.queue;
      await drained;
    } while (drained !== this.queue);
    this.closed = true;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.closed ? undefined : task()));
    // A failed ledger write must not stop later deliveries; it is reported and not acted on.
    this.queue = run.catch((error: unknown) =>
      process.emitWarning(`Desktop attention could not be recorded: ${String(error)}`),
    );
    return this.queue;
  }

  private async announce(delivery: AttentionDelivery, catchUp: boolean) {
    const { server } = delivery;
    const permission = await this.port.permission();
    const { due, notifications } = await this.ledger.change(server, (ledger) => {
      const announcements = observe(ledger, delivery.rows, catchUp);
      return {
        due: announcements.length > 0,
        notifications:
          permission === "granted"
            ? intend(ledger, server, announcements)
            : defer(ledger, announcements, permission),
      };
    });
    if (due && permission === "undetermined" && !this.requesting) this.request();
    for (const notification of notifications)
      void this.port.show(notification).then(
        (outcome) => this.settle(server, notification.id, outcome),
        () => this.settle(server, notification.id, { kind: "failed" }),
      );
  }

  /** Records the notifier's answer; an unanswered one stays attempted-unknown for good. */
  private settle(server: string, id: string, outcome: ShowOutcome) {
    void this.enqueue(() =>
      this.ledger.change(server, (ledger) => {
        for (const { id: matterId, revision } of ledger.notifications[id]?.matters ?? []) {
          const record = ledger.matters[matterId];
          const appearance = record?.appearances[revision];
          if (appearance?.state !== "attempted-unknown" || appearance.notification !== id) continue;
          record!.appearances[revision] =
            outcome.kind === "accepted"
              ? { state: "delivered", notification: id }
              : { state: "definitely-failed", notification: id };
        }
      }),
    );
  }

  /** Asked at the first delivery, never at launch; a grant catches up on what waited. */
  private request() {
    this.requesting = true;
    void this.port.requestPermission().then((answer) => {
      this.requesting = false;
      if (answer !== "granted") return;
      void this.enqueue(async () => {
        if (this.latest) await this.announce(this.latest, true);
      });
    });
  }
}
