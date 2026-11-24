import { app } from "electron";
import electronUpdater from "electron-updater";
import type { ApplicationUpdate, UpdateChannel } from "@t3-factory/contracts";

/** The track an installation follows until its user chooses one: the track of its own build. */
export const buildChannel = (): UpdateChannel =>
  app.getVersion().includes("-beta.") ? "beta" : "stable";

export class Updates {
  private status: ApplicationUpdate = {
    state: "idle",
    version: null,
    progress: null,
    downloadedBytes: null,
    totalBytes: null,
    releaseNotes: null,
    message: null,
    checkedAt: null,
  };
  private readonly updater = electronUpdater.autoUpdater;
  private channel: UpdateChannel | null = null;

  constructor(private readonly changed: (status: ApplicationUpdate) => void) {}

  get current(): ApplicationUpdate {
    return this.status;
  }

  private set(change: Partial<ApplicationUpdate>) {
    this.status = { ...this.status, ...change };
    this.changed(this.status);
  }

  start() {
    this.set({
      state: "unsupported",
      message: "T3 Factory receives no more updates. Download AgentEasel to keep updating.",
    });
  }

  /**
   * Beta follows prereleases and stable Releases, whichever is newer; stable follows only
   * Releases. Leaving beta never downgrades: the installed beta stays until a newer Release.
   */
  private apply(channel: UpdateChannel) {
    this.channel = channel;
    this.updater.channel = channel === "beta" ? "beta" : "latest";
    this.updater.allowPrerelease = channel === "beta";
    this.updater.allowDowngrade = false;
  }

  /** A changed track discards an update found on the previous one and checks again. */
  configure(channel: UpdateChannel): string | null {
    if (this.status.state === "unsupported" || this.channel === null || channel === this.channel)
      return null;
    if (this.status.state === "checking" || this.status.state === "downloading")
      return "Wait for the current update check or download to finish before changing the channel.";
    this.apply(channel);
    this.set({ state: "idle", version: null, progress: null, releaseNotes: null, message: null });
    void this.check();
    return null;
  }

  async check(): Promise<void> {
    if (["unsupported", "downloaded", "downloading", "checking"].includes(this.status.state))
      return;
    await this.updater.checkForUpdates().catch(() => undefined);
  }

  /** A download starts only after an explicit action, never while checking metadata. */
  async download(): Promise<void> {
    if (this.status.state !== "available") return;
    this.set({ state: "downloading", progress: 0, downloadedBytes: 0, message: null });
    await this.updater.downloadUpdate().catch(() => undefined);
  }

  /** An installation that could not start leaves the app running on its current release. */
  fail(message: string) {
    this.set({ state: "error", progress: null, message });
  }

  /** Called only after the upgrade review was confirmed and the backend shut down in order. */
  install() {
    try {
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      this.set({
        state: "error",
        progress: null,
        message: `Installation failed: ${String(error)} Your data and role are unchanged.`,
      });
    }
  }
}
