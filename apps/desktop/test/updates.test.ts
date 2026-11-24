import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(async () => null),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.4.1-beta.12", isPackaged: true },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: updater } }));

const { Updates } = await import("../src/updates.ts");

beforeEach(() => {
  vi.useFakeTimers();
  updater.checkForUpdates.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

it("the final T3 Factory release never checks the feed after it is installed", async () => {
  // Arrange
  const updates = new Updates(() => undefined);

  // Act
  updates.start();
  await updates.check();
  await vi.advanceTimersByTimeAsync(3600_000);

  // Assert
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  expect(updates.current.state).toBe("unsupported");
});
