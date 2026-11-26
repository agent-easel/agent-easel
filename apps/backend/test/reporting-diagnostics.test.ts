import { assert, expect, it } from "@effect/vitest";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { driverHomes, installFirstReportingTarget } from "./support/reporting.ts";
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

it("discovery records enabled and disabled unsupported instances in evaluator order without disclosing their identities", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, {
    "private-enabled": { driver: "private-driver", config: {} },
    "private-disabled": { driver: "private-driver", config: { enabled: false } },
  });
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const checked = await factory.recheckReporting();

  // Assert
  assert(checked.ok);
  const page = await factory.listDiagnosticAttempts(
    "",
    "",
    checked.value.diagnosticAttempts!.join(","),
  );
  assert(page.ok);
  const entries = page.value.attempts[0]!.entries.map(({ entry }) => entry);
  expect(entries.filter((entry) => entry.type === "enablement").slice(2, 4)).toMatchObject([
    { driver: "unknown", enabled: true, rule: "instance_enabled" },
    { driver: "unknown", enabled: false, rule: "config_disabled" },
  ]);
  expect(JSON.stringify(entries)).not.toContain("private-");
});

it("a read-only configuration directory explains the permissions refusal in the recheck", async (context) => {
  // Arrange
  const { factory, home } = await recordedCodexHome(context);
  const dir = join(home, ".codex");
  await chmod(dir, 0o500);
  context.onTestFinished(() => chmod(dir, 0o700));

  // Act
  const checked = await factory.recheckReporting();

  // Assert
  assert(checked.ok);
  expect(checked.value.installations[0]?.status).toBe("needs-attention");
  const exported = await factory.exportDiagnosticLog();
  assert(exported.ok);
  expect(exported.value).toContain("permission_denied");
});

it("a refused required skill read identifies the affected copy in the recheck", async (context) => {
  // Arrange
  const { factory, home } = await recordedCodexHome(context);
  await installFirstReportingTarget(factory);
  const file = join(home, ".codex", "skills", "factory-block", "SKILL.md");
  await chmod(file, 0o000);
  context.onTestFinished(() => chmod(file, 0o600));

  // Act
  const checked = await factory.recheckReporting();

  // Assert
  assert(checked.ok);
  const page = await factory.listDiagnosticAttempts(
    "",
    "",
    checked.value.diagnosticAttempts!.join(","),
  );
  assert(page.ok);
  expect(page.value.attempts[0]?.entries.map(({ entry }) => entry)).toContainEqual({
    type: "conflict_check",
    outcome: "failed",
    driver: "codex",
    reason: "skill_unreadable",
    file: "<CODEX_HOME>/skills/factory-block/SKILL.md",
  });
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
