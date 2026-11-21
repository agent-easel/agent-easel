import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { readFile, realpath, stat, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import type { ReportingInstallation, T3Connection } from "@t3-factory/contracts";
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
    throw Error(
      "Managed Codex runtime home resolution requires manual verification. This installer supports explicit direct homes.",
    );
  if (config.launchArgs && (!Array.isArray(config.launchArgs) || config.launchArgs.length))
    throw Error(
      "Custom launch arguments may override configuration. Use manual setup for this provider.",
    );
  if (config.shadowHomePath)
    throw Error(
      "Codex shadow homes require manual verification of shared configuration; installation is unavailable.",
    );
}

function resolveReportingHome(instance: Record<string, unknown>, home: ResolvedHome) {
  assertDirectHomeSupported(instance);
  const config = record(instance.config ?? {});
  const variables = Array.isArray(instance.environment) ? instance.environment.map(record) : [];
  const configuredHome = typeof config.homePath === "string" ? config.homePath.trim() : "";
  const environmentHome = variables.findLast((item) => item.name === home.envName)?.value;
  const rawHome =
    configuredHome.length > 0
      ? configuredHome
      : typeof environmentHome === "string"
        ? environmentHome.trim()
        : "";
  const userHome = homedir();
  if (rawHome.length > 0) {
    const expanded = expandHomePath(rawHome, userHome);
    if (!isAbsolute(expanded))
      throw Error(
        "Relative provider homes cannot be resolved from Factory. Set an absolute homePath or a tilde-based path in this T3 provider's settings.",
      );
    return { directory: expanded, assumedDefault: false };
  }
  return {
    directory: home.defaultDirectory ? join(userHome, home.defaultDirectory) : userHome,
    assumedDefault: true,
  };
}

async function antigravityConfigDirectory(stateDirectory: string, instanceId: string) {
  const state = await realpath(stateDirectory);
  const key = createHash("sha256").update(instanceId).digest("hex");
  const profile = join(state, "providers", "antigravity", key);
  const runtime = await lstat(join(profile, "antigravity-acp")).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Error(
        "Install and sign in to Antigravity in T3 Code → Settings → Providers, then check again.",
      );
    }
    throw error;
  });
  if ((await realpath(profile)) !== profile)
    throw Error("The T3 Antigravity profile must be a local directory.");
  if (!runtime.isDirectory())
    throw Error("The antigravity-acp folder inside the T3 profile must be a local directory.");
  const directory = join(profile, "config");
  const config = await lstat(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (config && !config.isDirectory()) throw Error("The Antigravity config must be a directory.");
  return directory;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
 * Drivers T3 leaves off until the user turns them on. T3 holds this default in its code, not in
 * the settings file, so it is repeated here; a driver T3 adds later is treated as on by default.
 */
const DEFAULT_DISABLED_DRIVERS: readonly unknown[] = [
  "cursor",
  "grok",
  "muse",
  "pi",
  "opencode",
  "antigravity",
];

/**
 * T3's own rule: an explicit `false` on the instance or inside its config (where older settings
 * files kept it) wins; otherwise the instance flag, then the config flag, then the driver default.
 */
function enabledInT3(instance: unknown): boolean {
  const flag = field(instance, "enabled");
  const configFlag = field(field(instance, "config"), "enabled");
  if (flag === false || configFlag === false) return false;
  if (flag === true || configFlag === true) return true;
  return !DEFAULT_DISABLED_DRIVERS.includes(field(instance, "driver"));
}

/**
 * The provider instances T3 keeps off. A project that turns an instance on keeps it running in T3
 * even when the machine has it off, so it is not among them.
 */
function disabledInstances(settings: Record<string, unknown>): Set<string> {
  const projectEnabled = new Set(
    Object.values(field(settings, "projectSettingsOverrides") ?? {}).flatMap((overrides) =>
      Object.entries(field(overrides, "providerInstances") ?? {})
        .filter(([, override]) => field(override, "enabled") === true)
        .map(([id]) => id),
    ),
  );
  return new Set(
    Object.entries(record(settings.providerInstances))
      .filter(([id, instance]) => !projectEnabled.has(id) && !enabledInT3(instance))
      .map(([id]) => id),
  );
}

/**
 * Reporting drivers with no instance T3 keeps on, by the same settings and enablement rule as
 * discovery. A missing or unreadable settings file names none.
 */
export async function reportingDriversOffInT3(stateDirectory: string): Promise<string[]> {
  try {
    const settings = record(
      JSON.parse(await readFile(join(stateDirectory, "settings.json"), "utf8")),
    );
    const disabled = disabledInstances(settings);
    const instances = Object.entries(record(settings.providerInstances));
    const on = new Set(
      instances
        .filter(([id]) => !disabled.has(id))
        .map(([, instance]) => field(instance, "driver")),
    );
    return [
      ...new Set(
        instances
          .map(([, instance]) => field(instance, "driver"))
          .filter((driver) => isReportingDriver(driver) && !on.has(driver)),
      ),
    ].map(String);
  } catch {
    return [];
  }
}

const targetFor = Effect.fn(function* (
  stateDirectory: string,
  id: string,
  raw: unknown,
): Generator<Effect.Effect<unknown, unknown>, ReportingInstallation, never> {
  const instance = record(raw);
  const driver = instance.driver;
  if (!isReportingDriver(driver))
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
  return yield* Effect.gen(function* (): Generator<
    Effect.Effect<unknown, unknown>,
    ReportingInstallation,
    never
  > {
    if (profile.home.kind === "antigravity-profile") {
      const directory = yield* boundary(() => antigravityConfigDirectory(stateDirectory, id));
      return targetAt(
        directory,
        "Installs in this provider's T3 profile. T3 disables its built-in text generation for Antigravity profiles with user MCP servers.",
      );
    }
    if (profile.home.kind === "fixed") {
      const directory = join(homedir(), profile.home.directory);
      const resolved = yield* boundary(() => realpath(directory)).pipe(
        Effect.catch((error) =>
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? Effect.succeed(directory)
            : Effect.fail(error),
        ),
      );
      return targetAt(resolved, profile.home.message);
    }
    const resolved = resolveReportingHome(instance, profile.home);
    const directory = yield* boundary(() => realpath(resolved.directory));
    if (!(yield* boundary(() => stat(directory))).isDirectory())
      throw Error("Harness home is not a directory.");
    return targetAt(
      directory,
      resolved.assumedDefault
        ? "Using the standard home for this OS user. If T3 inherits a custom configuration directory at launch, verify that directory manually before installing."
        : "Install once for all projects and Agents using this home.",
    );
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      const message = error instanceof Error ? error.message : "Configuration unavailable.";
      return Effect.succeed(
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
      );
    }),
  );
});
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
export const discoverReporting = Effect.fn(function* (
  stateDirectory: string,
  connection: T3Connection,
): Generator<Effect.Effect<unknown, unknown>, ReportingInstallation[], never> {
  if (connection.state !== "ready" || !connection.authorizationContext)
    return [
      discoveryResult(
        "discovery-refused",
        "Connect and authorize T3 before discovering installation targets.",
      ),
    ];
  if (!isLocalEndpoint(connection.authorizationContext.endpoint))
    return [
      discoveryResult(
        "discovery-refused",
        "Remote execution hosts require manual installation on that host. Factory will not configure its own home for a remote host.",
      ),
    ];
  if (process.platform === "win32" || (yield* managedHost()))
    return [
      discoveryResult(
        "discovery-refused",
        "Managed or unsupported host configuration requires administrator-reviewed manual installation. Factory will not infer effective provider settings.",
      ),
    ];
  return yield* Effect.gen(function* (): Generator<
    Effect.Effect<unknown, unknown>,
    ReportingInstallation[],
    never
  > {
    const environment = (yield* boundary(() =>
      readFile(join(stateDirectory, "environment-id"), "utf8"),
    )).trim();
    if (environment !== connection.authorizationContext!.environmentId)
      return [
        discoveryResult(
          "discovery-refused",
          "Cannot discover local T3 configuration: Connected T3 identity does not match local state. Set FACTORY_T3_STATE_DIRECTORY to the owning local T3 state directory; remote provisioning is unsupported.",
        ),
      ];
    const settings = record(
      JSON.parse(yield* boundary(() => readFile(join(stateDirectory, "settings.json"), "utf8"))),
    );
    const disabled = disabledInstances(settings);
    const targets = yield* Effect.forEach(
      Object.entries(record(settings.providerInstances)).filter(([id]) => !disabled.has(id)),
      ([id, value]) => targetFor(stateDirectory, id, value),
      { concurrency: "unbounded" },
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
    return grouped.size
      ? [...grouped.values()]
      : [
          discoveryResult(
            "none-enabled",
            "No enabled provider instances found in local T3 settings.",
          ),
        ];
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      return Effect.succeed([
        discoveryResult(
          "discovery-refused",
          `Cannot discover local T3 configuration: ${error instanceof Error ? error.message.replace(/\.$/, "") : "unavailable"}. Check that T3 has run on this computer as this user, or set FACTORY_T3_STATE_DIRECTORY to the owning local T3 state directory.`,
        ),
      ]);
    }),
  );
});
