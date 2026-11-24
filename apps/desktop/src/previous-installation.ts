import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { cp, mkdir, readFile, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { flockSync } from "fs-ext";
import type { PreviousInstallation } from "@agent-easel/contracts/desktop-bridge";

export const tombstoneName = "migrated-to-agenteasel.json";
const recordName = "previous-installation.json";
const databaseName = "factory.sqlite";
const partition = join("Partitions", "factory-ui");
const partitionAllowlist = ["Local Storage", "IndexedDB", "WebStorage"];
const desktopFiles = ["desktop-attention.json"];
const settingsName = "desktop-settings.json";
const reminderDays = 30;
const run = promisify(execFile);
const oldAppExecutable = /\/T3 Factory\.app\/Contents\/MacOS\/T3 Factory$/;

export interface PreviousInstallationPaths {
  readonly oldHome: string | null;
  readonly newHome: string;
  readonly oldUserData: string;
  readonly newUserData: string;
}

export function defaultPreviousInstallationPaths(
  env: NodeJS.ProcessEnv,
  home: string,
  appData: string,
  userData: string,
): PreviousInstallationPaths | null {
  if (env.FACTORY_DESKTOP_USER_DATA) return null;
  return {
    oldHome: env.FACTORY_HOME ? null : join(home, ".t3-factory"),
    newHome: join(home, ".agenteasel"),
    oldUserData: join(appData, "T3 Factory"),
    newUserData: userData,
  };
}

export const migrationText = {
  migrating: "AgentEasel is bringing over your T3 Factory data",
  failed:
    "AgentEasel could not copy your T3 Factory data. Your T3 Factory data was not changed. Retry copies it again; Start Without Migrating opens AgentEasel with its own empty data and leaves T3 Factory as it is.",
  nothingToRemove: "There is no previous T3 Factory data.",
  removeQuestion: "Move your previous T3 Factory data to the Trash?",
  removeDetail: {
    both: "AgentEasel has its own copy of both. This moves the T3 Factory data home (~/.t3-factory) and desktop settings to the Trash; T3 Factory keeps refusing to start its server.",
    profile:
      "This moves only T3 Factory's desktop settings, which AgentEasel copied, to the Trash. The T3 Factory data home (~/.t3-factory) was not copied into AgentEasel and stays where it is.",
    home: "This moves only the T3 Factory data home (~/.t3-factory), which AgentEasel copied, to the Trash. T3 Factory's desktop settings were not copied and stay where they are.",
  },
  reminder: "Your previous T3 Factory data is still on this Mac",
  removalFailed: "Your previous T3 Factory data was not moved to the Trash",
  reminderDetail:
    "AgentEasel brought it over more than 30 days ago and keeps it as a backup until you remove it. You can also do this later in Settings → Desktop app.",
};

type HomeOutcome = PreviousInstallation["home"];
type ProfileOutcome = PreviousInstallation["profile"];

interface MigrationRecord {
  readonly version: 1;
  readonly home?: HomeOutcome | "copying";
  readonly userData?: ProfileOutcome;
  readonly launchAtLogin?: boolean;
  readonly remoteServer?: boolean;
  readonly completedAt?: string;
  readonly summarySeen?: boolean;
  readonly remindAfter?: string;
  readonly oldDataRemovedAt?: string;
}

export type MigrationOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "migrated" };

const recordPath = (paths: PreviousInstallationPaths) => join(paths.newUserData, recordName);

async function readRecord(paths: PreviousInstallationPaths): Promise<MigrationRecord | null> {
  const text = await readFile(recordPath(paths), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return null;
  const record: unknown = JSON.parse(text);
  if (
    typeof record !== "object" ||
    record === null ||
    !("version" in record) ||
    record.version !== 1
  )
    throw new Error(`${recordPath(paths)} is not a known migration record.`);
  return record as MigrationRecord;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.next`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(`${path}.next`, path);
}

async function updateRecord(
  paths: PreviousInstallationPaths,
  change: Partial<Omit<MigrationRecord, "version">>,
): Promise<MigrationRecord> {
  const next: MigrationRecord = { ...(await readRecord(paths)), ...change, version: 1 };
  await mkdir(paths.newUserData, { recursive: true, mode: 0o700 });
  await writeJson(recordPath(paths), next);
  return next;
}

async function oldAppRunning(oldUserData: string): Promise<boolean> {
  const target = await readlink(join(oldUserData, "SingletonLock")).catch(() => "");
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const { stdout } = await run("/bin/ps", ["-o", "comm=", "-p", String(pid)]).catch(() => ({
    stdout: "",
  }));
  return oldAppExecutable.test(stdout.trim());
}

async function lockOldHome(oldHome: string): Promise<{ release(): void } | null> {
  const database = join(oldHome, databaseName);
  if (!existsSync(database)) return { release: () => undefined };
  const lockPath = (await realpath(database)) + ".runner.lock";
  if (!existsSync(lockPath)) return { release: () => undefined };
  const descriptor = openSync(lockPath, "r");
  try {
    flockSync(descriptor, "exnb");
  } catch {
    closeSync(descriptor);
    return null;
  }
  return { release: () => closeSync(descriptor) };
}

const refusal =
  "T3 Factory is still running. Quit T3 Factory, including its menu bar icon, then choose Retry. AgentEasel never stops it for you.";

async function whileOldInstallationStopped(
  paths: PreviousInstallationPaths,
  work: () => Promise<void>,
): Promise<{ readonly refused: string } | null> {
  if (await oldAppRunning(paths.oldUserData)) return { refused: refusal };
  const lock =
    paths.oldHome && existsSync(paths.oldHome)
      ? await lockOldHome(paths.oldHome)
      : { release: () => undefined };
  if (lock === null) return { refused: refusal };
  try {
    await work();
    return null;
  } finally {
    lock.release();
  }
}

const homeSkipped = new Set([
  databaseName,
  `${databaseName}-wal`,
  `${databaseName}-shm`,
  `${databaseName}.runner.lock`,
  tombstoneName,
]);

const stagingHome = (newHome: string) => `${newHome}.migrating`;

async function verifiedDatabaseCopy(oldHome: string, staging: string) {
  const scratch = join(staging, ".source");
  await mkdir(scratch);
  for (const suffix of ["", "-wal"])
    if (existsSync(join(oldHome, databaseName + suffix)))
      await cp(join(oldHome, databaseName + suffix), join(scratch, databaseName + suffix));
  const source = new DatabaseSync(join(scratch, databaseName));
  try {
    await backup(source, join(staging, databaseName));
  } finally {
    source.close();
  }
  await rm(scratch, { recursive: true });
  const copy = new DatabaseSync(join(staging, databaseName), { readOnly: true });
  try {
    const rows = copy.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok")
      throw new Error(`The copied database failed its integrity check: ${JSON.stringify(rows)}`);
  } finally {
    copy.close();
  }
}

async function copyHome(oldHome: string, newHome: string): Promise<"copied"> {
  const staging = stagingHome(newHome);
  await rm(staging, { recursive: true, force: true });
  await cp(oldHome, staging, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (source) => !homeSkipped.has(relative(oldHome, source)),
  });
  if (existsSync(join(oldHome, databaseName))) await verifiedDatabaseCopy(oldHome, staging);
  await rename(staging, newHome);
  return "copied";
}

async function migrateHome(
  paths: PreviousInstallationPaths,
  recorded: MigrationRecord["home"],
): Promise<HomeOutcome> {
  if (!paths.oldHome || !existsSync(paths.oldHome)) return "absent";
  const interrupted = recorded === "copying";
  const stagingLeft = existsSync(stagingHome(paths.newHome));
  if (existsSync(paths.newHome)) {
    if (interrupted && !stagingLeft) return "copied";
    await rm(stagingHome(paths.newHome), { recursive: true, force: true });
    return "kept-existing";
  }
  await updateRecord(paths, { home: "copying" });
  return copyHome(paths.oldHome, paths.newHome);
}

interface OldSettings {
  readonly launchAtLogin: boolean;
  readonly remoteServer: boolean;
}

async function migrateUserData(
  paths: PreviousInstallationPaths,
): Promise<{ outcome: ProfileOutcome; settings: OldSettings }> {
  const none = { launchAtLogin: false, remoteServer: false };
  if (!existsSync(paths.oldUserData)) return { outcome: "absent", settings: none };
  const newSettings = join(paths.newUserData, settingsName);
  if (existsSync(newSettings)) return { outcome: "kept-existing", settings: none };
  await mkdir(paths.newUserData, { recursive: true, mode: 0o700 });
  for (const name of partitionAllowlist) {
    const source = join(paths.oldUserData, partition, name);
    if (!existsSync(source)) continue;
    const destination = join(paths.newUserData, partition, name);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, preserveTimestamps: true });
  }
  for (const name of desktopFiles) {
    const source = join(paths.oldUserData, name);
    if (existsSync(source)) await cp(source, join(paths.newUserData, name));
  }
  const oldSettings = join(paths.oldUserData, settingsName);
  if (!existsSync(oldSettings)) return { outcome: "copied", settings: none };
  const text = await readFile(oldSettings, "utf8");
  const parsed = parseSettings(text);
  if (!parsed) {
    await writeFile(newSettings, text, { mode: 0o600 });
    return { outcome: "copied", settings: none };
  }
  const server = parsed.server;
  await writeJson(newSettings, {
    ...parsed,
    ...(isObject(server) ? { server: { ...server, credential: null } } : {}),
  });
  return {
    outcome: "copied",
    settings: {
      launchAtLogin: parsed.launchAtLogin === true,
      remoteServer: parsed.role === "client" && isObject(server),
    },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseSettings(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeTombstones(paths: PreviousInstallationPaths, migratedAt: string) {
  const tombstone = { application: "AgentEasel", migratedAt };
  for (const directory of [paths.oldHome, paths.oldUserData])
    if (directory && existsSync(directory))
      await writeFile(join(directory, tombstoneName), JSON.stringify(tombstone) + "\n");
}

const hasPreviousInstallation = (paths: PreviousInstallationPaths) =>
  (paths.oldHome !== null && existsSync(paths.oldHome)) || existsSync(paths.oldUserData);

export async function migratePreviousInstallation(
  paths: PreviousInstallationPaths,
  registerLoginItem: () => void,
  now: () => Date = () => new Date(),
): Promise<MigrationOutcome> {
  const existing = await readRecord(paths);
  if (existing?.completedAt) return { kind: "migrated" };
  if (!existing && !hasPreviousInstallation(paths)) return { kind: "none" };
  const refused = await whileOldInstallationStopped(paths, async () => {
    let record = existing ?? { version: 1 as const };
    if (!record.home || record.home === "copying") {
      record = await updateRecord(paths, { home: await migrateHome(paths, record.home) });
    }
    if (!record.userData) {
      const { outcome, settings } = await migrateUserData(paths);
      record = await updateRecord(paths, { userData: outcome, ...settings });
    }
    if (record.launchAtLogin) registerLoginItem();
    const completedAt = now();
    await writeTombstones(paths, completedAt.toISOString());
    const remindAfter = new Date(completedAt.getTime() + reminderDays * 86_400_000);
    await updateRecord(paths, {
      completedAt: completedAt.toISOString(),
      remindAfter: remindAfter.toISOString(),
      summarySeen: false,
    });
  });
  return refused ? { kind: "refused", reason: refused.refused } : { kind: "migrated" };
}

const removableData = (paths: PreviousInstallationPaths, record: MigrationRecord) =>
  record.oldDataRemovedAt !== undefined
    ? []
    : [
        record.home === "copied" ? paths.oldHome : null,
        record.userData === "copied" ? paths.oldUserData : null,
      ].filter((directory): directory is string => directory !== null && existsSync(directory));

export async function previousInstallation(
  paths: PreviousInstallationPaths,
): Promise<PreviousInstallation | null> {
  const record = await readRecord(paths);
  if (!record?.completedAt) return null;
  return {
    migratedAt: record.completedAt,
    home: record.home === "copying" || record.home === undefined ? "absent" : record.home,
    profile: record.userData ?? "absent",
    launchAtLogin: record.launchAtLogin === true,
    remoteServer: record.remoteServer === true,
    summaryPending: record.summarySeen !== true,
    oldDataPresent: removableData(paths, record).length > 0,
  };
}

export function removalDetail(previous: PreviousInstallation): string {
  if (previous.home !== "copied") return migrationText.removeDetail.profile;
  return previous.profile === "copied"
    ? migrationText.removeDetail.both
    : migrationText.removeDetail.home;
}

export async function skipPreviousInstallation(paths: PreviousInstallationPaths, now: Date) {
  const record = await readRecord(paths);
  await rm(stagingHome(paths.newHome), { recursive: true, force: true });
  const home = record?.home === "copied" ? "copied" : "skipped";
  const userData = record?.userData === "copied" ? "copied" : "skipped";
  if (home === "copied" || userData === "copied") await writeTombstones(paths, now.toISOString());
  await updateRecord(paths, { home, userData, completedAt: now.toISOString(), summarySeen: true });
}

export async function dismissMigrationSummary(paths: PreviousInstallationPaths): Promise<void> {
  await updateRecord(paths, { summarySeen: true });
}

export async function removalReminderDue(
  paths: PreviousInstallationPaths,
  now: Date,
): Promise<boolean> {
  const record = await readRecord(paths);
  return (
    record?.remindAfter !== undefined &&
    removableData(paths, record).length > 0 &&
    now.getTime() >= Date.parse(record.remindAfter)
  );
}

export async function postponeRemovalReminder(paths: PreviousInstallationPaths, now: Date) {
  await updateRecord(paths, {
    remindAfter: new Date(now.getTime() + reminderDays * 86_400_000).toISOString(),
  });
}

export async function removePreviousInstallation(
  paths: PreviousInstallationPaths,
  trash: (path: string) => Promise<void>,
  now: Date,
): Promise<{ readonly refused: string } | null> {
  const record = await readRecord(paths);
  const completedAt = record?.completedAt;
  if (!record || !completedAt)
    return { refused: "AgentEasel has not migrated a T3 Factory installation." };
  return whileOldInstallationStopped(paths, async () => {
    for (const directory of removableData(paths, record)) await trash(directory);
    await mkdir(paths.oldUserData, { recursive: true, mode: 0o700 });
    await writeTombstones(paths, completedAt);
    await updateRecord(paths, { oldDataRemovedAt: now.toISOString() });
  });
}
