import { expect, it, vi } from "vite-plus/test";

const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(async () => null),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.4.1-beta.12", isPackaged: true },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: updater } }));

const { Updates } = await import("../src/updates.ts");

it("the final T3 Factory release never asks the feed, even when its user checks for updates", async () => {
  // Arrange
  const updates = new Updates(() => undefined);
  updates.start();

  // Act
  await updates.check();

  // Assert
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  expect(updates.current.state).toBe("unsupported");
});
