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

it("a late retry cannot replace the attempt selection of its replacement", async () => {
  // Arrange
  const retry = createDiagnosticRetry(async () => {});
  let finish = () => {};
  const held = new Promise<readonly string[]>((resolve) => {
    finish = () => resolve(["older"]);
  });
  let started = () => {};
  const recovering = new Promise<void>((resolve) => {
    started = resolve;
  });
  const older = retry.retry(() => {
    started();
    return held;
  });
  await recovering;
  await retry.retry(async () => ["newer"]);

  // Act
  finish();
  await older;

  // Assert
  expect(retry.getSnapshot()).toStrictEqual(["newer"]);
});
