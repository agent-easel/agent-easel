import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { readFile, realpath, stat, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import type {
  EnablementRule,
  HomeReason,
  HomeSource,
  ReportingInstallation,
  T3Connection,
  T3ReadReason,
  T3ReadStage,
} from "@agent-easel/contracts";
import { noDiagnosticAttempt, type DiagnosticAttemptHandle } from "./diagnostic-log.ts";
import {
  HomeRefusal,
  homeFailureReason,
  isRecorded,
  markRecorded,
  reportingHarnessName,
  reportingPaths,
  type ReportingPaths,
} from "./reporting-diagnostics.ts";
import { isLocalEndpoint } from "./endpoint-local.ts";
import { withReportingInstallationActions } from "./reporting-installation-actions.ts";
import { isReportingDriver, providerReporting } from "./reporting-drivers.ts";
import { HARNESS_PROFILES, type ResolvedHome } from "./harness-profiles.ts";
import { boundary } from "./effect-operations.ts";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected a configuration object.");
  return value as Record<string, unknown>;
}

function expandHomePath(value: string, home: string): string {
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(home, value.slice(2));
  }
  return value;
}

/** The only target of a list that names no instance: discovery refused or found none on. */
const discoveryResult = (
  kind: "discovery-refused" | "none-enabled",
  message: string,
): ReportingInstallation =>
  withReportingInstallationActions({
    id: kind === "discovery-refused" ? "unavailable" : "none-enabled",
    kind,
    provider: "Unknown",
    instances: [],
    path: null,
    skillsPath: null,
    status: "needs-attention",
    message,
    launchSkill: null,
    runtimeEvidence: "UNVERIFIED",
  });

function assertDirectHomeSupported(instance: Record<string, unknown>) {
  const config = record(instance.config ?? {});
  if (config.setupMode === "managed")
    throw new HomeRefusal(
      "Managed Codex runtime home resolution requires manual verification. This installer supports explicit direct homes.",
      "managed_setup",
      "not_evaluated",
    );
  if (config.launchArgs && (!Array.isArray(config.launchArgs) || config.launchArgs.length))
    throw new HomeRefusal(
      "Custom launch arguments may override configuration. Use manual setup for this provider.",
      "custom_launch_args",
      "not_evaluated",
    );
  if (config.shadowHomePath)
    throw new HomeRefusal(
      "Codex shadow homes require manual verification of shared configuration; installation is unavailable.",
      "shadow_home",
      "not_evaluated",
    );
}

type HomeCandidate = { readonly source: HomeSource; readonly directory: string };

function providerEnvironmentValue(instance: Record<string, unknown>, name: string) {
  const variables = Array.isArray(instance.environment) ? instance.environment.map(record) : [];
  const value = variables.findLast((item) => item.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}

function resolveReportingHome(instance: Record<string, unknown>, home: ResolvedHome) {
  assertDirectHomeSupported(instance);
  const config = record(instance.config ?? {});
  const configuredHome = typeof config.homePath === "string" ? config.homePath.trim() : "";
  const environmentHome = providerEnvironmentValue(instance, home.envName)?.trim();
  const userHome = homedir();
  const candidates: HomeCandidate[] = [];
  for (const [source, value] of [
    ["configured_path", configuredHome],
    ["environment", environmentHome],
  ] as const) {
    if (!value) continue;
    const directory = expandHomePath(value, userHome);
    if (candidates.length === 0 && !isAbsolute(directory))
      throw new HomeRefusal(
        "Relative provider homes cannot be resolved from AgentEasel. Set an absolute homePath or a tilde-based path in this T3 Code provider's settings.",
        "relative_path",
        source,
      );
    candidates.push({ source, directory });
  }
  if (candidates.length)
    return { directory: candidates[0]!.directory, assumedDefault: false, candidates };
  const directory = home.defaultDirectory ? join(userHome, home.defaultDirectory) : userHome;
  return {
    directory,
    assumedDefault: true,
    candidates: [{ source: "default", directory }] as const,
  };
}

async function vibeReportingDirectory(instance: Record<string, unknown>) {
  const variables = Array.isArray(instance.environment) ? instance.environment.map(record) : [];
  if (
    variables.some(
      ({ name, valueRedacted }) =>
        valueRedacted === true && ["VIBE_HOME", "HOME", "VIBE_MCP_SERVERS"].includes(String(name)),
    )
  )
    throw new HomeRefusal(
      "Vibe's effective configuration depends on redacted T3 Code settings. Use manual setup.",
      "redacted_environment",
      "not_evaluated",
    );
  if (providerEnvironmentValue(instance, "VIBE_MCP_SERVERS"))
    throw new HomeRefusal(
      "VIBE_MCP_SERVERS can override Vibe's configuration. Review it before manual setup.",
      "environment_override",
      "not_evaluated",
    );
  const userHome = providerEnvironmentValue(instance, "HOME") || homedir();
  const home = expandHomePath(
    providerEnvironmentValue(instance, "VIBE_HOME") || "~/.vibe",
    userHome,
  );
  if (!isAbsolute(home) || !isAbsolute(userHome))
    throw new HomeRefusal(
      "Set an absolute VIBE_HOME and HOME in this T3 Code provider's environment.",
      "relative_path",
      "vibe_home",
    );
  const info = await stat(home).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (info && !info.isDirectory())
    throw new HomeRefusal(
      "Vibe's configured home must be a directory.",
      "not_a_directory",
      "vibe_home",
    );
  return info ? realpath(home) : home;
}

const realpathIfPresent = (directory: string) =>
  realpath(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return directory;
    throw error;
  });

async function antigravityConfigDirectory(stateDirectory: string, instanceId: string) {
  const state = await realpath(stateDirectory);
  const key = createHash("sha256").update(instanceId).digest("hex");
  const profile = join(state, "providers", "antigravity", key);
  const runtime = await lstat(join(profile, "antigravity-acp")).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HomeRefusal(
        "Install and sign in to Antigravity in T3 Code → Settings → Providers, then check again.",
        "profile_missing",
        "t3_profile",
      );
    }
    throw error;
  });
  if ((await realpath(profile)) !== profile)
    throw new HomeRefusal(
      "The T3 Code Antigravity profile must be a local directory.",
      "profile_unsupported",
      "t3_profile",
    );
  if (!runtime.isDirectory())
    throw new HomeRefusal(
      "The antigravity-acp folder inside the T3 Code profile must be a local directory.",
      "profile_unsupported",
      "t3_profile",
    );
  const directory = join(profile, "config");
  const config = await lstat(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (config && !config.isDirectory())
    throw new HomeRefusal(
      "The Antigravity config must be a directory.",
      "not_a_directory",
      "t3_profile",
    );
  return directory;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

function reportingHarness(instance: unknown): unknown {
  const driver = field(instance, "driver");
  if (driver !== "acpRegistry") return driver;
  const config = field(instance, "config");
  const id = field(config, "agentId");
  const source = field(config, "source");
  const command = field(config, "commandPath");
  return typeof id === "string" &&
    id.trim() === "mistral-vibe" &&
    (source === undefined || source === "registry") &&
    (command === undefined || (typeof command === "string" && command.trim() === ""))
    ? "mistral-vibe"
    : driver;
}

/**
 * Drivers T3 leaves off until the user turns them on. T3 holds this default in its code, not in
 * the settings file, so it is repeated here; a driver T3 adds later is treated as on by default.
 */
const DEFAULT_DISABLED_DRIVERS: readonly unknown[] = [
  "cursor",
  "grok",
  "fx",
  "kiro",
  "muse",
  "pi",
  "opencode",
  "antigravity",
];

const BUILT_IN_DEFAULT_DRIVERS: readonly string[] = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "fx",
  "opencode",
  "antigravity",
  "kiro",
  "pi",
  "muse",
];

class SettingsReadError extends Error {
  reason: "settings_unreadable" | "settings_malformed";
  constructor(cause: unknown, reason: "settings_unreadable" | "settings_malformed") {
    super(cause instanceof Error ? cause.message : "Settings unavailable.", { cause });
    this.reason = reason;
  }
}

async function readT3Settings(
  stateDirectory: string,
): Promise<{ settings: Record<string, unknown>; missing: boolean }> {
  const raw = await readFile(join(stateDirectory, "settings.json"), "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new SettingsReadError(error, "settings_unreadable");
  });
  try {
    return { settings: record(JSON.parse(raw ?? "{}")), missing: raw === undefined };
  } catch (error) {
    throw new SettingsReadError(error, "settings_malformed");
  }
}

function configuredProviderInstances(settings: Record<string, unknown>): Record<string, unknown> {
  return settings.providerInstances === undefined ? {} : record(settings.providerInstances);
}

function hydrateProviderInstances(configured: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...configured };
  for (const driver of BUILT_IN_DEFAULT_DRIVERS) {
    if (!Object.hasOwn(merged, driver)) merged[driver] = { driver };
  }
  return merged;
}

/**
 * T3's own rule: an explicit `false` on the instance or inside its config (where older settings
 * files kept it) wins; otherwise the instance flag, then the config flag, then the driver default.
 */
function enabledInT3(instance: unknown): { enabled: boolean; rule: EnablementRule } {
  const flag = field(instance, "enabled");
  const configFlag = field(field(instance, "config"), "enabled");
  if (flag === false) return { enabled: false, rule: "instance_disabled" };
  if (configFlag === false) return { enabled: false, rule: "config_disabled" };
  if (flag === true) return { enabled: true, rule: "instance_enabled" };
  if (configFlag === true) return { enabled: true, rule: "config_enabled" };
  return DEFAULT_DISABLED_DRIVERS.includes(field(instance, "driver"))
    ? { enabled: false, rule: "driver_default_off" }
    : { enabled: true, rule: "driver_default_on" };
}

interface EnablementVerdict {
  readonly id: string;
  readonly instance: unknown;
  readonly enabled: boolean;
  readonly rule: EnablementRule;
}

function evaluateEnablement(
  settings: Record<string, unknown>,
  instances: Record<string, unknown>,
): EnablementVerdict[] {
  const projectEnabled = new Set(
    Object.values(field(settings, "projectSettingsOverrides") ?? {}).flatMap((overrides) =>
      Object.entries(field(overrides, "providerInstances") ?? {})
        .filter(([, override]) => field(override, "enabled") === true)
        .map(([id]) => id),
    ),
  );
  return Object.entries(instances).map(([id, instance]) => {
    const base = enabledInT3(instance);
    return projectEnabled.has(id) && !base.enabled
      ? { id, instance, enabled: true, rule: "project_enabled" }
      : { id, instance, ...base };
  });
}

/**
 * Reporting drivers with no instance T3 keeps on, by the same settings and enablement rule as
 * discovery. A missing or unreadable settings file names none.
 */
export async function firstRunReportingState(
  stateDirectory: string,
): Promise<{ harnessesOffInT3: string[]; reportingEligibility: string }> {
  try {
    const { settings } = await readT3Settings(stateDirectory);
    const configured = configuredProviderInstances(settings);
    const verdicts = evaluateEnablement(settings, hydrateProviderInstances(configured));
    const enabled = verdicts
      .filter(({ enabled }) => enabled)
      .map(({ id, instance }): [string, unknown] => [id, instance])
      .sort(([left], [right]) => left.localeCompare(right));
    const on = new Set(enabled.map(([, instance]) => reportingHarness(instance)));
    const harnessesOffInT3 = [
      ...new Set(
        Object.entries(configured)
          .map(([, instance]) => reportingHarness(instance))
          .filter((driver) => isReportingDriver(driver) && !on.has(driver)),
      ),
    ].map(String);
    return {
      harnessesOffInT3,
      reportingEligibility: createHash("sha256").update(JSON.stringify(enabled)).digest("hex"),
    };
  } catch {
    return { harnessesOffInT3: [], reportingEligibility: "unreadable" };
  }
}

const targetFor = Effect.fn(function* (
  stateDirectory: string,
  id: string,
  raw: unknown,
  attempt: DiagnosticAttemptHandle,
  paths: ReportingPaths,
): Generator<Effect.Effect<unknown, unknown>, ReportingInstallation, never> {
  const instance = record(raw);
  const driver = reportingHarness(instance);
  const harness = reportingHarnessName(driver);
  const hashed = attempt.hash(id);
  const homeEntry = (
    outcome: "ok" | "failed" | "skipped",
    homeSource: HomeSource,
    reason: Parameters<typeof homeEntryFor>[3],
    path: string | null,
  ) => attempt.record(homeEntryFor(outcome, hashed, harness, reason, homeSource, path));
  if (!isReportingDriver(driver)) {
    yield* homeEntry("skipped", "not_evaluated", "profile_unsupported", null);
    return withReportingInstallationActions({
      id,
      kind: "instance",
      provider: String(driver),
      instances: [id],
      path: null,
      skillsPath: null,
      status: "unsupported",
      message: providerReporting(driver).explanation,
      launchSkill: null,
      runtimeEvidence: "UNVERIFIED",
    });
  }
  const profile = HARNESS_PROFILES[driver];
  const base = {
    id,
    kind: "instance" as const,
    provider: String(driver),
    instances: [id],
    launchSkill: null,
    runtimeEvidence: "UNVERIFIED" as const,
  };
  const targetAt = (directory: string, message: string) => {
    const path = join(directory, profile.config.file);
    return withReportingInstallationActions({
      ...base,
      id: createHash("sha256").update(path).digest("hex"),
      path,
      skillsPath: profile.skillsFolder(directory),
      status: "not-installed",
      message,
    });
  };
  const homePath = (directory: string) =>
    driver === "codex" ? paths.codexPath(directory, directory) : paths.path(directory);
  let examined: HomeSource = "not_evaluated";
  let examinedPath: string | null = null;
  return yield* Effect.gen(function* (): Generator<
    Effect.Effect<unknown, unknown>,
    ReportingInstallation,
    never
  > {
    if (profile.home.kind === "antigravity-profile") {
      examined = "t3_profile";
      const directory = yield* boundary(() => antigravityConfigDirectory(stateDirectory, id));
      yield* homeEntry("ok", "t3_profile", "chosen", homePath(directory));
      return targetAt(
        directory,
        "Installs in this provider's T3 Code profile. T3 Code disables its built-in text generation for Antigravity profiles with user MCP servers.",
      );
    }
    if (profile.home.kind === "fixed") {
      examined = "fixed";
      const directory = join(homedir(), profile.home.directory);
      const resolved = yield* boundary(() => realpathIfPresent(directory));
      yield* homeEntry("ok", "fixed", "chosen", homePath(resolved));
      return targetAt(resolved, profile.home.message);
    }
    if (profile.home.kind === "vibe") {
      examined = "vibe_home";
      const directory = yield* boundary(() => vibeReportingDirectory(instance));
      yield* homeEntry("ok", "vibe_home", "chosen", homePath(directory));
      return targetAt(directory, "Install once for all Vibe instances using this home.");
    }
    const resolved = resolveReportingHome(instance, profile.home);
    examined = resolved.candidates[0].source;
    examinedPath = homePath(resolved.directory);
    const directory = yield* boundary(() => realpath(resolved.directory));
    if (!(yield* boundary(() => stat(directory))).isDirectory())
      throw new HomeRefusal("Harness home is not a directory.", "not_a_directory", examined);
    for (const [index, candidate] of resolved.candidates.entries())
      yield* homeEntry(
        index === 0 ? "ok" : "skipped",
        candidate.source,
        index === 0 ? "chosen" : "candidate_unused",
        index === 0 ? homePath(directory) : homePath(candidate.directory),
      );
    return targetAt(
      directory,
      resolved.assumedDefault
        ? "Using the standard home for this OS user. If T3 Code inherits a custom configuration directory at launch, verify that directory manually before installing."
        : "Install once for all projects and Agents using this home.",
    );
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      const message = error instanceof Error ? error.message : "Configuration unavailable.";
      const refusal = error instanceof HomeRefusal ? error : undefined;
      markRecorded(error);
      return homeEntry(
        "failed",
        refusal?.source ?? examined,
        refusal?.reason ?? homeFailureReason(error),
        refusal ? null : examinedPath,
      ).pipe(
        Effect.as(
          withReportingInstallationActions({
            ...base,
            path: null,
            skillsPath: null,
            status: "needs-attention" as const,
            message:
              profile.home.kind === "antigravity-profile"
                ? message
                : `Restore the accessible harness home or use manual setup. ${message}`,
          }),
        ),
      );
    }),
  );
});

function homeEntryFor(
  outcome: "ok" | "failed" | "skipped",
  instance: string,
  driver: ReturnType<typeof reportingHarnessName>,
  reason: HomeReason,
  homeSource: HomeSource,
  path: string | null,
) {
  return { type: "home", outcome, instance, driver, homeSource, reason, path } as const;
}

const managedHost = Effect.fn(function* () {
  const paths =
    process.platform === "darwin"
      ? [
          "/Library/Application Support/T3Code/policy.json",
          "/Library/Managed Preferences/com.t3tools.t3code.plist",
        ]
      : ["/etc/t3code/policy.json"];
  const present = yield* Effect.forEach(
    paths,
    (path) =>
      boundary(() => lstat(path)).pipe(
        Effect.map(() => true),
        Effect.catch((error) => Effect.succeed((error as NodeJS.ErrnoException).code !== "ENOENT")),
      ),
    { concurrency: "unbounded" },
  );
  return present.some(Boolean);
});

const enabledLocalReportingInstances = Effect.fn(function* (
  stateDirectory: string,
  connection: T3Connection,
  attempt: DiagnosticAttemptHandle = noDiagnosticAttempt,
) {
  const read = (stage: T3ReadStage, outcome: "ok" | "failed", reason: T3ReadReason) =>
    attempt.record({ type: "t3_state_read", outcome, stage, reason });
  const failed = (error: unknown, stage: T3ReadStage, reason: T3ReadReason) =>
    Effect.sync(() => markRecorded(error)).pipe(Effect.andThen(read(stage, "failed", reason)));
  const context = connection.authorizationContext;
  if (connection.state !== "ready" || !context) {
    yield* read("connection", "failed", "connection_not_ready");
    return {
      problem: "Connect and authorize T3 Code before discovering installation targets.",
    } as const;
  }
  yield* read("connection", "ok", "read_ok");
  if (!isLocalEndpoint(context.endpoint)) {
    yield* read("endpoint", "failed", "remote_endpoint");
    return {
      problem:
        "Remote execution hosts require manual installation on that host. AgentEasel will not configure its own home for a remote host.",
    } as const;
  }
  yield* read("endpoint", "ok", "read_ok");
  if (process.platform === "win32" || (yield* managedHost())) {
    yield* read("policy", "failed", "managed_host");
    return {
      problem:
        "Managed or unsupported host configuration requires administrator-reviewed manual installation. AgentEasel will not infer effective provider settings.",
    } as const;
  }
  yield* read("policy", "ok", "read_ok");
  const environment = (yield* boundary(() =>
    readFile(join(stateDirectory, "environment-id"), "utf8"),
  ).pipe(Effect.tapError((error) => failed(error, "identity", "identity_unreadable")))).trim();
  if (environment !== context.environmentId) {
    yield* read("identity", "failed", "identity_mismatch");
    return {
      problem:
        "Cannot discover local T3 Code configuration: Connected T3 Code identity does not match local state. Set FACTORY_T3_STATE_DIRECTORY to the owning local T3 Code state directory; remote provisioning is unsupported.",
    } as const;
  }
  yield* read("identity", "ok", "read_ok");
  const loaded = yield* boundary(() => readT3Settings(stateDirectory)).pipe(
    Effect.tapError((error) =>
      failed(
        error,
        "settings",
        error instanceof SettingsReadError ? error.reason : "settings_unreadable",
      ),
    ),
  );
  yield* read("settings", "ok", loaded.missing ? "settings_missing" : "read_ok");
  const instances = hydrateProviderInstances(configuredProviderInstances(loaded.settings));
  const verdicts = evaluateEnablement(loaded.settings, instances);
  yield* Effect.forEach(
    verdicts.filter(({ instance }) => isReportingDriver(reportingHarness(instance))),
    ({ id, instance, enabled, rule }) =>
      attempt.record({
        type: "enablement",
        outcome: enabled ? "ok" : "skipped",
        instance: attempt.hash(id),
        driver: reportingHarnessName(reportingHarness(instance)),
        enabled,
        rule,
      }),
    { discard: true },
  );
  return {
    instances: verdicts
      .filter(({ enabled }) => enabled)
      .map(({ id, instance }): [string, unknown] => [id, instance]),
  } as const;
});

export type VibeReportingLookup =
  | { readonly instances: ReadonlySet<string>; readonly problem?: never }
  | { readonly problem: string; readonly instances?: never };

export const readVibeReportingInstances = (stateDirectory: string, connection: T3Connection) =>
  enabledLocalReportingInstances(stateDirectory, connection).pipe(
    Effect.map((result): VibeReportingLookup =>
      "problem" in result
        ? { problem: result.problem }
        : {
            instances: new Set(
              result.instances
                .filter(([, instance]) => reportingHarness(instance) === "mistral-vibe")
                .map(([id]) => id),
            ),
          },
    ),
    Effect.catch(() =>
      Effect.succeed({
        problem:
          "Cannot read the local T3 Code configuration to identify ACP Registry providers. Check the T3 Code state directory on the AgentEasel host.",
      }),
    ),
  );

export const discoverReporting = Effect.fn(function* (
  stateDirectory: string,
  connection: T3Connection,
  attempt: DiagnosticAttemptHandle = noDiagnosticAttempt,
): Generator<Effect.Effect<unknown, unknown>, ReportingInstallation[], never> {
  return yield* Effect.gen(function* (): Generator<
    Effect.Effect<unknown, unknown>,
    ReportingInstallation[],
    never
  > {
    const result = yield* enabledLocalReportingInstances(stateDirectory, connection, attempt);
    if ("problem" in result) return [discoveryResult("discovery-refused", result.problem)];
    const paths = yield* boundary(() => reportingPaths(stateDirectory));
    const targets = yield* Effect.forEach(
      result.instances,
      ([id, value]) => targetFor(stateDirectory, id, value, attempt, paths),
      { concurrency: 1 },
    );
    const grouped = new Map<string, ReportingInstallation>();
    for (const target of targets) {
      const previous = grouped.get(target.id);
      grouped.set(
        target.id,
        previous
          ? { ...previous, instances: [...previous.instances, ...target.instances] }
          : target,
      );
    }
    if (grouped.size) return [...grouped.values()];
    yield* attempt.record({
      type: "t3_state_read",
      outcome: "failed",
      stage: "settings",
      reason: "none_enabled",
    });
    return [
      discoveryResult(
        "none-enabled",
        "No enabled provider instances found in local T3 Code settings.",
      ),
    ];
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      return (
        Cause.hasInterruptsOnly(cause) || isRecorded(error)
          ? Effect.void
          : attempt.record({
              type: "unexpected_error",
              outcome: "failed",
              step: "reporting_discovery",
              reason: "unexpected_error",
            })
      ).pipe(
        Effect.as([
          discoveryResult(
            "discovery-refused",
            `Cannot discover local T3 Code configuration: ${error instanceof Error ? error.message.replace(/\.$/, "") : "unavailable"}. Check that T3 Code has run on this computer as this user, or set FACTORY_T3_STATE_DIRECTORY to the owning local T3 Code state directory.`,
          ),
        ]),
      );
    }),
  );
});
