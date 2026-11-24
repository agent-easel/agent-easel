import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { flockSync } from "fs-ext";
import type { PreviousInstallationPaths } from "../../src/previous-installation.ts";

export async function disposableInstallation(onFinished: (cleanup: () => Promise<void>) => void) {
  const root = await mkdtemp(join(tmpdir(), "agenteasel-migration-"));
  onFinished(() => rm(root, { recursive: true, force: true }));
  const paths: PreviousInstallationPaths = {
    oldHome: join(root, "home", ".t3-factory"),
    newHome: join(root, "home", ".agenteasel"),
    oldUserData: join(root, "Application Support", "T3 Factory"),
    newUserData: join(root, "Application Support", "AgentEasel"),
  };
  return { root, paths };
}

export async function seedServerHome(oldHome: string): Promise<DatabaseSync> {
  await mkdir(join(oldHome, "images", "run-1"), { recursive: true });
  await mkdir(join(oldHome, "credentials"), { recursive: true, mode: 0o700 });
  await writeFile(join(oldHome, "config.json"), '{"host":"127.0.0.1","port":4310}\n');
  await writeFile(join(oldHome, "credentials", "t3-oauth.json"), '{"token":"t3"}', { mode: 0o600 });
  await writeFile(join(oldHome, "images", "run-1", "screen.png"), "png bytes");
  const database = new DatabaseSync(join(oldHome, "factory.sqlite"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE flows (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL);
    INSERT INTO flows VALUES ('flow-1', 'Implement issue'), ('flow-2', 'Review PR');
    INSERT INTO runs VALUES ('run-1', 'flow-1');
  `);
  closeSync(openSync(join(oldHome, "factory.sqlite.runner.lock"), "a", 0o600));
  return database;
}

export async function seedDesktopProfile(
  oldUserData: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const partition = join(oldUserData, "Partitions", "factory-ui");
  await mkdir(join(partition, "Local Storage", "leveldb"), { recursive: true });
  await mkdir(join(partition, "IndexedDB", "factory_app_0.indexeddb.leveldb"), { recursive: true });
  await mkdir(join(partition, "Cache"), { recursive: true });
  await writeFile(join(partition, "Local Storage", "leveldb", "000003.log"), "run draft");
  await writeFile(
    join(partition, "IndexedDB", "factory_app_0.indexeddb.leveldb", "000003.log"),
    "draft image",
  );
  await writeFile(join(partition, "Cache", "data_0"), "cache");
  await writeFile(join(partition, "Cookies"), "cookie");
  await writeFile(join(oldUserData, "desktop-settings.json"), JSON.stringify(settings));
  await writeFile(join(oldUserData, "desktop-attention.json"), '{"version":1,"delivered":["a"]}');
  await writeFile(join(oldUserData, "pending-update.json"), '{"receiptId":"r"}');
}

export const serverSettings = {
  version: 1,
  role: "server",
  server: null,
  launchAtLogin: true,
  appearance: "dark",
  updateChannel: "beta",
};

export const clientSettings = {
  version: 1,
  role: "client",
  server: {
    url: "https://factory.tail.example:4312",
    trust: { mode: "pinned", anchor: "ca", fingerprint: "AB:CD" },
    credential: "a2V5Y2hhaW4tZW5jcnlwdGVk",
  },
  launchAtLogin: false,
};

export async function snapshot(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const digests = await Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      const digest = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      return [relative(directory, path), digest] as const;
    }),
  );
  return Object.fromEntries(digests);
}

export function holdBackendLock(oldHome: string): () => void {
  const descriptor = openSync(join(oldHome, "factory.sqlite.runner.lock"), "r");
  flockSync(descriptor, "exnb");
  return () => closeSync(descriptor);
}

export const rows = (path: string, sql: string) => {
  const database = new DatabaseSync(path, { readOnly: true });
  const result = database.prepare(sql).all();
  database.close();
  return result;
};

export const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

export const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

export const mode = async (path: string) => (await stat(path)).mode & 0o777;

export const leaveSingletonLock = (oldUserData: string, pid: number) =>
  symlink(`old-host.local-${pid}`, join(oldUserData, "SingletonLock"));

export async function runUnrelatedElectronApp(
  root: string,
  onFinished: (cleanup: () => void) => void,
): Promise<number> {
  const macOS = join(root, "Other.app", "Contents", "MacOS");
  await mkdir(macOS, { recursive: true });
  await symlink("/bin/sleep", join(macOS, "Electron"));
  const child = spawn(join(macOS, "Electron"), ["30"], { stdio: "ignore" });
  onFinished(() => child.kill());
  await new Promise((resolve) => child.once("spawn", resolve));
  return child.pid!;
}

export async function writeMigrationRecord(newUserData: string, record: Record<string, unknown>) {
  await mkdir(newUserData, { recursive: true });
  await writeFile(join(newUserData, "previous-installation.json"), JSON.stringify(record));
}
