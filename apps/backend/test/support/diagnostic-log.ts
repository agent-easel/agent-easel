import { assert, type TestContext } from "@effect/vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { FactoryOptions } from "../../src/index.ts";
import type { DiagnosticRecorder } from "../../src/diagnostic-log.ts";
import { factoryHarness } from "./factory.ts";
import { ControlledT3 } from "./controlled-t3.ts";

export const runtimeFile = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    pid: 4242,
    host: "0.0.0.0",
    port: 3773,
    origin: "http://127.0.0.1:3773",
    startedAt: "2026-11-20T08:00:00.000Z",
    serverVersion: "0.1.11",
    ...fields,
  });

export const throwingRecorder: DiagnosticRecorder = {
  open: () => Effect.succeed({ id: "00000000-0000-4000-8000-000000000000", generation: 1 }),
  append: () => {
    throw new Error("The diagnostic recorder failed to append.");
  },
  finish: () => Effect.die(new Error("The diagnostic recorder failed to finish.")),
};

export async function diagnosticHome(context: TestContext, file: string = runtimeFile()) {
  const harness = await factoryHarness(context);
  const state = join(harness.processHome, "t3-state");
  await mkdir(state);
  await writeFile(join(state, "server-runtime.json"), file);
  const open = (options: Omit<FactoryOptions, "databasePath"> = {}) =>
    harness.open({
      reportingStateDirectory: state,
      t3: new ControlledT3(),
      connectionRetryMs: 60_000,
      ...options,
    });
  return { harness, state, open };
}

export async function recordingHome(context: TestContext, file?: string) {
  const home = await diagnosticHome(context, file);
  const factory = await home.open();
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);
  return { ...home, factory };
}
