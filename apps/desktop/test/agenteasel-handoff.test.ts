import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vite-plus/test";
import { migratedToAgentEasel, tombstoneName } from "../src/agenteasel-handoff.ts";

it("a client installation that AgentEasel migrated is handed off although it has no data home", async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), "factory-handoff-"));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const userData = join(root, "userData");
  await mkdir(userData);
  await writeFile(join(userData, tombstoneName), "{}");

  // Act
  const migrated = migratedToAgentEasel(userData, join(root, "missing-home"));

  // Assert
  expect(migrated).toBe(true);
});
