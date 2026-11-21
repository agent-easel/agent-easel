/**
 * The desktop attention coordinator: every Dock badge and notification decision for this
 * installation, made from the main process's own navigation subscription and recorded in the
 * attention ledger. The macOS adapter behind `DesktopAlertPort` only carries the decisions out.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  mattersNeedingOwner,
  type RunAttentionMatter,
  type RunNavigationEntry,
} from "@t3-factory/contracts";
import type {
  DesktopAlertSettings,
  DesktopRoute,
  NotificationPermission,
} from "@t3-factory/contracts/desktop-bridge";
import {
  AttentionLedger,
  type AppearanceState,
  type DeferReason,
  type NotificationRecord,
  type ServerLedger,
} from "./attention-ledger.ts";

/** The coordinator's single output port; the macOS adapter implements it. */
export interface DesktopAlertPort {
  /**
   * Posts a new notification. Posting an existing id again would alert again, so the
   * coordinator never reuses an id and withdraws instead of updating.
   */
  show(notification: AlertNotification): Promise<ShowOutcome>;
  /** Removes delivered notifications best effort, also ones posted by an earlier process. */
  withdraw(ids: readonly string[]): void;
  /** The Dock badge text; an empty label removes the badge. Independent of permission. */
  setBadge(label: string): void;
  /** Read without a window; never prompts. */
  permission(): Promise<NotificationPermission>;
  /** Called only at the first delivery while undetermined; resolves when the owner answers. */
  requestPermission(): Promise<NotificationPermission>;
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

/**
 * One committed navigation state from the coordinator's own subscription while it is ready.
 * `fresh` marks the first state after a new snapshot, which runs catch-up.
 */
export interface AttentionDelivery {
  readonly fresh: boolean;
  readonly rows: readonly RunNavigationEntry[];
}

/**
 * The navigation input of one server selection. Once another selection or a revocation ended
 * it, everything it still reports is ignored, so it can never act for another server.
 */
export interface AttentionFeed {
  /** A committed state while the subscription is ready. */
  deliver(delivery: AttentionDelivery): Promise<void>;
  /**
   * The subscription lost readiness (offline, incompatible, a delivery gap or a stopped
   * backend): the badge clears and retained data never notifies.
   */
  notReady(): Promise<void>;
  /** The server refused this client's credential: the selection ends as at a switch. */
  revoked(): Promise<void>;
}

/**
 * The selected server's latest ready state, with the epoch it was delivered under: it counts only
 * while no selection, readiness loss or revocation happened since.
 */
type Ready = {
  readonly server: string;
  readonly rows: readonly RunNavigationEntry[];
  readonly epoch: number;
};

const badgeLimit = 99;

const titles: Record<RunAttentionMatter["presentation"], string> = {
  "needs-input": "A Run needs your input",
  problem: "A Run has a problem",
};

const waitingRuns = (rows: readonly RunNavigationEntry[]) =>
  rows.filter((row) => mattersNeedingOwner(row).length > 0);

function badgeLabel(rows: readonly RunNavigationEntry[] | undefined): string {
  if (!rows) return "";
  const counted = waitingRuns(rows).length;
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

/** The matter's revisions never accounted, plus deferred and failed ones when `retry`. */
function due(ledger: ServerLedger, runId: string, matter: RunAttentionMatter, retry: boolean) {
  const record = observeMatter(ledger, runId, matter);
  return Array.from({ length: record.revision + 1 }, (_, revision) => revision)
    .filter((revision) => {
      const state = record.appearances[revision]?.state;
      return state === undefined || (retry && retriedAtCatchUp.has(state));
    })
    .map((revision) => ({ matter, revision }));
}

/**
 * Records what this delivery observed: new appearances, native count increases and resolved
 * matters. What exists or appears while its Run is Snoozed is accounted for good, so Restore
 * shows no banner. Returns, per Run, the appearances to announce: new ones, plus deferred and
 * failed ones when `catchUp`.
 */
function observe(
  ledger: ServerLedger,
  rows: readonly RunNavigationEntry[],
  catchUp: boolean,
): Announcement[] {
  resolveMissing(ledger, rows);
  return rows.flatMap((row) => {
    if (row.lifecycle === "active" && row.presentation.snoozed) {
      for (const matter of row.attention.matters)
        account(ledger, [{ row, appearances: due(ledger, row.id, matter, true) }], {
          state: "snooze-accounted",
        });
      return [];
    }
    const appearances = mattersNeedingOwner(row).flatMap((matter) =>
      due(ledger, row.id, matter, catchUp),
    );
    return appearances.length > 0 ? [{ row, appearances }] : [];
  });
}

/**
 * Notifications to withdraw: those with a resolved matter, since a posted notification cannot
 * change quietly and is never posted again, and those none of whose matters is eligible.
 * Withdrawal leaves every appearance's accounting as it was.
 */
function withdrawable(ledger: ServerLedger, rows: readonly RunNavigationEntry[]): string[] {
  const pending = new Set(rows.flatMap((row) => row.attention.matters.map(({ id }) => id)));
  const eligible = new Set(rows.flatMap((row) => mattersNeedingOwner(row).map(({ id }) => id)));
  return withdrawWhere(
    ledger,
    ({ matters }) =>
      matters.some(({ id }) => !pending.has(id)) || !matters.some(({ id }) => eligible.has(id)),
  );
}

/** Marks the matching notifications withdrawn and returns their ids. */
function withdrawWhere(
  ledger: ServerLedger,
  matches: (notification: NotificationRecord) => boolean,
): string[] {
  return Object.entries(ledger.notifications).flatMap(([id, notification]) => {
    if (notification.withdrawn || !matches(notification)) return [];
    notification.withdrawn = true;
    return [id];
  });
}

/**
 * Generic by default. Show Run details adds the project, Run title and Block name; message,
 * report and question text and paths never appear.
 */
function content(
  { row, appearances }: Announcement,
  showRunDetails: boolean,
): Pick<AlertNotification, "title" | "body"> {
  const matters = [...new Set(appearances.map(({ matter }) => matter))];
  const first = matters[0]!;
  const details = showRunDetails
    ? [row.project.title, row.title, first.blockName].filter(Boolean).join(" · ")
    : "";
  const more = matters.length > 1 ? `+${matters.length - 1} more` : "";
  return { title: titles[first.presentation], body: [details, more].filter(Boolean).join("\n") };
}

/**
 * A notification opens its Run as it is now: at the Block while exactly one matter it announced
 * is still pending, otherwise the overview. A Run no longer in navigation (Archived or removed)
 * still opens by id, where the window shows its read-only history or that it is unavailable.
 */
function notificationRoute(
  notification: NotificationRecord,
  rows: readonly RunNavigationEntry[],
): DesktopRoute {
  const announced = new Set(notification.matters.map(({ id }) => id));
  const pending = (
    rows.find((row) => row.id === notification.runId)?.attention.matters ?? []
  ).filter(({ id }) => announced.has(id));
  return attentionRoute(notification.runId, pending);
}

function attentionRoute(
  runId: string,
  pending: RunNavigationEntry["attention"]["matters"],
): DesktopRoute {
  const matter = pending.length === 1 ? pending[0] : undefined;
  return {
    kind: "run",
    runId,
    blockId: matter?.blockId ?? null,
    ...(matter?.invocationId && { attentionId: matter.id }),
  };
}

/** One waiting Run opens (at its Block when it has one matter); several open Needs you. */
function dockRoute(rows: readonly RunNavigationEntry[]): DesktopRoute | null {
  const waiting = waitingRuns(rows);
  if (waiting.length > 1) return { kind: "needs-you" };
  const [row] = waiting;
  if (!row) return null;
  return attentionRoute(row.id, mattersNeedingOwner(row));
}

/** A click that waits for its selection's next ready state, as after a relaunch. */
type HeldClick = {
  readonly server: string;
  readonly notification: NotificationRecord;
  readonly answer: (route: DesktopRoute | null) => void;
};

const groupOf = (server: string) =>
  `factory-${createHash("sha256").update(server).digest("hex").slice(0, 16)}`;

/** Records due appearances that show no banner now: deferred ones wait for catch-up. */
function account(
  ledger: ServerLedger,
  announcements: readonly Announcement[],
  state: AppearanceState,
): AlertNotification[] {
  for (const { appearances } of announcements)
    for (const { matter, revision } of appearances)
      ledger.matters[matter.id]!.appearances[revision] = state;
  return [];
}

const deferred = (reason: DeferReason): AppearanceState => ({ state: "deferred", reason });

/** One notification per Run, recorded as attempted before the notifier is called. */
function intend(
  ledger: ServerLedger,
  server: string,
  announcements: readonly Announcement[],
  showRunDetails: boolean,
): AlertNotification[] {
  return announcements.map((announcement) => {
    const { row, appearances } = announcement;
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
      withdrawn: false,
    };
    return { id, groupId: groupOf(server), ...content(announcement, showRunDetails) };
  });
}

export class AttentionCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  /** The server whose feed is current; null with none selected or after revocation. */
  private selection: { readonly server: string } | null = null;
  /** The selection's latest delivered state; read through `ready`. */
  private latest: Ready | null = null;
  private requesting = false;
  private focused = false;
  private held: HeldClick | null = null;
  /**
   * Changes synchronously with every selection, lost readiness and revocation, before their
   * queued work runs, so an announcement can tell that its state ended while it awaited.
   */
  private epoch = 0;
  /**
   * A catch-up the selection's lost readiness voided (a fresh snapshot or a grant). The
   * selection's next valid delivery runs it, since a recovery after a gap is not a snapshot.
   */
  private owedCatchUp = false;

  private constructor(
    private readonly ledger: AttentionLedger,
    private readonly port: DesktopAlertPort,
    private settings: DesktopAlertSettings,
    /** The last observed permission, shown in Settings. */
    private observed: NotificationPermission,
    private readonly permissionChanged: (permission: NotificationPermission) => void,
  ) {}

  /** Reads permission once, without a window and without asking. */
  static async open(
    directory: string,
    port: DesktopAlertPort,
    options: {
      readonly settings: DesktopAlertSettings;
      readonly permissionChanged: (permission: NotificationPermission) => void;
    },
  ): Promise<AttentionCoordinator> {
    return new AttentionCoordinator(
      await AttentionLedger.open(directory),
      port,
      options.settings,
      await port.permission(),
      options.permissionChanged,
    );
  }

  get permission(): NotificationPermission {
    return this.observed;
  }

  /**
   * Follows `server` (null: none) and ends the previous feed, so its late deliveries are
   * ignored. The badge clears until the new feed is ready. Switching to another server withdraws
   * the previous one's notifications and keeps its ledger, so switching back replays nothing.
   */
  select(server: string | null): AttentionFeed {
    const previous = this.selection;
    const selection = server === null ? null : { server };
    this.selection = selection;
    this.epoch++;
    this.owedCatchUp = false;
    // A click held for another server never routes into this one.
    if (this.held && this.held.server !== server) this.drop();
    void this.enqueue(async () => {
      this.latest = null;
      this.showBadge();
      if (previous && previous.server !== server) await this.withdrawAll(previous.server);
    });
    const current = () => selection !== null && this.selection === selection;
    return {
      deliver: (delivery) => {
        // A delivery belongs to the readiness it arrived in; a loss before it runs voids it.
        const epoch = this.epoch;
        return this.enqueue(async () => {
          if (!current()) return;
          if (this.epoch !== epoch) {
            this.owedCatchUp ||= delivery.fresh;
            return;
          }
          this.latest = { server: selection!.server, rows: delivery.rows, epoch };
          this.showBadge();
          if (this.held?.server === selection!.server) {
            this.held.answer(notificationRoute(this.held.notification, delivery.rows));
            this.held = null;
          }
          await this.announce(this.latest, delivery.fresh);
        });
      },
      notReady: () => {
        if (current()) this.epoch++;
        return this.enqueue(async () => {
          if (!current()) return;
          this.latest = null;
          this.showBadge();
        });
      },
      revoked: () => {
        if (current()) this.epoch++;
        return this.enqueue(async () => {
          if (!current()) return;
          this.selection = null;
          this.latest = null;
          this.drop();
          this.showBadge();
          await this.withdrawAll(selection!.server);
        });
      },
    };
  }

  /**
   * A notification click: the route to open, decided from the Run's current state, or null when
   * the notification is not the current selection's. Before the subscription is ready (after a
   * relaunch) the answer waits for its next ready state; a later click or a switch to another
   * server answers it with null. The window opens regardless; nothing is ever acted on.
   */
  activate(id: string): Promise<DesktopRoute | null> {
    return new Promise((answer) => {
      void this.enqueue(async () => {
        this.drop();
        const server = this.selection?.server;
        const notification =
          server === undefined ? undefined : this.ledger.notification(server, id);
        if (!server || !notification) return answer(null);
        if (this.ready) return answer(notificationRoute(notification, this.ready.rows));
        this.held = { server, notification, answer };
      });
    });
  }

  /**
   * A Dock click. With a window open it only comes forward (null); without one, the single
   * waiting Run, Needs you for several, or null to reopen the last view.
   */
  dock(windowOpen: boolean): Promise<DesktopRoute | null> {
    return new Promise((answer) => {
      void this.enqueue(async () =>
        answer(windowOpen || !this.ready ? null : dockRoute(this.ready.rows)),
      );
    });
  }

  /** Forgetting a server withdraws its notifications and deletes its ledger. */
  forget(server: string): Promise<void> {
    return this.enqueue(async () => {
      await this.withdrawAll(server);
      await this.ledger.forget(server);
    });
  }

  /**
   * Re-reads permission without asking (on activation, resume and periodically); a newly
   * observed grant catches up on what waited.
   */
  checkPermission(): Promise<void> {
    return this.enqueue(async () => {
      if ((await this.observePermission()) && this.ready) await this.announce(this.ready, true);
    });
  }

  /** The owner changed this installation's switches; turning Notifications on catches up. */
  configure(settings: DesktopAlertSettings): Promise<void> {
    return this.enqueue(async () => {
      const enabled = settings.notifications && !this.settings.notifications;
      this.settings = settings;
      this.showBadge();
      if (enabled && this.ready) await this.announce(this.ready, true);
    });
  }

  /** Whether any Factory window of this installation is focused. */
  focus(focused: boolean) {
    this.focused = focused;
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

  /** The latest delivered state while its readiness still holds; null otherwise. */
  private get ready(): Ready | null {
    return this.latest?.epoch === this.epoch ? this.latest : null;
  }

  /** The Dock badge switch off keeps the badge clear, as does a subscription that is not ready. */
  private showBadge() {
    this.port.setBadge(this.settings.dockBadge ? badgeLabel(this.ready?.rows) : "");
  }

  private drop() {
    this.held?.answer(null);
    this.held = null;
  }

  /** Best effort: Notification Center may already have dropped some of them. */
  private async withdrawAll(server: string) {
    const ids = await this.ledger.change(server, (ledger) => withdrawWhere(ledger, () => true));
    if (ids.length > 0) this.port.withdraw(ids);
  }

  /**
   * Why due appearances show no banner now, or null to show them. A focused window accounts
   * them for good: the owner sees the Run list, and switching away never replays them.
   */
  private withheld(permission: NotificationPermission): AppearanceState | null {
    if (this.focused) return { state: "foreground-accounted" };
    if (!this.settings.notifications) return deferred("notifications-off");
    if (permission === "granted") return null;
    return deferred(permission === "denied" ? "permission-denied" : "permission-undetermined");
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.closed ? undefined : task()));
    // A failed ledger write must not stop later deliveries; it is reported and not acted on.
    this.queue = run.catch((error: unknown) =>
      process.emitWarning(`Desktop attention could not be recorded: ${String(error)}`),
    );
    return this.queue;
  }

  private async announce({ server, rows, epoch }: Ready, requested: boolean) {
    const catchUp = requested || this.owedCatchUp;
    const granted = await this.observePermission();
    const withheld = this.withheld(this.observed);
    const { due, shown, withdrawn } = await this.ledger.change(server, (ledger) => {
      const announcements = observe(ledger, rows, catchUp || granted);
      return {
        due: announcements.length > 0,
        withdrawn: withdrawable(ledger, rows),
        shown: withheld
          ? account(ledger, announcements, withheld)
          : intend(ledger, server, announcements, this.settings.showRunDetails),
      };
    });
    if (withdrawn.length > 0) this.port.withdraw(withdrawn);
    if (this.epoch !== epoch) return this.abandon(server, shown, catchUp || granted);
    if (catchUp || granted) this.owedCatchUp = false;
    // A window was focused meanwhile: the owner sees the Run list, so these count as seen.
    if (shown.length > 0 && this.focused)
      return this.unpost(server, shown, { state: "foreground-accounted" });
    // Asked only when a banner would otherwise show now, never at launch.
    const bannerWaitsForPermission =
      !this.focused && this.settings.notifications && this.observed === "undetermined";
    if (due && bannerWaitsForPermission && !this.requesting) this.request();
    for (const notification of shown) this.post(server, notification);
  }

  /**
   * The selection or readiness changed while an announcement awaited the permission read or the
   * intent write. Nothing was posted: that server's next valid delivery announces what is still
   * pending, and runs the catch-up the announcement started.
   */
  private async abandon(server: string, shown: readonly AlertNotification[], catchUp: boolean) {
    if (shown.length > 0) await this.unpost(server, shown, null);
    if (this.selection?.server === server) this.owedCatchUp ||= catchUp;
  }

  private post(server: string, notification: AlertNotification) {
    void this.port.show(notification).then(
      (outcome) => this.settle(server, notification.id, outcome),
      () => this.settle(server, notification.id, { kind: "failed" }),
    );
  }

  /**
   * Records the notifier's answer; an unanswered one stays attempted-unknown for good. One
   * accepted after it was withdrawn (its matters resolved or its selection ended meanwhile) is
   * withdrawn again.
   */
  private settle(server: string, id: string, outcome: ShowOutcome) {
    void this.enqueue(async () => {
      // Its server was forgotten meanwhile: withdraw it again and record no history for it.
      if (!this.ledger.notification(server, id)) {
        if (outcome.kind === "accepted") this.port.withdraw([id]);
        return;
      }
      const late = await this.ledger.change(server, (ledger) => {
        const notification = ledger.notifications[id];
        for (const { id: matterId, revision } of notification?.matters ?? []) {
          const record = ledger.matters[matterId];
          const appearance = record?.appearances[revision];
          if (appearance?.state !== "attempted-unknown" || appearance.notification !== id) continue;
          record!.appearances[revision] =
            outcome.kind === "accepted"
              ? { state: "delivered", notification: id }
              : { state: "definitely-failed", notification: id };
        }
        return outcome.kind === "accepted" && notification?.withdrawn === true;
      });
      if (late) this.port.withdraw([id]);
    });
  }

  /**
   * Replaces intents the notifier never received with `state`, or with no accounting at all
   * (null), so they are not lost as attempted-unknown; their notification records are dropped.
   */
  private async unpost(
    server: string,
    notifications: readonly AlertNotification[],
    state: AppearanceState | null,
  ) {
    await this.ledger.change(server, (ledger) => {
      for (const { id } of notifications) {
        for (const { id: matterId, revision } of ledger.notifications[id]?.matters ?? []) {
          const appearances = ledger.matters[matterId]!.appearances;
          if (state) appearances[revision] = state;
          else delete appearances[revision];
        }
        delete ledger.notifications[id];
      }
    });
  }

  /** Whether this read newly observed a grant. */
  private async observePermission(): Promise<boolean> {
    const previous = this.observed;
    this.observed = await this.port.permission();
    if (this.observed !== previous) this.permissionChanged(this.observed);
    return this.observed === "granted" && previous !== "granted";
  }

  /** Asked at the first delivery, never at launch; a grant catches up on what waited. */
  private request() {
    this.requesting = true;
    const answered = this.port.requestPermission();
    // Settings shows the unanswered prompt; the answer is read back like any re-check.
    void this.checkPermission();
    void answered.then(() => {
      this.requesting = false;
      return this.checkPermission();
    });
  }
}
