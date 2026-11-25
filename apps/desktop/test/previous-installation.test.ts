import { chmod, readdir, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import {
  migratePreviousInstallation,
  postponeRemovalReminder,
  previousInstallation,
  removalReminderDue,
  removePreviousInstallation,
  skipPreviousInstallation,
  tombstoneName,
} from "../src/previous-installation.ts";
import {
  clientSettings,
  disposableInstallation,
  exists,
  holdBackendLock,
  leaveSingletonLock,
  mode,
  readJson,
  rows,
  runUnrelatedElectronApp,
  seedDesktopProfile,
  seedServerHome,
  serverSettings,
  snapshot,
  writeMigrationRecord,
} from "./support/previous-installation.ts";

const migratedAt = new Date("2026-11-24T10:00:00.000Z");
const withoutSharedMemory = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([name]) => !name.endsWith("-shm")));

it("a server installation arrives in AgentEasel with its data, settings and drafts while T3 Factory keeps its own copy", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  context.onTestFinished(() => database.close());
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  const oldHomeBefore = withoutSharedMemory(await snapshot(paths.oldHome!));
  const oldProfileBefore = await snapshot(paths.oldUserData);
  const registerLoginItem = vi.fn();

  // Act
  const outcome = await migratePreviousInstallation(paths, registerLoginItem, () => migratedAt);

  // Assert
  expect(outcome).toEqual({ kind: "migrated" });
  const newDatabase = join(paths.newHome, "factory.sqlite");
  expect(rows(newDatabase, "SELECT id, name FROM flows ORDER BY id")).toEqual([
    { id: "flow-1", name: "Implement issue" },
    { id: "flow-2", name: "Review PR" },
  ]);
  expect(rows(newDatabase, "SELECT id FROM runs")).toEqual([{ id: "run-1" }]);
  expect(await readJson(join(paths.newHome, "credentials", "t3-oauth.json"))).toEqual({
    token: "t3",
  });
  expect(await mode(join(paths.newHome, "credentials"))).toBe(0o700);
  expect(await exists(join(paths.newHome, "images", "run-1", "screen.png"))).toBe(true);
  expect(await exists(join(paths.newHome, tombstoneName))).toBe(false);
  expect(await exists(`${paths.newHome}.migrating`)).toBe(false);
  expect(await readJson(join(paths.newUserData, "desktop-settings.json"))).toEqual(serverSettings);
  expect(await readJson(join(paths.newUserData, "desktop-attention.json"))).toEqual({
    version: 1,
    delivered: ["a"],
  });
  const partition = join(paths.newUserData, "Partitions", "factory-ui");
  expect((await readdir(partition)).sort()).toEqual(["IndexedDB", "Local Storage"]);
  expect(await exists(join(paths.newUserData, "pending-update.json"))).toBe(false);
  expect(registerLoginItem).toHaveBeenCalledOnce();
  expect(await readJson(join(paths.oldHome!, tombstoneName))).toEqual({
    application: "AgentEasel",
    migratedAt: migratedAt.toISOString(),
  });
  expect(await exists(join(paths.oldUserData, tombstoneName))).toBe(true);
  const { [tombstoneName]: homeTombstone, ...oldHomeAfter } = withoutSharedMemory(
    await snapshot(paths.oldHome!),
  );
  const { [tombstoneName]: profileTombstone, ...oldProfileAfter } = await snapshot(
    paths.oldUserData,
  );
  expect([homeTombstone, profileTombstone]).toEqual([expect.any(String), expect.any(String)]);
  expect(oldHomeAfter).toEqual(oldHomeBefore);
  expect(oldProfileAfter).toEqual(oldProfileBefore);
  expect(await previousInstallation(paths)).toEqual({
    migratedAt: migratedAt.toISOString(),
    home: "copied",
    profile: "copied",
    launchAtLogin: true,
    remoteServer: false,
    summaryPending: true,
    oldDataPresent: true,
  });
});

it("migration waits while the T3 Factory backend owns its data home and changes nothing", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  context.onTestFinished(() => database.close());
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  context.onTestFinished(holdBackendLock(paths.oldHome!));

  // Act
  const outcome = await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);

  // Assert
  expect(outcome).toEqual({ kind: "refused", reason: expect.stringContaining("Retry") });
  expect(await exists(paths.newHome)).toBe(false);
  expect(await exists(paths.newUserData)).toBe(false);
  expect(await exists(join(paths.oldHome!, tombstoneName))).toBe(false);
  expect(await exists(join(paths.oldUserData, tombstoneName))).toBe(false);
});

it("a leftover T3 Factory singleton lock whose pid now belongs to another Electron app does not hold up migration", async (context) => {
  // Arrange
  const { root, paths } = await disposableInstallation(context.onTestFinished);
  await seedDesktopProfile(paths.oldUserData, clientSettings);
  const otherApp = await runUnrelatedElectronApp(root, context.onTestFinished);
  await leaveSingletonLock(paths.oldUserData, otherApp);

  // Act
  const outcome = await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);

  // Assert
  expect(outcome).toEqual({ kind: "migrated" });
  expect(await exists(join(paths.oldUserData, tombstoneName))).toBe(true);
});

it("a copy that fails part way leaves T3 Factory untouched and a retry completes the migration", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  context.onTestFinished(() => database.close());
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  const unreadable = join(paths.oldHome!, "images", "run-1", "screen.png");
  await chmod(unreadable, 0o000);
  await expect(migratePreviousInstallation(paths, vi.fn(), () => migratedAt)).rejects.toThrow();
  const afterFailure = {
    newHome: await exists(paths.newHome),
    staging: await exists(`${paths.newHome}.migrating`),
    tombstone: await exists(join(paths.oldHome!, tombstoneName)),
  };
  await chmod(unreadable, 0o644);

  // Act
  const outcome = await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);

  // Assert
  expect(afterFailure).toEqual({ newHome: false, staging: true, tombstone: false });
  expect(outcome).toEqual({ kind: "migrated" });
  expect(
    rows(join(paths.newHome, "factory.sqlite"), "SELECT count(*) AS flows FROM flows"),
  ).toEqual([{ flows: 2 }]);
  expect(await exists(join(paths.newHome, "images", "run-1", "screen.png"))).toBe(true);
  expect(await exists(`${paths.newHome}.migrating`)).toBe(false);
});

it("a client installation without a data home keeps its settings and server but must be approved again", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  await seedDesktopProfile(paths.oldUserData, clientSettings);

  // Act
  const outcome = await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);

  // Assert
  expect(outcome).toEqual({ kind: "migrated" });
  expect(await readJson(join(paths.newUserData, "desktop-settings.json"))).toEqual({
    ...clientSettings,
    server: { ...clientSettings.server, credential: null },
  });
  expect(await exists(paths.newHome)).toBe(false);
  expect(await exists(join(paths.oldUserData, tombstoneName))).toBe(true);
  expect(await previousInstallation(paths)).toMatchObject({
    home: "absent",
    remoteServer: true,
    launchAtLogin: false,
  });
});

it("removing the previous data after the 30-day reminder keeps T3 Factory tombstoned and stops reminding", async (context) => {
  // Arrange
  const { root, paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  database.close();
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);
  const day = 86_400_000;
  const reminders = {
    early: await removalReminderDue(paths, new Date(migratedAt.getTime() + 29 * day)),
    due: await removalReminderDue(paths, new Date(migratedAt.getTime() + 30 * day)),
  };
  await postponeRemovalReminder(paths, new Date(migratedAt.getTime() + 30 * day));
  const postponed = await removalReminderDue(paths, new Date(migratedAt.getTime() + 31 * day));
  const trash = join(root, "Trash");
  await mkdir(trash);
  const moveToTrash = vi.fn((path: string) =>
    rename(path, join(trash, `${Date.now()}-${path.length}`)),
  );

  // Act
  const refused = await removePreviousInstallation(paths, moveToTrash, new Date());

  // Assert
  expect({ ...reminders, postponed }).toEqual({ early: false, due: true, postponed: false });
  expect(refused).toBeNull();
  expect(moveToTrash.mock.calls).toEqual([[paths.oldHome], [paths.oldUserData]]);
  expect(await exists(paths.oldHome!)).toBe(false);
  expect(await readdir(paths.oldUserData)).toEqual([tombstoneName]);
  expect(await previousInstallation(paths)).toMatchObject({ oldDataPresent: false });
  expect(await removalReminderDue(paths, new Date(migratedAt.getTime() + 90 * day))).toBe(false);
  expect(rows(join(paths.newHome, "factory.sqlite"), "SELECT count(*) AS runs FROM runs")).toEqual([
    { runs: 1 },
  ]);
});

it("an existing AgentEasel data home is kept and removal never trashes the T3 Factory home it did not copy", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  database.close();
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  await mkdir(paths.newHome, { recursive: true });
  await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);
  const moveToTrash = vi.fn(async (_path: string) => undefined);

  // Act
  const refused = await removePreviousInstallation(paths, moveToTrash, new Date());

  // Assert
  expect(refused).toBeNull();
  expect(moveToTrash.mock.calls).toEqual([[paths.oldUserData]]);
  expect(
    rows(join(paths.oldHome!, "factory.sqlite"), "SELECT count(*) AS flows FROM flows"),
  ).toEqual([{ flows: 2 }]);
  expect(await readdir(paths.newHome)).toEqual([]);
  expect(await previousInstallation(paths)).toMatchObject({
    home: "kept-existing",
    oldDataPresent: false,
  });
});

it("a migration interrupted right after its data home was renamed into place reports the home as copied", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  database.close();
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  await mkdir(paths.newHome, { recursive: true });
  await writeMigrationRecord(paths.newUserData, { version: 1, home: "copying" });

  // Act
  const outcome = await migratePreviousInstallation(paths, vi.fn(), () => migratedAt);

  // Assert
  expect(outcome).toEqual({ kind: "migrated" });
  expect(await previousInstallation(paths)).toMatchObject({ home: "copied", oldDataPresent: true });
});

it("after a copy failure the user can start without migrating, leaving T3 Factory working and untouched", async (context) => {
  // Arrange
  const { paths } = await disposableInstallation(context.onTestFinished);
  const database = await seedServerHome(paths.oldHome!);
  database.close();
  await seedDesktopProfile(paths.oldUserData, serverSettings);
  const unreadable = join(paths.oldHome!, "images", "run-1", "screen.png");
  await chmod(unreadable, 0o000);
  context.onTestFinished(() => chmod(unreadable, 0o644));
  await expect(migratePreviousInstallation(paths, vi.fn(), () => migratedAt)).rejects.toThrow();

  // Act
  await skipPreviousInstallation(paths, migratedAt);

  // Assert
  expect(await exists(`${paths.newHome}.migrating`)).toBe(false);
  expect(await exists(paths.newHome)).toBe(false);
  expect(await exists(join(paths.oldHome!, tombstoneName))).toBe(false);
  expect(await exists(join(paths.oldUserData, tombstoneName))).toBe(false);
  expect(await migratePreviousInstallation(paths, vi.fn(), () => migratedAt)).toEqual({
    kind: "migrated",
  });
  expect(await previousInstallation(paths)).toMatchObject({
    home: "skipped",
    profile: "skipped",
    summaryPending: false,
    oldDataPresent: false,
  });
});
