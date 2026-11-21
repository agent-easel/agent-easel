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
    copy: vi.fn<RunActionPorts["copy"]>(async () => undefined),
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

it("a confirmed Settle request keeps its Run busy until the request answers", () => {
  // Arrange
  const { actions } = runActionsWith({
    settle: vi.fn<RunActionPorts["settle"]>((_runId, _retry, requesting) => {
      requesting(false);
      requesting(true);
      return new Promise(() => undefined);
    }),
  });

  // Act
  void actions.run({ entry: active }, "settle");

  // Assert
  expect(actions.getSnapshot().busyRunId).toBe(active.id);
  expect(actions.availability({ entry: other }).settle).toBe(false);
});

it("a Settle confirmation waiting for the user leaves no Run busy", () => {
  // Arrange
  const { actions } = runActionsWith({
    settle: vi.fn<RunActionPorts["settle"]>((_runId, _retry, requesting) => {
      requesting(false);
      return new Promise(() => undefined);
    }),
  });

  // Act
  void actions.run({ entry: active }, "settle");

  // Assert
  expect(actions.getSnapshot().busyRunId).toBeUndefined();
});

it("Copy Run number puts the Run's #N reference on the clipboard", async () => {
  // Arrange
  const { actions, ports } = runActionsWith();

  // Act
  await actions.copy({ entry: { ...active, number: 125 } }, "number");

  // Assert
  expect(ports.copy).toHaveBeenCalledWith("#125");
});

it("Copy Run ID puts the Run id on the clipboard", async () => {
  // Arrange
  const { actions, ports } = runActionsWith();

  // Act
  await actions.copy({ detail: runDetail() }, "id");

  // Assert
  expect(ports.copy).toHaveBeenCalledWith(runDetail().id);
});

it("a clipboard the browser withholds reports that copying is unavailable", async () => {
  // Arrange
  const { actions } = runActionsWith({
    copy: vi.fn<RunActionPorts["copy"]>(async () => {
      throw new DOMException("Clipboard denied", "NotAllowedError");
    }),
  });

  // Act
  await actions.copy({ entry: active }, "id");

  // Assert
  expect(actions.getSnapshot().error).toBe("Copy unavailable here.");
});

it("a browser without a clipboard API reports that copying is unavailable", async () => {
  // Arrange
  const { actions } = runActionsWith({
    copy: vi.fn<RunActionPorts["copy"]>(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'writeText')");
    }),
  });

  // Act
  await actions.copy({ entry: active }, "number");

  // Assert
  expect(actions.getSnapshot().error).toBe("Copy unavailable here.");
});
