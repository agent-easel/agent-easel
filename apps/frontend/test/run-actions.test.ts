import { expect, it, vi } from "vite-plus/test";
import type { RunNavigationEntry } from "@t3-factory/contracts";
import {
  createRunActions,
  runActionAvailability,
  type RunActionAvailability,
  type RunActionPorts,
} from "../src/run-actions.ts";
import { runDetail, runEntry } from "./support/run.ts";

const active = runEntry();
const snoozed: RunNavigationEntry = { ...active, presentation: { snoozed: true, woke: false } };
const settled: RunNavigationEntry = { ...active, lifecycle: "settled" };
const stale: RunNavigationEntry = {
  ...active,
  blocks: [{ state: "working", freshness: "stale", workingMessage: null }],
};
const other: RunNavigationEntry = { ...active, id: "other" };

const allowed = { mutationsAllowed: true, busyRunId: undefined };
const every: RunActionAvailability = {
  snoozeRestore: true,
  settle: true,
  archive: true,
  rename: true,
};
const none: RunActionAvailability = {
  snoozeRestore: false,
  settle: false,
  archive: false,
  rename: false,
};
const archiveAndRename: RunActionAvailability = { ...none, archive: true, rename: true };

it.each([
  {
    name: "an Active Run offers every action",
    subject: { entry: active, detail: runDetail() },
    conditions: allowed,
    expected: every,
  },
  {
    name: "a Snoozed Run offers every action",
    subject: { entry: snoozed },
    conditions: allowed,
    expected: every,
  },
  {
    name: "a Settled Run offers Archive and Rename only",
    subject: { entry: settled },
    conditions: allowed,
    expected: archiveAndRename,
  },
  {
    name: "an archived Run offers nothing",
    subject: { entry: active, detail: { ...runDetail(), lifecycle: "archived" as const } },
    conditions: allowed,
    expected: none,
  },
  {
    name: "disallowed mutations offer nothing",
    subject: { entry: active },
    conditions: { mutationsAllowed: false, busyRunId: undefined },
    expected: none,
  },
  {
    name: "unavailable observation keeps every action",
    subject: { entry: stale, detail: undefined },
    conditions: allowed,
    expected: every,
  },
  {
    name: "another Run's running action leaves Archive and Rename",
    subject: { entry: active },
    conditions: { mutationsAllowed: true, busyRunId: "other" },
    expected: archiveAndRename,
  },
  {
    name: "the Run whose action is running offers nothing",
    subject: { entry: active },
    conditions: { mutationsAllowed: true, busyRunId: active.id },
    expected: none,
  },
])("$name", ({ subject, conditions, expected }) => {
  // Arrange / Act
  const availability = runActionAvailability(subject, conditions);

  // Assert
  expect(availability).toStrictEqual(expected);
});

/** Run actions over recorded ports whose requests succeed unless replaced. */
function runActionsWith(replaced: Partial<RunActionPorts> = {}) {
  const ports = {
    snooze: vi.fn<RunActionPorts["snooze"]>(async () => undefined),
    restore: vi.fn<RunActionPorts["restore"]>(async () => undefined),
    settle: vi.fn<RunActionPorts["settle"]>(async () => undefined),
    mutationsAllowed: () => true,
    searching: () => false,
    navigationEntry: () => undefined,
    requestFocus: vi.fn<RunActionPorts["requestFocus"]>(),
    ...replaced,
  };
  return { actions: createRunActions(ports), ports };
}

it("Snooze on a Run that is not Snoozed snoozes it and focuses the Snoozed group", async () => {
  // Arrange
  const { actions, ports } = runActionsWith();

  // Act
  await actions.run({ entry: active }, "snoozeRestore");

  // Assert
  expect(ports.snooze).toHaveBeenCalledWith(active.id);
  expect(ports.restore).not.toHaveBeenCalled();
  expect(ports.requestFocus).toHaveBeenCalledWith({
    id: "snoozed-toggle",
    runId: active.id,
    action: "snooze",
  });
});

it("Snooze or restore on a Snoozed Run restores it and focuses its row", async () => {
  // Arrange
  const { actions, ports } = runActionsWith();

  // Act
  await actions.run({ entry: snoozed }, "snoozeRestore");

  // Assert
  expect(ports.restore).toHaveBeenCalledWith(snoozed.id);
  expect(ports.snooze).not.toHaveBeenCalled();
  expect(ports.requestFocus).toHaveBeenCalledWith({
    id: `run-row-${snoozed.id}`,
    runId: snoozed.id,
    action: "restore",
  });
});

it("a Run action is refused while another Run's action is running", async () => {
  // Arrange
  const { actions, ports } = runActionsWith({
    snooze: vi.fn<RunActionPorts["snooze"]>(() => new Promise(() => undefined)),
  });
  void actions.run({ entry: other }, "snoozeRestore");

  // Act
  await actions.run({ entry: active }, "settle");

  // Assert
  expect(ports.settle).not.toHaveBeenCalled();
  expect(actions.getSnapshot()).toMatchObject({ busyRunId: other.id, error: "" });
});

it("a keyboard Settle acts on the Run its screen declared, with no sidebar mounted", async () => {
  // Arrange
  const { actions, ports } = runActionsWith();
  actions.setOpenRun({ entry: active, detail: runDetail() });

  // Act
  await actions.run(actions.getSnapshot().openRun, "settle");

  // Assert
  expect(ports.settle).toHaveBeenCalledWith(active.id, false, expect.any(Function));
});
