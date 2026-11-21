import { operation } from "./operation.ts";

/** Desktop release track: stable Releases from tags, or nightly/manual beta builds from main. */
export type UpdateChannel = "stable" | "beta";

/** A desktop installation's updater, as its own window or an approved client sees it. */
export interface ApplicationUpdate {
  readonly state:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  readonly version: string | null;
  /** Download percentage and byte counts while downloading. */
  readonly progress: number | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly releaseNotes: string | null;
  readonly message: string | null;
  /** ISO time the feed was last read successfully. */
  readonly checkedAt: string | null;
}

/** The server installation's updater, operated by approved clients through `/api/server-update`. */
export interface ServerUpdate {
  /** Running release, or `source` for a source checkout. */
  readonly application: string;
  /** Null when the server is not a desktop installation with a release feed. */
  readonly channel: UpdateChannel | null;
  readonly update: ApplicationUpdate;
  /** Installing restarts the server; Runs stay open and reconcile afterwards. */
  readonly openRunCount: number;
}
export type ServerUpdateAction = "check" | "download" | "install";

/** Server update operations are answered by the server, not the Factory facade. */
export const serverUpdateOperations = {
  reportClientUpdate: operation<InstalledUpdateReceipt, null>()({
    method: "POST",
    path: "/api/client-update/installed",
    body: "json",
  }),
  getServerUpdate: operation<never, ServerUpdate>()({ method: "GET", path: "/api/server-update" }),
  checkServerUpdate: operation<never, ServerUpdate>()({
    method: "POST",
    path: "/api/server-update/check",
  }),
  downloadServerUpdate: operation<never, ServerUpdate>()({
    method: "POST",
    path: "/api/server-update/download",
  }),
  installServerUpdate: operation<never, ServerUpdate>()({
    method: "POST",
    path: "/api/server-update/install",
  }),
};

export interface InstalledUpdateReceipt {
  readonly receiptId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
}

export const releaseVersionPattern = /^\d{1,10}\.\d{1,10}\.\d{1,10}(?:-beta\.[1-9]\d{0,9})?$/;

export function isInstalledUpdateReceipt(value: unknown): value is InstalledUpdateReceipt {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 3) return false;
  return (
    "receiptId" in value &&
    typeof value.receiptId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.receiptId) &&
    "fromVersion" in value &&
    typeof value.fromVersion === "string" &&
    releaseVersionPattern.test(value.fromVersion) &&
    "toVersion" in value &&
    typeof value.toVersion === "string" &&
    releaseVersionPattern.test(value.toVersion) &&
    value.fromVersion !== value.toVersion
  );
}
