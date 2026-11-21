import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isInstalledUpdateReceipt, serverUpdateOperations } from "@t3-factory/contracts";
import { FACTORY_MINIMUM_SERVER_PROTOCOL, FACTORY_PROTOCOL } from "@t3-factory/domain-validation";
import type { ApprovedConnection } from "./approved-client.ts";

export const hostReceiptPath = (profile: string) => join(profile, "pending-update.json");

const clientDirectory = (profile: string, server: string) =>
  join(profile, "client-updates", createHash("sha256").update(server).digest("hex"));

export async function stageUpdate(
  profile: string,
  server: string | null,
  fromVersion: string,
  toVersion: string,
) {
  const receipt = { receiptId: randomUUID(), fromVersion, toVersion };
  if (!isInstalledUpdateReceipt(receipt)) return;
  const directory = server === null ? profile : clientDirectory(profile, server);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path =
    server === null ? hostReceiptPath(profile) : join(directory, `pending-${toVersion}.json`);
  await writeFile(path, JSON.stringify(receipt), { mode: 0o600, flush: true });
}

export async function reportClientUpdates(
  profile: string,
  server: string,
  installedVersion: string,
  connection: Pick<ApprovedConnection, "request">,
) {
  const directory = clientDirectory(profile, server);
  const files: string[] = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const pendingName = `pending-${installedVersion}.json`;
  if (files.includes(pendingName)) {
    const pending = join(directory, pendingName);
    const receipt: unknown = JSON.parse(await readFile(pending, "utf8"));
    if (isInstalledUpdateReceipt(receipt) && receipt.toVersion === installedVersion) {
      const verified = receipt.receiptId + ".json";
      await rename(pending, join(directory, verified));
      files.push(verified);
    }
  }
  for (const name of files.filter((name) => !name.startsWith("pending-"))) {
    const path = join(directory, name);
    const receipt: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isInstalledUpdateReceipt(receipt) || name !== receipt.receiptId + ".json") continue;
    const reply = await connection.request(
      "POST",
      serverUpdateOperations.reportClientUpdate.path,
      {
        "content-type": "application/json",
        "x-factory-request": "1",
        "x-factory-protocol": String(FACTORY_PROTOCOL),
        "x-factory-protocol-minimum": String(FACTORY_MINIMUM_SERVER_PROTOCOL),
      },
      Buffer.from(JSON.stringify(receipt)),
    );
    if (reply.status !== 200) return;
    await unlink(path);
  }
}
