import { expect, it } from "@effect/vitest";
import { factoryHarness } from "./support/factory.ts";
import { schemaSnapshot } from "./support/schema-snapshot.ts";

it("the current-schema snapshot matches the schema produced by AgentEasel migrations", async (context) => {
  // Arrange
  const harness = await factoryHarness(context, { freshDatabase: true });

  // Act
  const factory = await harness.open();

  // Assert
  await factory.close();
  const text = schemaSnapshot(harness.databasePath);
  await expect(text).toMatchFileSnapshot("../src/schema.sql");
});
