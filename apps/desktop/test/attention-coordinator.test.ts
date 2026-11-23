import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunAttentionMatter, RunNavigationEntry } from "@t3-factory/contracts";
import type {
  DesktopAlertSettings,
  NotificationPermission,
} from "@t3-factory/contracts/desktop-bridge";
import { expect, it, vi, type TestContext } from "vite-plus/test";
import {
  AttentionCoordinator,
  type AlertNotification,
  type DesktopAlertPort,
  type ShowOutcome,
} from "../src/attention-coordinator.ts";

const server = "host";

/** Records what the outside world sees; `show` answers as `answer` decides. */
function recordingPort(permission: NotificationPermission = "granted") {
  const port = {
    shown: [] as AlertNotification[],
    withdrawn: [] as string[],
    badge: "",
    permission,
    requests: 0,
    answer: (): Promise<ShowOutcome> => Promise.resolve({ kind: "accepted" }),
    grant: (_state: NotificationPermission) => undefined as void,
  };
  const implementation: DesktopAlertPort = {
    show: (notification) => {
      port.shown.push(notification);
      return port.answer();
    },
    withdraw: (ids) => {
      port.withdrawn.push(...ids);
    },
    setBadge: (label) => {
      port.badge = label;
    },
    permission: () => Promise.resolve(port.permission),
    requestPermission: () => {
      port.requests++;
      port.permission = "requesting";
      return new Promise((resolve) => {
        port.grant = (state) => {
          port.permission = state;
          resolve(state);
        };
      });
    },
  };
  return Object.assign(port, { implementation });
}

const defaultSettings: DesktopAlertSettings = {
  notifications: true,
  notifyRunFinished: false,
  dockBadge: true,
  showRunDetails: false,
};

async function installation(
  context: TestContext,
  port = recordingPort(),
  settings: Partial<DesktopAlertSettings> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "factory-desktop-attention-"));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const options = { settings: { ...defaultSettings, ...settings }, permissionChanged: () => {} };
  let coordinator = await AttentionCoordinator.open(directory, port.implementation, options);
  let feed = coordinator.select(server);
  context.onTestFinished(() => coordinator.close());
  return {
    port,
    get coordinator() {
      return coordinator;
    },
    /** The selected server's navigation input. */
    get feed() {
      return feed;
    },
    /** Quit and launch again: the same profile directory, a new coordinator. */
    async restart() {
      await coordinator.close();
      coordinator = await AttentionCoordinator.open(directory, port.implementation, options);
      feed = coordinator.select(server);
    },
  };
}

const matter = (id: string, fields: Partial<RunAttentionMatter> = {}): RunAttentionMatter => ({
  id,
  kind: "human",
  presentation: "needs-input",
  blockId: "review",
  occurrenceId: id,
  nativeRequestId: null,
  pendingRequestCount: null,
  blockName: "Review",
  ...fields,
});

const problem = (id: string) =>
  matter(id, { kind: "execution-failed", presentation: "problem", occurrenceId: null });

const nativeRequest = (id: string, pendingRequestCount: number) =>
  matter(id, {
    kind: "native-request",
    occurrenceId: null,
    nativeRequestId: id,
    pendingRequestCount,
  });

function run(
  id: string,
  matters: readonly RunAttentionMatter[],
  fields: Partial<RunNavigationEntry> = {},
): RunNavigationEntry {
  return {
    id,
    number: 1,
    title: `Run ${id}`,
    titleProvenance: "manual",
    titleGeneration: null,
    createdAt: "2026-11-15T08:00:00.000Z",
    lastActivityAt: "2026-11-15T08:00:00.000Z",
    flowName: "Flow",
    origin: null,
    repositories: [],
    creationKey: id,
    project: {
      id: "project",
      title: "Project",
      workspaceRoot: "/Users/owner/project",
      availability: "available",
      projectIcon: null,
      faviconUrl: null,
    },
    lifecycle: "active",
    settlement: null,
    settledCycle: null,
    settledReason: null,
    endingName: null,
    pendingWork: false,
    blocks: [],
    attention: {
      needsInput: matters.some((entry) => entry.presentation === "needs-input"),
      problem: matters.some((entry) => entry.presentation === "problem"),
      matters,
    },
    presentation: { snoozed: false, woke: false },
    ...fields,
  };
}

it("the Dock badge counts Runs with pending matters, not matters, and leaves out Settled Runs", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);

  // Act
  await feed.deliver({
    fresh: true,
    rows: [
      run("a", [matter("a1"), matter("a2"), problem("a3")]),
      run("b", [problem("b1")]),
      run("c", []),
      run("d", [matter("d1")], { lifecycle: "settled" }),
    ],
  });

  // Assert
  expect(port.badge).toBe("2");
});

it("more than 99 waiting Runs show 99+ on the Dock badge", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const rows = Array.from({ length: 100 }, (_, index) => run(`r${index}`, [problem(`p${index}`)]));

  // Act
  await feed.deliver({ fresh: true, rows });

  // Assert
  expect(port.badge).toBe("99+");
});

it("the Dock badge disappears once the last pending matter resolves", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", [])] });

  // Assert
  expect(port.badge).toBe("");
});

it("matters arriving together on one Run share one banner, and a later matter gets its own", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({
    fresh: false,
    rows: [run("a", [matter("a1"), matter("a2"), problem("a3")])],
  });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [run("a", [matter("a1"), matter("a2"), problem("a3"), problem("a4")])],
  });

  // Assert
  expect(port.shown.map(({ title, body }) => ({ title, body }))).toStrictEqual([
    { title: "A Run needs your input", body: "+2 more" },
    { title: "A Run has a problem", body: "" },
  ]);
});

it("a native question count of 1, 2, 1, 2 alerts once for each increase", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const counted = (count: number) => [run("a", [nativeRequest("n1", count)])];
  await feed.deliver({ fresh: true, rows: counted(1) });
  await feed.deliver({ fresh: false, rows: counted(2) });
  await feed.deliver({ fresh: false, rows: counted(1) });

  // Act
  await feed.deliver({ fresh: false, rows: counted(2) });

  // Assert
  expect(port.shown).toHaveLength(3);
});

it("a notification says only whether a Run needs input or has a problem", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const secret = run("a", [problem("a1")], {
    title: "Rotate the key in /Users/owner/secrets.txt",
    flowName: "Private Flow",
  });

  // Act
  await feed.deliver({ fresh: true, rows: [secret] });

  // Assert
  expect(port.shown).toStrictEqual([
    { id: expect.any(String), groupId: expect.any(String), title: "A Run has a problem", body: "" },
  ]);
});

it("losing readiness clears the badge and retained matters never notify", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await feed.notReady();

  // Assert
  expect(port.badge).toBe("");
  expect(port.shown).toHaveLength(1);
});

it("after a restart each Run with still-pending matters that were never accounted shows one banner", async (c) => {
  // Arrange
  const profile = await installation(c);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();

  // Act
  await profile.feed.deliver({
    fresh: true,
    rows: [run("a", [matter("a1"), matter("a2")]), run("b", [matter("b1"), problem("b2")])],
  });

  // Assert
  expect(profile.port.shown.map(({ body }) => body)).toStrictEqual(["", "", "+1 more"]);
});

it("a matter that waited for permission and resolved while Factory was away never notifies", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort("denied"));
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();
  profile.port.permission = "granted";

  // Act
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });

  // Assert
  expect(profile.port.shown).toStrictEqual([]);
});

it("a notifier that never answered before a restart is not repeated", async (c) => {
  // Arrange
  const profile = await installation(c);
  profile.port.answer = () => new Promise(() => undefined);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();

  // Act
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(profile.port.shown).toHaveLength(1);
});

it("a rejected notification is retried at the next catch-up, not on later changes", async (c) => {
  // Arrange
  const profile = await installation(c);
  profile.port.answer = () => Promise.resolve({ kind: "failed" });
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });
  await profile.restart();
  profile.port.answer = () => Promise.resolve({ kind: "accepted" });

  // Act
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(profile.port.shown).toHaveLength(2);
});

it("permission is asked at the first banner, not at launch, and the banner follows the grant", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort("undetermined"));
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  const asked = port.requests;
  await feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });

  // Act
  port.grant("granted");
  await coordinator.close();

  // Assert
  expect({ asked, shown: port.shown.length }).toStrictEqual({ asked: 0, shown: 1 });
});

it("turning Notifications on shows one catch-up banner per Run for what waited while they were off", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort(), {
    notifications: false,
  });
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({
    fresh: false,
    rows: [run("a", [matter("a1"), problem("a2")]), run("b", [matter("b1")])],
  });
  const whileOff = port.shown.length;

  // Act
  await coordinator.configure({ ...defaultSettings, notifications: true });

  // Assert
  expect({ whileOff, bodies: port.shown.map(({ body }) => body) }).toStrictEqual({
    whileOff: 0,
    bodies: ["+1 more", ""],
  });
});

it("turning the Dock badge off clears it while Runs still need the owner", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await coordinator.configure({ ...defaultSettings, dockBadge: false });

  // Assert
  expect(port.badge).toBe("");
});

it("with Run details shown a notification adds the project, Run title and Block name and nothing else", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), { showRunDetails: true });
  const detailed = run("a", [matter("a1"), problem("a2")], {
    title: "Release notes",
    flowName: "Private Flow",
  });

  // Act
  await feed.deliver({ fresh: true, rows: [detailed] });

  // Assert
  expect(port.shown).toStrictEqual([
    {
      id: expect.any(String),
      groupId: expect.any(String),
      title: "A Run needs your input",
      body: "Project · Release notes · Review\n+1 more",
    },
  ]);
});

it("matters that arrived while a Factory window was focused never alert after switching away", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  coordinator.focus(true);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });
  const whileFocused = port.shown.length;
  coordinator.focus(false);

  // Act
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ whileFocused, shown: port.shown.length, badge: port.badge }).toStrictEqual({
    whileFocused: 0,
    shown: 0,
    badge: "1",
  });
});

it("with notification permission denied the Dock badge still counts and Factory never asks again", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort("denied"));

  // Act
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ badge: port.badge, shown: port.shown.length, requests: port.requests }).toStrictEqual({
    badge: "1",
    shown: 0,
    requests: 0,
  });
});

it("a permission grant noticed by a re-check shows one catch-up banner per Run", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort("denied"));
  await feed.deliver({
    fresh: true,
    rows: [run("a", [matter("a1"), matter("a2")]), run("b", [problem("b1")])],
  });
  port.permission = "granted";

  // Act
  await coordinator.checkPermission();

  // Assert
  expect(port.shown.map(({ title, body }) => ({ title, body }))).toStrictEqual([
    { title: "A Run needs your input", body: "+1 more" },
    { title: "A Run has a problem", body: "" },
  ]);
});

it("matters first seen while a Run is Snoozed never alert and keep it off the Dock badge", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const snoozed = { presentation: { snoozed: true, woke: false } };

  // Act
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), problem("a2")], snoozed)] });

  // Assert
  expect({ shown: port.shown.length, badge: port.badge }).toStrictEqual({ shown: 0, badge: "" });
});

it("Restore puts a Snoozed Run back on the Dock badge without a banner", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const matters = [matter("a1"), problem("a2")];
  await feed.deliver({
    fresh: true,
    rows: [run("a", matters, { presentation: { snoozed: true, woke: false } })],
  });

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", matters)] });

  // Assert
  expect({ shown: port.shown.length, badge: port.badge }).toStrictEqual({ shown: 0, badge: "1" });
});

it("new attention wakes a Snoozed Run and alerts only for the new matter", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({
    fresh: true,
    rows: [run("a", [matter("a1")], { presentation: { snoozed: true, woke: false } })],
  });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [
      run("a", [matter("a1"), problem("a2")], { presentation: { snoozed: false, woke: true } }),
    ],
  });

  // Assert
  expect(port.shown.map(({ title, body }) => ({ title, body }))).toStrictEqual([
    { title: "A Run has a problem", body: "" },
  ]);
});

it("Snoozing a Run withdraws its delivered banner", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [run("a", [matter("a1")], { presentation: { snoozed: true, woke: false } })],
  });

  // Assert
  expect(port.withdrawn).toStrictEqual(port.shown.map(({ id }) => id));
});

it("a banner is withdrawn without a new alert once every matter it announced resolves", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), problem("a2")])] });

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", [])] });

  // Assert
  expect({ shown: port.shown.length, withdrawn: port.withdrawn }).toStrictEqual({
    shown: 1,
    withdrawn: [port.shown[0]!.id],
  });
});

it("a banner whose matters partly resolve is withdrawn, not reposted, and its Run still counts", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), problem("a2")])] });

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", [problem("a2")])] });

  // Assert
  expect({ shown: port.shown.length, withdrawn: port.withdrawn, badge: port.badge }).toStrictEqual({
    shown: 1,
    withdrawn: [port.shown[0]!.id],
    badge: "1",
  });
});

it("a Settle hold withdraws and uncounts Human and native matters while its Problem still alerts", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  const waiting = [matter("a1"), nativeRequest("n1", 1)];
  await feed.deliver({ fresh: true, rows: [run("a", waiting)] });
  const unresolved = matter("s1", {
    kind: "settlement-unresolved",
    presentation: "problem",
    blockId: null,
    occurrenceId: null,
    blockName: null,
  });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [
      run("a", [...waiting, unresolved], { settlement: "unresolved" }),
      run("b", [matter("b1")], { settlement: "stopping" }),
    ],
  });

  // Assert
  expect({
    titles: port.shown.map(({ title }) => title),
    withdrawn: port.withdrawn,
    badge: port.badge,
  }).toStrictEqual({
    titles: ["A Run needs your input", "A Run has a problem"],
    withdrawn: [port.shown[0]!.id],
    badge: "1",
  });
});

it("switching server clears the badge, withdraws its banners and ignores its late deliveries", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  coordinator.select("other");

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", [matter("a1"), matter("a2")])] });

  // Assert
  expect({ shown: port.shown.length, withdrawn: port.withdrawn, badge: port.badge }).toStrictEqual({
    shown: 1,
    withdrawn: [port.shown[0]!.id],
    badge: "",
  });
});

it("revocation clears the badge, withdraws the server's banners and ignores its later deliveries", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await feed.revoked();

  // Act
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), matter("a2")])] });

  // Assert
  expect({ shown: port.shown.length, withdrawn: port.withdrawn, badge: port.badge }).toStrictEqual({
    shown: 1,
    withdrawn: [port.shown[0]!.id],
    badge: "",
  });
});

it("switching back to a server without forgetting it does not replay its alerts", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  coordinator.select("other");
  const back = coordinator.select(server);

  // Act
  await back.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ shown: port.shown.length, badge: port.badge }).toStrictEqual({ shown: 1, badge: "1" });
});

it("a banner Notification Center accepts after its server selection ended is withdrawn again", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  let accept = () => undefined as void;
  port.answer = () =>
    new Promise((resolve) => {
      accept = () => resolve({ kind: "accepted" });
    });
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await coordinator.select("other").notReady();

  // Act
  accept();
  await coordinator.close();

  // Assert
  expect(port.withdrawn).toStrictEqual([port.shown[0]!.id, port.shown[0]!.id]);
});

it("a banner whose server selection ended while it was being recorded is never posted, and that server catches it up later", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  let grant = () => undefined as void;
  const reading = new Promise<void>((started) => {
    port.implementation.permission = () =>
      new Promise((resolve) => {
        grant = () => resolve("granted");
        started();
      });
  });
  const delivered = feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await reading;
  coordinator.select("other");
  grant();
  await delivered;
  port.implementation.permission = () => Promise.resolve("granted");
  const shownForEndedSelection = port.shown.length;

  // Act
  await coordinator.select(server).deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ shownForEndedSelection, shown: port.shown.length }).toStrictEqual({
    shownForEndedSelection: 0,
    shown: 1,
  });
});

it("a banner interrupted by a delivery gap shows once navigation is current again", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  let grant = () => undefined as void;
  const reading = new Promise<void>((started) => {
    port.implementation.permission = () =>
      new Promise((resolve) => {
        grant = () => resolve("granted");
        started();
      });
  });
  const delivered = feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });
  await reading;
  void feed.notReady();
  grant();
  await delivered;
  port.implementation.permission = () => Promise.resolve("granted");
  const shownDuringGap = port.shown.length;

  // Act
  await feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ shownDuringGap, shown: port.shown.length }).toStrictEqual({
    shownDuringGap: 0,
    shown: 1,
  });
});

it("a delivery still queued when readiness is lost shows nothing until navigation is current again", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  let grant = () => undefined as void;
  const reading = new Promise<void>((started) => {
    port.implementation.permission = () =>
      new Promise((resolve) => {
        grant = () => resolve("granted");
        started();
      });
  });
  const first = feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });
  await reading;
  const queued = feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });
  const lost = feed.notReady();
  port.implementation.permission = () => Promise.resolve("granted");
  grant();
  await Promise.all([first, queued, lost]);
  const shownWhileNotReady = port.shown.length;

  // Act
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ shownWhileNotReady, shown: port.shown.length }).toStrictEqual({
    shownWhileNotReady: 0,
    shown: 1,
  });
});

it("a startup snapshot voided by a delivery gap still catches up at the next current delivery", async (c) => {
  // Arrange
  const desktop = await installation(c, recordingPort("denied"));
  const { port } = desktop;
  await desktop.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  port.permission = "granted";
  await desktop.restart();
  let grant = () => undefined as void;
  const reading = new Promise<void>((started) => {
    port.implementation.permission = () =>
      new Promise((resolve) => {
        grant = () => resolve("granted");
        started();
      });
  });
  const holding = desktop.coordinator.checkPermission();
  await reading;
  const snapshot = desktop.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  const lost = desktop.feed.notReady();
  port.implementation.permission = () => Promise.resolve("granted");
  grant();
  await Promise.all([holding, snapshot, lost]);

  // Act
  await desktop.feed.deliver({ fresh: false, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(port.shown).toHaveLength(1);
});

it("a banner Notification Center accepts after its server was forgotten is withdrawn again", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  let accept = () => undefined as void;
  port.answer = () =>
    new Promise((resolve) => {
      accept = () => resolve({ kind: "accepted" });
    });
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  coordinator.select(null);
  await coordinator.forget(server);

  // Act
  accept();
  await coordinator.close();

  // Assert
  expect(port.withdrawn).toStrictEqual([port.shown[0]!.id, port.shown[0]!.id]);
});

it("clicking a notification whose one matter is still pending opens its Run with that Block selected", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [nativeRequest("n1", 1)])] });

  // Act
  const route = await coordinator.activate(port.shown[0]!.id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: "review" });
});

it("clicking a notification whose two matters are still pending opens the Run overview", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), problem("a2")])] });

  // Act
  const route = await coordinator.activate(port.shown[0]!.id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("clicking a notification whose matters resolved meanwhile opens the Run overview", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await feed.deliver({ fresh: false, rows: [run("a", [])] });

  // Act
  const route = await coordinator.activate(port.shown[0]!.id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("clicking a notification for a Run that left navigation opens that Run without a Block", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await feed.deliver({ fresh: false, rows: [] });

  // Act
  const route = await coordinator.activate(port.shown[0]!.id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("a notification clicked at a relaunch routes once the fresh snapshot shows the Run's current state", async (c) => {
  // Arrange
  const profile = await installation(c);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1"), problem("a2")])] });
  await profile.restart();
  const route = profile.coordinator.activate(profile.port.shown[0]!.id);

  // Act
  await profile.feed.deliver({ fresh: true, rows: [run("a", [problem("a2")])] });

  // Assert
  expect(await route).toStrictEqual({ kind: "run", runId: "a", blockId: "review" });
});

it("clicking a notification of a previous server selection opens nothing", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await coordinator.select("other").deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  const route = await coordinator.activate(port.shown[0]!.id);

  // Assert
  expect(route).toBeNull();
});

it("a click waiting for readiness opens nothing once another server is selected", async (c) => {
  // Arrange
  const profile = await installation(c);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();
  const route = profile.coordinator.activate(profile.port.shown[0]!.id);

  // Act
  await profile.coordinator
    .select("other")
    .deliver({ fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(await route).toBeNull();
});

it("a Dock click with a window open only brings it forward", async (c) => {
  // Arrange
  const { coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")]), run("b", [problem("b1")])] });

  // Act
  const route = await coordinator.dock(true);

  // Assert
  expect(route).toBeNull();
});

it("a Dock click with no window and one waiting Run with one matter opens it at that Block", async (c) => {
  // Arrange
  const { coordinator, feed } = await installation(c);
  const snoozed = { presentation: { snoozed: true, woke: false } };
  await feed.deliver({
    fresh: true,
    rows: [run("a", [matter("a1")]), run("b", [problem("b1")], snoozed)],
  });

  // Act
  const route = await coordinator.dock(false);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: "review" });
});

it("a Dock click with no window and several waiting Runs opens the Needs you Run list", async (c) => {
  // Arrange
  const { coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")]), run("b", [problem("b1")])] });

  // Act
  const route = await coordinator.dock(false);

  // Assert
  expect(route).toStrictEqual({ kind: "needs-you" });
});

it("a Dock click with no window and nothing waiting reopens the last view", async (c) => {
  // Arrange
  const { coordinator, feed } = await installation(c);
  await feed.deliver({
    fresh: true,
    rows: [run("a", []), run("b", [matter("b1")], { lifecycle: "settled" })],
  });

  // Act
  const route = await coordinator.dock(false);

  // Assert
  expect(route).toBeNull();
});

const finished = { notifyRunFinished: true };

function settledRun(
  id: string,
  settledCycle: number,
  settledReason: RunNavigationEntry["settledReason"],
  fields: Partial<RunNavigationEntry> = {},
): RunNavigationEntry {
  return run(id, [], {
    lifecycle: "settled",
    settledCycle,
    settledReason,
    endingName: settledReason === "finish" ? "Shipped" : null,
    ...fields,
  });
}

it("a Run that settles automatically shows one silent banner that says only that it settled", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [settledRun("a", 7, "automatic", { title: "Rotate /Users/owner/secrets.txt" })],
  });

  // Assert
  expect(port.shown).toStrictEqual([
    {
      id: expect.any(String),
      groupId: expect.any(String),
      title: "A Run has settled",
      body: "Settled",
    },
  ]);
});

it("with Run details shown a Finish settlement names the project, the Run and the ending", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), {
    ...finished,
    showRunDetails: true,
  });
  await feed.deliver({ fresh: true, rows: [run("a", [], { title: "Release notes" })] });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [settledRun("a", 7, "finish", { title: "Release notes" })],
  });

  // Assert
  expect(port.shown.map(({ title, body }) => ({ title, body }))).toStrictEqual([
    { title: "Project · Release notes", body: "Settled at Finish ending “Shipped”" },
  ]);
});

it("a manual Settle never notifies", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });

  // Act
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "manual")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("a manual Settle made from another client while offline stays silent at catch-up", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.notReady();

  // Act
  await feed.deliver({ fresh: true, rows: [settledRun("a", 7, "manual")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("nothing is posted while a settlement is stopping or unresolved, even with an earlier cycle on the row", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", []), run("b", [])] });
  const earlier = { settledCycle: 3, settledReason: "automatic", endingName: "Shipped" } as const;

  // Act
  await feed.deliver({
    fresh: false,
    rows: [
      run("a", [], { ...earlier, settlement: "stopping" }),
      run("b", [], { ...earlier, settlement: "unresolved" }),
    ],
  });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("a Finish settlement that completes after Retry settlement notifies", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [], { settlement: "unresolved" })] });

  // Act
  await feed.deliver({ fresh: false, rows: [settledRun("a", 9, "finish")] });

  // Assert
  expect(port.shown.map(({ body }) => body)).toStrictEqual(["Settled at Finish ending “Shipped”"]);
});

it("each Settled cycle notifies once, and a new cycle on the same Run notifies again", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await feed.deliver({ fresh: false, rows: [run("a", [], { settledCycle: 7 })] });

  // Act
  await feed.deliver({ fresh: false, rows: [settledRun("a", 12, "automatic")] });

  // Assert
  expect(port.shown).toHaveLength(2);
});

it("with Notify when a Run finishes off a settled Run never notifies", async (c) => {
  // Arrange
  const { port, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });

  // Act
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("with Notifications off a settled Run never notifies, although Notify when a Run finishes is on", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), {
    ...finished,
    notifications: false,
  });
  await feed.deliver({ fresh: true, rows: [run("a", [])] });

  // Act
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("a Run that settled while a Factory window was focused never notifies after switching away", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  coordinator.focus(true);
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  coordinator.focus(false);

  // Act
  await feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("turning Notify when a Run finishes on replays no Run that is already Settled, and a later one notifies", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c);
  await feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic"), run("b", [])] });
  await coordinator.configure({ ...defaultSettings, ...finished });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [settledRun("a", 7, "automatic"), settledRun("b", 8, "finish")],
  });

  // Assert
  expect(port.shown.map(({ body }) => body)).toStrictEqual(["Settled at Finish ending “Shipped”"]);
});

it("turning Notifications back on replays no Run that settled while they were off", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await coordinator.configure({ ...defaultSettings, ...finished, notifications: false });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });

  // Act
  await coordinator.configure({ ...defaultSettings, ...finished });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("a permission grant noticed later replays no Run that is already Settled", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort("denied"), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  port.permission = "granted";

  // Act
  await coordinator.checkPermission();

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("the first ready snapshot of a server with no completion history announces no Run that is already Settled", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);

  // Act
  await feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("turning Notify when a Run finishes on while offline makes the next ready snapshot the baseline", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await coordinator.configure(defaultSettings);
  await feed.notReady();
  await coordinator.configure({ ...defaultSettings, ...finished });

  // Act
  await feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("the completion that asked for permission is delivered once after Allow", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(
    c,
    recordingPort("undetermined"),
    finished,
  );
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });

  // Act
  port.grant("granted");
  await coordinator.close();

  // Assert
  expect({ requests: port.requests, bodies: port.shown.map(({ body }) => body) }).toStrictEqual({
    requests: 1,
    bodies: ["Settled"],
  });
});

it("the completion that asked for permission is dropped when its Run left that Settled cycle before Allow", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(
    c,
    recordingPort("undetermined"),
    finished,
  );
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await feed.deliver({ fresh: false, rows: [run("a", [], { settledCycle: 7 })] });

  // Act
  port.grant("granted");
  await coordinator.close();

  // Assert
  expect(port.shown).toStrictEqual([]);
});

it("after a restart each Run still Settled in an unannounced cycle notifies once, and Runs back to Active or Archived stay silent", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort(), finished);
  await profile.feed.deliver({
    fresh: true,
    rows: [run("a", []), run("b", []), run("c", []), run("d", [])],
  });
  await profile.restart();

  // Act
  await profile.feed.deliver({
    fresh: true,
    rows: [
      settledRun("a", 7, "automatic"),
      settledRun("b", 8, "finish"),
      run("c", [], { settledCycle: 9, settledReason: "automatic" }),
    ],
  });

  // Assert
  expect(profile.port.shown.map(({ body }) => body)).toStrictEqual([
    "Settled",
    "Settled at Finish ending “Shipped”",
  ]);
});

it("a delivered completion is not repeated after a restart", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort(), finished);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await profile.restart();

  // Act
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(profile.port.shown).toHaveLength(1);
});

it("a completion whose notifier never answered before a restart is not repeated", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort(), finished);
  profile.port.answer = () => new Promise(() => undefined);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await profile.restart();

  // Act
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(profile.port.shown).toHaveLength(1);
});

it("a refused completion is retried at the next catch-up while its cycle still qualifies", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort(), finished);
  profile.port.answer = () => Promise.resolve({ kind: "failed" });
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  await profile.restart();
  profile.port.answer = () => Promise.resolve({ kind: "accepted" });

  // Act
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(profile.port.shown).toHaveLength(2);
});

it("a delivered completion is not withdrawn for having no pending matter", async (c) => {
  // Arrange
  const { port, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });

  // Act
  await feed.deliver({
    fresh: false,
    rows: [settledRun("a", 7, "automatic"), run("b", [matter("b1")])],
  });

  // Assert
  expect({ shown: port.shown.length, withdrawn: port.withdrawn }).toStrictEqual({
    shown: 2,
    withdrawn: [],
  });
});

it("clicking a completion notification opens the Run overview with no Block selected", async (c) => {
  // Arrange
  const { port, coordinator, feed } = await installation(c, recordingPort(), finished);
  await feed.deliver({ fresh: true, rows: [run("a", [matter("a1")])] });
  await feed.deliver({ fresh: false, rows: [settledRun("a", 7, "finish")] });
  const completion = port.shown.at(-1)!;

  // Act
  const route = await coordinator.activate(completion.id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("a completion clicked at a relaunch opens its Run overview from the kept ledger record, however old and after any number of launches", async (c) => {
  // Arrange
  vi.useFakeTimers({ toFake: ["Date"] });
  c.onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  const profile = await installation(c, recordingPort(), finished);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
  await profile.restart();
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });
  await profile.restart();
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });
  await profile.restart();
  const route = profile.coordinator.activate(profile.port.shown[0]!.id);

  // Act
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 7, "automatic")] });

  // Assert
  expect(await route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

async function postedCompletion(context: TestContext) {
  const profile = await installation(context, recordingPort(), finished);
  await profile.feed.deliver({ fresh: true, rows: [run("a", [])] });
  await profile.feed.deliver({ fresh: false, rows: [settledRun("a", 7, "automatic")] });
  return { profile, port: profile.port, id: profile.port.shown[0]!.id };
}

it("a completion is withdrawn without alerting again when its Run returns to Active", async (c) => {
  // Arrange
  const { profile, port, id } = await postedCompletion(c);

  // Act
  await profile.feed.deliver({ fresh: false, rows: [run("a", [], { settledCycle: 7 })] });

  // Assert
  expect({ withdrawn: port.withdrawn, shown: port.shown.length }).toStrictEqual({
    withdrawn: [id],
    shown: 1,
  });
});

it("a completion is withdrawn once when its Run is Archived or its row disappears", async (c) => {
  // Arrange
  const { profile, port, id } = await postedCompletion(c);

  // Act
  await profile.feed.deliver({ fresh: false, rows: [] });
  await profile.feed.deliver({ fresh: false, rows: [] });

  // Assert
  expect(port.withdrawn).toStrictEqual([id]);
});

it("a completion is withdrawn when the ready snapshot has another cycle, also after a cycle change while offline", async (c) => {
  // Arrange
  const { profile, port, id } = await postedCompletion(c);
  await profile.feed.notReady();
  await profile.restart();

  // Act
  await profile.feed.deliver({ fresh: true, rows: [settledRun("a", 9, "manual")] });

  // Assert
  expect({ withdrawn: port.withdrawn, shown: port.shown.length }).toStrictEqual({
    withdrawn: [id],
    shown: 1,
  });
});

it("a completion whose Run left Settled while Factory was quit is withdrawn at the first ready snapshot", async (c) => {
  // Arrange
  const { profile, port, id } = await postedCompletion(c);
  await profile.restart();

  // Act
  await profile.feed.deliver({ fresh: true, rows: [] });

  // Assert
  expect(port.withdrawn).toStrictEqual([id]);
});

it("a completion is withdrawn when the selection moves to another server or is revoked", async (c) => {
  // Arrange
  const switched = await postedCompletion(c);
  const revoked = await postedCompletion(c);

  // Act
  switched.profile.coordinator.select("other");
  await revoked.profile.feed.revoked();
  await switched.profile.coordinator.close();

  // Assert
  expect([switched.port.withdrawn, revoked.port.withdrawn]).toStrictEqual([
    [switched.id],
    [revoked.id],
  ]);
});

it("opening a Run in Factory or renaming it leaves its completion notification in place", async (c) => {
  // Arrange
  const { profile, port } = await postedCompletion(c);

  // Act
  await profile.feed.deliver({
    fresh: false,
    rows: [settledRun("a", 7, "automatic", { title: "Renamed" })],
  });

  // Assert
  expect({ withdrawn: port.withdrawn, shown: port.shown.length }).toStrictEqual({
    withdrawn: [],
    shown: 1,
  });
});

it("a completion clicked after its Run was Archived or removed opens that Run by id", async (c) => {
  // Arrange
  const { profile, id } = await postedCompletion(c);
  await profile.feed.deliver({ fresh: false, rows: [] });

  // Act
  const route = await profile.coordinator.activate(id);

  // Assert
  expect(route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("a completion that was withdrawn before a restart still opens its Run when clicked after a cold launch", async (c) => {
  // Arrange
  const { profile, id } = await postedCompletion(c);
  await profile.feed.deliver({ fresh: false, rows: [] });
  await profile.restart();
  const route = profile.coordinator.activate(id);

  // Act
  await profile.feed.deliver({ fresh: true, rows: [] });

  // Assert
  expect(await route).toStrictEqual({ kind: "run", runId: "a", blockId: null });
});

it("a completion whose Run left Settled is forgotten at the second launch after, so its click opens only the window", async (c) => {
  // Arrange
  const { profile, id } = await postedCompletion(c);
  await profile.feed.deliver({ fresh: false, rows: [] });
  await profile.restart();
  await profile.feed.deliver({ fresh: true, rows: [] });
  await profile.restart();
  await profile.feed.deliver({ fresh: true, rows: [] });

  // Act
  const route = await profile.coordinator.activate(id);

  // Assert
  expect(route).toBeNull();
});

it("a completion clicked after the selection moved to another server or was revoked opens only the window", async (c) => {
  // Arrange
  const switched = await postedCompletion(c);
  const revoked = await postedCompletion(c);
  switched.profile.coordinator.select("other");
  await revoked.profile.feed.revoked();

  // Act
  const routes = await Promise.all([
    switched.profile.coordinator.activate(switched.id),
    revoked.profile.coordinator.activate(revoked.id),
  ]);

  // Assert
  expect(routes).toStrictEqual([null, null]);
});
