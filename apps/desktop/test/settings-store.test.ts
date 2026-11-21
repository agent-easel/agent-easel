import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, type TestContext } from "vite-plus/test";
import { SettingsStore } from "../src/settings-store.ts";

async function profileDirectory(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "factory-desktop-settings-"));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

it.for(["light", "dark"] as const)(
  "a stored %s appearance survives upgrading the installation",
  async (appearance, context) => {
    // Arrange
    const directory = await profileDirectory(context);
    await writeFile(
      join(directory, "desktop-settings.json"),
      JSON.stringify({ version: 1, appearance }),
    );

    // Act
    const store = await SettingsStore.open(directory);

    // Assert
    expect(store.get().appearance).toBe(appearance);
  },
);

it("settings saved before appearance and alerts existed open in System with Notifications and the Dock badge on, and keep the installation's role", async (context) => {
  // Arrange
  const directory = await profileDirectory(context);
  await writeFile(
    join(directory, "desktop-settings.json"),
    JSON.stringify({
      version: 1,
      role: "server",
      server: null,
      launchAtLogin: true,
      updateChannel: "beta",
    }),
  );

  // Act
  const store = await SettingsStore.open(directory);

  // Assert
  expect(store.problem).toBeNull();
  expect(store.get()).toStrictEqual({
    version: 1,
    role: "server",
    server: null,
    launchAtLogin: true,
    menuBarIcon: false,
    updateChannel: "beta",
    appearance: "system",
    notifications: true,
    dockBadge: true,
    showRunDetails: false,
    windowBounds: null,
  });
});

it("turned-off Notifications and Dock badge and shown Run details are still chosen when the installation opens again", async (context) => {
  // Arrange
  const directory = await profileDirectory(context);
  const store = await SettingsStore.open(directory);
  await store.update({ notifications: false, dockBadge: false, showRunDetails: true });

  // Act
  const reopened = await SettingsStore.open(directory);

  // Assert
  expect(reopened.get()).toMatchObject({
    notifications: false,
    dockBadge: false,
    showRunDetails: true,
  });
});

it("the window size and position the user left are restored when the installation opens again", async (context) => {
  // Arrange
  const directory = await profileDirectory(context);
  const store = await SettingsStore.open(directory);
  await store.update({ windowBounds: { x: 120, y: 80, width: 1111, height: 777 } });

  // Act
  const reopened = await SettingsStore.open(directory);

  // Assert
  expect(reopened.get().windowBounds).toStrictEqual({ x: 120, y: 80, width: 1111, height: 777 });
});
