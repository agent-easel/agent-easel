import { assert, expect, it } from "@effect/vitest";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { driverHomes } from "./support/reporting.ts";
import { throwingRecorder } from "./support/diagnostic-log.ts";

const USER_NAME = "grzegorz.mandziak";
const CONFIG_CANARY = "sk-config-canary-7f3a91";
const ENVIRONMENT_CANARY = "env-canary-b81c20";

async function recordedCodexHome(context: Parameters<typeof driverHomes>[0]) {
  const fixture = await driverHomes(
    context,
    {
      "codex-work": {
        driver: "codex",
        config: {},
        environment: [{ name: "OPENAI_API_KEY", value: ENVIRONMENT_CANARY }],
      },
    },
    { userName: USER_NAME },
  );
  await mkdir(join(fixture.home, ".codex"));
  await writeFile(join(fixture.home, ".codex", "config.toml"), `api_key = "${CONFIG_CANARY}"\n`);
  assert((await fixture.factory.setDiagnosticRecording({ enabled: true })).ok);
  return fixture;
}

it("an exported discovery attempt names its verdicts but no username, raw path or configuration secret", async (context) => {
  // Arrange
  const { factory, home, state } = await recordedCodexHome(context);

  // Act
  const rechecked = await factory.recheckReporting();

  // Assert
  assert(rechecked.ok);
  const exported = await factory.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toContain("<CODEX_HOME>/config.toml");
  expect(exported.value).toContain("Check Agent reporting");
  expect(exported.value).not.toContain(USER_NAME);
  expect(exported.value).not.toContain(CONFIG_CANARY);
  expect(exported.value).not.toContain(ENVIRONMENT_CANARY);
  expect(exported.value).not.toContain("codex-work");
  expect(exported.value).not.toContain(home);
  expect(exported.value).not.toContain(await realpath(home));
  expect(exported.value).not.toContain(state);
  expect(exported.value).not.toContain(await realpath(state));
});

it("installing into two homes returns one attempt per home, each named for its harness", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    "codex-work": { driver: "codex", config: {} },
    "claude-work": { driver: "claudeAgent", config: {} },
  });
  await mkdir(join(home, ".codex"));
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const codex = await factory.installReporting({ targetId: targets.value[0]!.id });
  const claude = await factory.installReporting({ targetId: targets.value[1]!.id });

  // Assert
  assert(codex.ok && claude.ok);
  const attempts = [...codex.value.diagnosticAttempts!, ...claude.value.diagnosticAttempts!];
  expect(new Set(attempts).size).toBe(2);
  const page = await factory.listDiagnosticAttempts("", "", attempts.join(","));
  assert(page.ok);
  expect(page.value.attempts.map(({ operation, outcome }) => [operation, outcome])).toStrictEqual([
    ["reporting_install", "ok"],
    ["reporting_install", "ok"],
  ]);
  const exported = await factory.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toContain("Install in Codex");
  expect(exported.value).toContain("Install in Claude");
  expect(exported.value).toContain("Write Block skill");
});

it("an unwritable skills folder fails the install as before when the recorder fails too", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(
    context,
    { "claude-work": { driver: "claudeAgent", config: {} } },
    { factoryOptions: { diagnosticRecorder: throwingRecorder } },
  );
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);
  const skills = join(home, ".claude", "skills");
  await mkdir(skills, { recursive: true });
  await chmod(skills, 0o500);
  context.onTestFinished(() => chmod(skills, 0o700));
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "validation",
    message: expect.stringContaining("EACCES"),
  });
  const status = await factory.getDiagnosticLog();
  assert(status.ok);
  expect(status.value.dropped).toBeGreaterThan(0);
});

it("reading the reporting targets records nothing, even while recording", async (context) => {
  // Arrange
  const { factory } = await recordedCodexHome(context);

  // Act
  const targets = await factory.getReportingInstallations();

  // Assert
  assert(targets.ok);
  expect(await factory.listDiagnosticAttempts("", "", "")).toStrictEqual({
    ok: true,
    value: { attempts: [], nextCursor: null },
  });
});

it("a refused Codex shadow home is recorded with its own reason and no home source examined", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, {
    "codex-work": { driver: "codex", config: { shadowHomePath: "/somewhere/else" } },
  });
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const rechecked = await factory.recheckReporting();

  // Assert
  assert(rechecked.ok);
  const exported = await factory.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toContain("fail  Resolve Codex home");
  expect(exported.value).toContain("not evaluated");
  expect(exported.value).toContain("shadow_home");
  expect(exported.value).not.toContain("/somewhere/else");
});
