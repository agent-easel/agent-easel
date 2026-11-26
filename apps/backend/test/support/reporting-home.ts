import type { TestContext } from "@effect/vitest";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Only caller-owned disposable directories are passed by test fixtures. */
export async function writeReportingState(
  state: string,
  environmentId: string,
  home: string,
  provider = "codex-main",
  driver = "codex",
  config: Record<string, unknown> = { homePath: home },
) {
  await writeFile(join(state, "environment-id"), environmentId);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: {
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
        [provider]: { driver, enabled: true, config },
      },
    }),
  );
}

/** Sets an environment variable for this test only. */
export function overrideEnvironment(context: TestContext, name: string, value: string) {
  const previous = process.env[name];
  process.env[name] = value;
  context.onTestFinished(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

export async function isolatedUserHome(context: TestContext, userName?: string) {
  const base = await mkdtemp(join(tmpdir(), "agenteasel-user-home-"));
  context.onTestFinished(() => rm(base, { recursive: true, force: true }));
  const home = userName === undefined ? base : join(base, userName);
  if (userName !== undefined) await mkdir(home);
  overrideEnvironment(context, "HOME", home);
  return home;
}
