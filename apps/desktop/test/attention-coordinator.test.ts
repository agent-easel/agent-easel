import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunAttentionMatter, RunNavigationEntry } from "@t3-factory/contracts";
import type {
  DesktopAlertSettings,
  NotificationPermission,
} from "@t3-factory/contracts/desktop-bridge";
import { expect, it, type TestContext } from "vite-plus/test";
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
  context.onTestFinished(() => coordinator.close());
  return {
    port,
    get coordinator() {
      return coordinator;
    },
    /** Quit and launch again: the same profile directory, a new coordinator. */
    async restart() {
      await coordinator.close();
      coordinator = await AttentionCoordinator.open(directory, port.implementation, options);
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
  const { port, coordinator } = await installation(c);

  // Act
  await coordinator.deliver({
    server,
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
  const { port, coordinator } = await installation(c);
  const rows = Array.from({ length: 100 }, (_, index) => run(`r${index}`, [problem(`p${index}`)]));

  // Act
  await coordinator.deliver({ server, fresh: true, rows });

  // Assert
  expect(port.badge).toBe("99+");
});

it("the Dock badge disappears once the last pending matter resolves", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c);
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await coordinator.deliver({ server, fresh: false, rows: [run("a", [])] });

  // Assert
  expect(port.badge).toBe("");
});

it("matters arriving together on one Run share one banner, and a later matter gets its own", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c);
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [])] });
  await coordinator.deliver({
    server,
    fresh: false,
    rows: [run("a", [matter("a1"), matter("a2"), problem("a3")])],
  });

  // Act
  await coordinator.deliver({
    server,
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
  const { port, coordinator } = await installation(c);
  const counted = (count: number) => [run("a", [nativeRequest("n1", count)])];
  await coordinator.deliver({ server, fresh: true, rows: counted(1) });
  await coordinator.deliver({ server, fresh: false, rows: counted(2) });
  await coordinator.deliver({ server, fresh: false, rows: counted(1) });

  // Act
  await coordinator.deliver({ server, fresh: false, rows: counted(2) });

  // Assert
  expect(port.shown).toHaveLength(3);
});

it("a notification says only whether a Run needs input or has a problem", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c);
  const secret = run("a", [problem("a1")], {
    title: "Rotate the key in /Users/owner/secrets.txt",
    flowName: "Private Flow",
  });

  // Act
  await coordinator.deliver({ server, fresh: true, rows: [secret] });

  // Assert
  expect(port.shown).toStrictEqual([
    { id: expect.any(String), groupId: expect.any(String), title: "A Run has a problem", body: "" },
  ]);
});

it("losing readiness clears the badge and retained matters never notify", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c);
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await coordinator.notReady();

  // Assert
  expect(port.badge).toBe("");
  expect(port.shown).toHaveLength(1);
});

it("after a restart each Run with still-pending matters that were never accounted shows one banner", async (c) => {
  // Arrange
  const profile = await installation(c);
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();

  // Act
  await profile.coordinator.deliver({
    server,
    fresh: true,
    rows: [run("a", [matter("a1"), matter("a2")]), run("b", [matter("b1"), problem("b2")])],
  });

  // Assert
  expect(profile.port.shown.map(({ body }) => body)).toStrictEqual(["", "", "+1 more"]);
});

it("a matter that waited for permission and resolved while Factory was away never notifies", async (c) => {
  // Arrange
  const profile = await installation(c, recordingPort("denied"));
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();
  profile.port.permission = "granted";

  // Act
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [])] });

  // Assert
  expect(profile.port.shown).toStrictEqual([]);
});

it("a notifier that never answered before a restart is not repeated", async (c) => {
  // Arrange
  const profile = await installation(c);
  profile.port.answer = () => new Promise(() => undefined);
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.restart();

  // Act
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(profile.port.shown).toHaveLength(1);
});

it("a rejected notification is retried at the next catch-up, not on later changes", async (c) => {
  // Arrange
  const profile = await installation(c);
  profile.port.answer = () => Promise.resolve({ kind: "failed" });
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });
  await profile.coordinator.deliver({ server, fresh: false, rows: [run("a", [matter("a1")])] });
  await profile.restart();
  profile.port.answer = () => Promise.resolve({ kind: "accepted" });

  // Act
  await profile.coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect(profile.port.shown).toHaveLength(2);
});

it("permission is asked at the first banner, not at launch, and the banner follows the grant", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c, recordingPort("undetermined"));
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [])] });
  const asked = port.requests;
  await coordinator.deliver({ server, fresh: false, rows: [run("a", [matter("a1")])] });

  // Act
  port.grant("granted");
  await coordinator.close();

  // Assert
  expect({ asked, shown: port.shown.length }).toStrictEqual({ asked: 0, shown: 1 });
});

it("turning Notifications on shows one catch-up banner per Run for what waited while they were off", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c, recordingPort(), { notifications: false });
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [])] });
  await coordinator.deliver({
    server,
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
  const { port, coordinator } = await installation(c);
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Act
  await coordinator.configure({ ...defaultSettings, dockBadge: false });

  // Assert
  expect(port.badge).toBe("");
});

it("with Run details shown a notification adds the project, Run title and Block name and nothing else", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c, recordingPort(), { showRunDetails: true });
  const detailed = run("a", [matter("a1"), problem("a2")], {
    title: "Release notes",
    flowName: "Private Flow",
  });

  // Act
  await coordinator.deliver({ server, fresh: true, rows: [detailed] });

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
  const { port, coordinator } = await installation(c);
  coordinator.focus(true);
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [])] });
  await coordinator.deliver({ server, fresh: false, rows: [run("a", [matter("a1")])] });
  const whileFocused = port.shown.length;
  coordinator.focus(false);

  // Act
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ whileFocused, shown: port.shown.length, badge: port.badge }).toStrictEqual({
    whileFocused: 0,
    shown: 0,
    badge: "1",
  });
});

it("with notification permission denied the Dock badge still counts and Factory never asks again", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c, recordingPort("denied"));

  // Act
  await coordinator.deliver({ server, fresh: true, rows: [run("a", [matter("a1")])] });

  // Assert
  expect({ badge: port.badge, shown: port.shown.length, requests: port.requests }).toStrictEqual({
    badge: "1",
    shown: 0,
    requests: 0,
  });
});

it("a permission grant noticed by a re-check shows one catch-up banner per Run", async (c) => {
  // Arrange
  const { port, coordinator } = await installation(c, recordingPort("denied"));
  await coordinator.deliver({
    server,
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
