import { expect, it } from "vite-plus/test";
import { createDiagnosticRetry } from "../src/diagnostic-log.ts";

it("a recorded retry turns recording on before recovering and keeps only the attempts that recovery returned", async () => {
  // Arrange
  const steps: string[] = [];
  const retry = createDiagnosticRetry(async () => steps.push("enable"));
  await retry.retry(async () => ["earlier-attempt"]);

  // Act
  await retry.retry(async () => {
    steps.push(`recover with ${JSON.stringify(retry.getSnapshot())}`);
    return ["retried-attempt"];
  });

  // Assert
  expect(steps).toStrictEqual(["enable", "enable", "recover with []"]);
  expect(retry.getSnapshot()).toStrictEqual(["retried-attempt"]);
});
