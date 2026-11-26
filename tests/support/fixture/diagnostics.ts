import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

export function diagnosticsFixture({ factory, home, time }: Host) {
  const runtimeFile = join(home, "reporting-t3-state", "server-runtime.json");
  return {
    actions: {
      async t3Running() {
        await writeFile(
          runtimeFile,
          JSON.stringify({
            version: 1,
            pid: process.pid,
            port: 3773,
            origin: "http://127.0.0.1:3773",
            startedAt: new Date().toISOString(),
            serverVersion: "0.1.11",
          }),
        );
      },
      async expireRecording() {
        const status = requireSuccess(await factory.getDiagnosticLog());
        if (!status.until) throw new Error("Recording is off");
        time.advanceTo(Date.parse(status.until) + 1);
      },
      async hostRecords() {
        requireSuccess(await factory.setDiagnosticRecording({ enabled: true }));
      },
    },
    async reset() {
      requireSuccess(await factory.setDiagnosticRecording({ enabled: false }));
      requireSuccess(await factory.deleteDiagnosticLog());
      await rm(runtimeFile, { force: true });
    },
  };
}
