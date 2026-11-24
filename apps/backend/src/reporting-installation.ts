import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Cause from "effect/Cause";
import { constants } from "node:fs";
import { access, lstat, readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse } from "smol-toml";
import type { ReportingInstallation, Result, T3Connection } from "@agent-easel/contracts";
import { FACTORY_BLOCK_SKILL } from "./factory-block-skill.ts";
import { FACTORY_CONFIGURE_SKILL } from "./factory-configure-skill.ts";
import { FACTORY_START_RUN_SKILL } from "./factory-start-run-skill.ts";
import { SETUP_FACTORY_SKILL } from "./setup-factory-skill.ts";
import { discoverReporting, record } from "./reporting-discovery.ts";
import { isReportingDriver } from "./reporting-drivers.ts";
import { HARNESS_PROFILES, type HarnessProfile } from "./harness-profiles.ts";
import { boundary } from "./effect-operations.ts";
import {
  RepairableInstallationError,
  withReportingInstallationActions,
} from "./reporting-installation-actions.ts";
import { failure } from "./result.ts";

/** Discovery gives a configuration path only to a reporting driver's target. */
function harnessProfile(target: ReportingInstallation): HarnessProfile {
  if (!isReportingDriver(target.provider))
    throw Error(`No harness profile for provider ${target.provider}.`);
  return HARNESS_PROFILES[target.provider];
}

/** A Factory skill's copy in the harness skills folder; the configuration sits in the home. */
const harnessSkillPath = (profile: HarnessProfile, configPath: string, skill: string) =>
  join(profile.skillsFolder(dirname(configPath)), skill, "SKILL.md");

function tomlEntry(profile: HarnessProfile, url: string) {
  const table =
    profile.config.format === "toml-array" ? "[[mcp_servers]]" : "[mcp_servers.factory-runtime]";
  const fields = Object.entries(profile.entry(url)).map(
    ([key, value]) => `${key} = ${JSON.stringify(value)}`,
  );
  return `\n${table}\n${fields.join("\n")}\n`;
}

function vibeMcpServers(config: Record<string, unknown>) {
  const servers = config.mcp_servers ?? [];
  if (!Array.isArray(servers)) throw Error("Vibe's mcp_servers must be an array.");
  return servers.map((server) => ({ ...record(server) }));
}

function vibeMcpEntry(config: Record<string, unknown>) {
  const entries = vibeMcpServers(config).filter(({ name }) => name === "factory-runtime");
  if (entries.length > 1)
    throw Error("Vibe has multiple factory-runtime MCP entries. Review them manually.");
  return entries[0];
}

const VIBE_INLINE_MCP_ARRAY = /^[ \t]*(?:mcp_servers|"mcp_servers"|'mcp_servers')[ \t]*=[ \t]*\[/gm;
const EDITED_REGISTRATION =
  "The AgentEasel registration was edited. Review the factory-runtime entry manually.";

function* vibeInsertions(
  before: string,
  block: string,
  inline: string,
  servers: Record<string, unknown>[],
  entry: Record<string, string>,
) {
  yield { text: before + block, servers: [...servers, entry] };
  const inserted = inline + (servers.length ? ", " : "");
  for (const match of before.matchAll(VIBE_INLINE_MCP_ARRAY)) {
    const offset = match.index + match[0].length;
    yield {
      text: before.slice(0, offset) + inserted + before.slice(offset),
      servers: [entry, ...servers],
    };
  }
}

function registeredVibe(
  before: string,
  config: Record<string, unknown>,
  block: string,
  entry: Record<string, string>,
  previous?: string,
) {
  const servers = vibeMcpServers(config);
  const inline = (value: string) => "{ " + value.trim().split("\n").slice(1).join(", ") + " }";
  if (previous !== undefined && !before.includes(previous) && !before.includes(inline(previous)))
    throw Error(EDITED_REGISTRATION);
  const candidates =
    previous === undefined
      ? vibeInsertions(before, block, inline(block), servers, entry)
      : [
          before.replace(previous, () => block),
          before.replace(inline(previous), () => inline(block)),
        ].map((text) => ({
          text,
          servers: servers.map((server) => (server.name === entry.name ? entry : server)),
        }));
  for (const candidate of candidates) {
    try {
      const parsed = parse(candidate.text);
      const actual = { ...parsed, mcp_servers: vibeMcpServers(parsed) };
      if (isDeepStrictEqual(actual, { ...config, mcp_servers: candidate.servers }))
        return candidate.text;
    } catch {
      continue;
    }
  }
  throw Error(
    "AgentEasel could not update Vibe's mcp_servers without changing other settings. Review the factory-runtime entry manually.",
  );
}

async function skillMatches(path: string) {
  try {
    return (await readFile(path, "utf8")) === FACTORY_BLOCK_SKILL;
  } catch {
    return false;
  }
}
/**
 * The user-invoked skills installed beside the required Factory Block skill. None of them affects
 * reporting readiness or Start; they share the one `launchSkill` status.
 */
const OPTIONAL_SKILLS: readonly { name: string; text: string }[] = [
  { name: "factory-start-run", text: FACTORY_START_RUN_SKILL },
  { name: "setup-factory", text: SETUP_FACTORY_SKILL },
  { name: "factory-configure", text: FACTORY_CONFIGURE_SKILL },
];
type OptionalSkillCopy = { name: string; text: string; path: string };
type OptionalSkillInspection = {
  state: "current" | "missing" | "outdated";
  /** The skills with a copy that is not current. */
  stale: readonly string[];
  /** Why a setup action cannot make the copy current, with the manual recovery step. */
  problem?: string;
};
/** The nearest existing directory a recursive mkdir of `directory` would write into. */
async function existingAncestor(directory: string): Promise<string> {
  try {
    await lstat(directory);
    return directory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(directory) === directory)
      throw error;
    return existingAncestor(dirname(directory));
  }
}
/**
 * One optional-skill copy. Its file type is checked without following links before any read, so a
 * FIFO, device or linked copy is reported instead of read; only a regular file's content is read.
 */
async function inspectOptionalSkillCopy({
  name,
  text,
  path,
}: OptionalSkillCopy): Promise<Pick<OptionalSkillInspection, "state" | "problem">> {
  const unwritable = async (state: "missing" | "outdated") => {
    const directory = await existingAncestor(dirname(path)).catch(() => dirname(path));
    return access(directory, constants.W_OK).then(
      () => ({ state }),
      () => ({
        state,
        problem: `The optional ${name} skill cannot be written because ${directory} is not writable. Fix its permissions, then Reinstall.`,
      }),
    );
  };
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1)
      return {
        state: "outdated" as const,
        problem: `The optional ${name} skill at ${path} is a symlink, special or hard-linked file, which AgentEasel leaves unchanged. Replace or remove it manually, then Reinstall.`,
      };
    if ((await readFile(path, "utf8")) === text) return { state: "current" as const };
    return await unwritable("outdated");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return unwritable("missing");
    return {
      state: "outdated" as const,
      problem: `The optional ${name} skill at ${path} cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"}). Fix its permissions, then Reinstall.`,
    };
  }
}
/**
 * Every copy of every optional skill: the least current state, the skills that are not current and
 * the first problem a setup action cannot fix.
 */
async function inspectOptionalSkills(
  copies: readonly OptionalSkillCopy[],
): Promise<OptionalSkillInspection> {
  const inspected = await Promise.all(copies.map(inspectOptionalSkillCopy));
  const states = inspected.map((copy) => copy.state);
  const state = states.includes("missing")
    ? "missing"
    : states.includes("outdated")
      ? "outdated"
      : "current";
  const stale = [
    ...new Set(copies.filter((_, index) => states[index] !== "current").map((copy) => copy.name)),
  ];
  const problem = inspected.find((copy) => copy.problem)?.problem;
  return problem ? { state, stale, problem } : { state, stale };
}
async function writeSkill(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const before = await readConfig(path);
  await replace(path, before, text);
}
async function readConfig(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1)
      throw Error("Symlink, special or hard-linked configuration requires manual setup.");
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function replace(path: string, before: string, after: string, mode = 0o600) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", mode);
    try {
      await file.writeFile(after);
      await file.sync();
    } finally {
      await file.close();
    }
    if ((await readConfig(path)) !== before)
      throw Error("Configuration changed during installation. Recheck and retry.");
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
/** Registration text for one provider's configuration; TOML keeps unrelated content verbatim. */
function registered(
  profile: HarnessProfile,
  before: string,
  config: Record<string, unknown>,
  url: string,
  replacingUrl?: string,
) {
  if (profile.config.format !== "json") {
    const previous = replacingUrl === undefined ? undefined : tomlEntry(profile, replacingUrl);
    const entry = tomlEntry(profile, url);
    if (profile.config.format === "toml-array")
      return registeredVibe(before, config, entry, profile.entry(url), previous);
    if (previous !== undefined && !before.includes(previous)) throw Error(EDITED_REGISTRATION);
    const after = previous !== undefined ? before.replace(previous, () => entry) : before + entry;
    parse(after);
    return after;
  }
  const servers = record(config.mcpServers ?? {});
  return (
    JSON.stringify(
      { ...config, mcpServers: { ...servers, "factory-runtime": profile.entry(url) } },
      null,
      2,
    ) + "\n"
  );
}

/**
 * The harness configuration after registering Factory MCP at `url`. Factory's own entry
 * for another address is replaced only on `repair`; any other entry is left for review.
 */
function configChange(profile: HarnessProfile, before: string, url: string, repair = false) {
  const toml = profile.config.format !== "json";
  const config = toml ? parse(before) : record(JSON.parse(before || "{}"));
  const existing =
    profile.config.format === "toml-array"
      ? vibeMcpEntry(config)
      : record(config[toml ? "mcp_servers" : "mcpServers"] ?? {})["factory-runtime"];
  if (existing === undefined) return registered(profile, before, config, url);
  const saved = record(existing);
  const urlKey = profile.config.urlKey ?? "url";
  const savedUrl = saved[urlKey];
  const entry = profile.entry(typeof savedUrl === "string" ? savedUrl : url);
  if (
    typeof savedUrl !== "string" ||
    Object.keys(saved).length !== Object.keys(entry).length ||
    !Object.entries(entry).every(([key, value]) => saved[key] === value)
  )
    throw Error(
      "Conflicting factory-runtime MCP entry. Remove it from this file and install again; AgentEasel does not overwrite another definition.",
    );
  if (savedUrl === url) return before;
  if (!repair)
    throw new RepairableInstallationError(
      "AgentEasel MCP is registered for another backend address. Repair the installation.",
    );
  return registered(profile, before, config, url, savedUrl);
}

const openReportingInstallation = Effect.fn(function* (
  directory: string,
  stateDirectory: string,
  connection: () => Effect.Effect<Result<T3Connection>, unknown>,
  mcpUrl: () => string,
) {
  const canonicalSkill = join(directory, "reporting", "skills", "factory-block", "SKILL.md");
  /** Each optional skill's harness copy beside `configPath` and its canonical copy. */
  const optionalSkillCopies = (profile: HarnessProfile, configPath: string): OptionalSkillCopy[] =>
    OPTIONAL_SKILLS.flatMap((skill) => [
      { ...skill, path: harnessSkillPath(profile, configPath, skill.name) },
      { ...skill, path: join(directory, "reporting", "skills", skill.name, "SKILL.md") },
    ]);
  // The last failed optional-skill replacement per copy, until a later write or inspection finds it
  // current: inspection cannot predict every failure (file flags, ACLs), so it shows the real one.
  const optionalWriteFailures = new Map<string, string>();
  const semaphore = yield* Semaphore.make(1);
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* semaphore.withPermits(1)(Effect.void);
    }),
  );
  const targets = Effect.fn(function* () {
    const current = yield* connection();
    if (!current.ok) throw Error("Connection unavailable.");
    return yield* discoverReporting(stateDirectory, current.value);
  });
  const inspect = Effect.fn(function* (
    target: ReportingInstallation,
  ): Generator<Effect.Effect<unknown, unknown>, ReportingInstallation, never> {
    if (!target.path) return target;
    const profile = harnessProfile(target);
    const copies = optionalSkillCopies(profile, target.path);
    const optional = yield* boundary(() => inspectOptionalSkills(copies));
    if (optional.state === "current")
      for (const { path } of copies) optionalWriteFailures.delete(path);
    const optionalProblem =
      optional.problem ??
      copies.map(({ path }) => optionalWriteFailures.get(path)).find(Boolean) ??
      `Optional skills missing or outdated: ${optional.stale.join(", ")}. Reinstall and start a fresh session to use them.`;
    target = { ...target, launchSkill: optional.state };
    return yield* Effect.gen(function* (): Generator<
      Effect.Effect<unknown, unknown>,
      ReportingInstallation,
      never
    > {
      yield* boundary(() => access(dirname(target.path!), constants.R_OK | constants.W_OK));
      const before = yield* boundary(() => readConfig(target.path!));
      const after = configChange(profile, before, mcpUrl());
      if (after !== before) return withReportingInstallationActions(target);
      if (
        !(yield* boundary(() =>
          skillMatches(harnessSkillPath(profile, target.path!, "factory-block")),
        )) ||
        !(yield* boundary(() => skillMatches(canonicalSkill)))
      )
        throw new RepairableInstallationError(
          "AgentEasel Block skill missing or outdated. Repair the installation from this backend.",
        );
      return withReportingInstallationActions({
        ...target,
        status: "installed",
        // A configured entry proves neither tool visibility nor that a worker reported.
        runtimeEvidence: "UNVERIFIED",
        message:
          target.launchSkill === "current"
            ? "Configuration installed. Start a fresh session; native approvals, managed restrictions and project overrides still apply."
            : `Reporting configuration installed. ${optionalProblem} Native approvals, managed restrictions and project overrides still apply.`,
      });
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return Effect.succeed(withReportingInstallationActions(target));
        return Effect.succeed(
          withReportingInstallationActions(
            {
              ...target,
              status: "needs-attention" as const,
              message:
                error instanceof Error
                  ? error.message
                  : "Recheck configuration permissions and the AgentEasel MCP entry.",
            },
            error instanceof RepairableInstallationError,
          ),
        );
      }),
    );
  });
  return {
    getReportingInstallations: Effect.fn(function* (): Generator<
      Effect.Effect<unknown, unknown>,
      Result<readonly ReportingInstallation[]>,
      never
    > {
      const manual = `AgentEasel has no installer for this provider and cannot accept its reports yet. When support exists, add a Streamable HTTP MCP server named factory-runtime with URL ${mcpUrl()} in the file this harness reads for user MCP servers, then start a fresh session.`;
      return {
        ok: true,
        value: yield* Effect.forEach(
          (yield* targets()).map((target) =>
            target.path || target.kind !== "instance" || isReportingDriver(target.provider)
              ? target
              : { ...target, message: manual },
          ),
          inspect,
          { concurrency: "unbounded" },
        ),
      };
    }),
    installReporting: (input: unknown) =>
      Effect.suspend(() =>
        closed
          ? Effect.fail(new Error("Reporting installation closed"))
          : semaphore.withPermits(1)(
              Effect.gen(function* (): Generator<
                Effect.Effect<unknown, unknown>,
                Result<ReportingInstallation>,
                never
              > {
                const id = record(input).targetId;
                const target = (yield* targets()).find((target) => target.id === id);
                if (!target?.path)
                  throw Error(
                    "Target unavailable. Recheck the local T3 environment and configuration home.",
                  );
                const profile = harnessProfile(target);
                const before = yield* boundary(() => readConfig(target.path!));
                const after = configChange(profile, before, mcpUrl(), true);
                yield* boundary(() =>
                  writeSkill(
                    harnessSkillPath(profile, target.path!, "factory-block"),
                    FACTORY_BLOCK_SKILL,
                  ),
                );
                yield* boundary(() => writeSkill(canonicalSkill, FACTORY_BLOCK_SKILL));
                if (after !== before) {
                  yield* boundary(() =>
                    mkdir(dirname(target.path!), { recursive: true, mode: 0o700 }),
                  );
                  yield* boundary(() => replace(target.path!, before, after));
                }
                // The optional skills never block required reporting. Each copy is written on
                // its own; writeSkill refuses linked and special files without reading them, and a
                // failed copy stays as it is, explained by inspection until a later write succeeds.
                for (const { name, text, path } of optionalSkillCopies(profile, target.path)) {
                  const failure = yield* boundary(() => writeSkill(path, text)).pipe(
                    Effect.as(undefined),
                    Effect.catch((error) =>
                      Effect.succeed(error instanceof Error ? error.message : String(error)),
                    ),
                  );
                  if (failure)
                    optionalWriteFailures.set(
                      path,
                      `The optional ${name} skill at ${path} could not be replaced (${failure}). Fix that file manually, for example its permissions or file flags, then Reinstall.`,
                    );
                  else optionalWriteFailures.delete(path);
                }
                const checked = yield* inspect(target);
                if (checked.status !== "installed") throw Error(checked.message);
                return { ok: true, value: checked };
              }).pipe(
                Effect.uninterruptible,
                Effect.catchCause((cause) => {
                  const error = Cause.squash(cause);
                  return Effect.succeed(
                    failure(
                      "validation",
                      error instanceof Error
                        ? error.message
                        : "Installation failed; recheck permissions.",
                    ),
                  );
                }),
              ),
            ),
      ),
  };
});
export class ReportingInstaller extends Context.Service<
  ReportingInstaller,
  Effect.Success<ReturnType<typeof openReportingInstallation>>
>()("ReportingInstaller") {}
export const ReportingInstallerLayer = (...args: Parameters<typeof openReportingInstallation>) =>
  Layer.effect(ReportingInstaller, openReportingInstallation(...args));
