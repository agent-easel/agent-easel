import { controlledExecution } from "./scenarios.ts";
import { assert, expect, type TestContext } from "@effect/vitest";
import { request as httpRequest } from "node:http";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { LiveGitAdapter } from "../../src/adapters/live-git.ts";
import { makeLiveT3, type Factory, type FactoryOptions } from "../../src/index.ts";
import type { LiveT3ContractOptions } from "../../src/t3/live-contract.ts";
import type { T3Connection } from "@t3-factory/contracts";
import { factoryHarness } from "./factory.ts";
import { ControlledT3 } from "./controlled-t3.ts";
import { oauthT3 } from "./oauth-t3.ts";

export function hostStatus(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function readConnection(factory: Factory): Promise<T3Connection> {
  const result = await factory.getConnection();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Connection read failed");
  return result.value;
}

export async function recheckConnection(factory: Factory): Promise<T3Connection> {
  const result = await factory.recheckConnection();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Connection recheck failed");
  return result.value;
}

export async function authorizedLiveOAuth(
  c: TestContext,
  options: Parameters<typeof oauthT3>[0] = {},
  setup: {
    readonly contract?: LiveT3ContractOptions;
    readonly open?: Omit<FactoryOptions, "databasePath" | "t3">;
  } = {},
) {
  const harness = await factoryHarness(c);
  const external = await oauthT3(options);
  c.onTestFinished(() => external.close());
  let authorizationUrl = "";
  const live = makeLiveT3({
    ...setup.contract,
    credentialsDirectory: join(dirname(harness.databasePath), "credentials"),
    callbackPort: 0,
    openBrowser: async (url) => {
      authorizationUrl = url;
    },
  });
  const factory = await harness.open({ ...setup.open, t3: live });
  const configured = await factory.configureConnection({ endpoint: external.endpoint });
  expect(configured.ok).toBe(true);
  const started = await factory.authorizeConnection();
  expect(started.ok).toBe(true);
  expect((await fetch(external.approvalUrl(authorizationUrl))).status).toBe(200);
  const ready = await factory.recheckConnection();
  expect(ready.ok).toBe(true);
  return {
    harness,
    factory,
    live,
    projects: live.projects,
    threads: live.threads,
    external,
    endpoint: external.endpoint,
    /** The consent page the latest authorization opened. */
    authorizationUrl: () => authorizationUrl,
  };
}

/** The thread every `connectedLiveT3` read observes. */
export const observedThread = {
  thread: {
    threadId: "thread-1",
    projectId: "project-1",
    activeRunId: null,
    link: null,
    worktreePath: null,
    pendingRequestCount: 0,
  },
  recentRuns: [],
};
/** What `connectedLiveT3`'s T3 answers a queued send with by default. */
export const sendReference = {
  threadId: "thread-1",
  messageId: "message-1",
  runId: "run-2",
  status: "queued",
  delivery: "queued",
};

/** An authorized live T3 whose server answers thread reads, sends and Project lists. */
export function connectedLiveT3(
  context: TestContext,
  handlers: { readonly send?: (args: Record<string, unknown>) => unknown } = {},
) {
  return authorizedLiveOAuth(context, {
    projects: true,
    runtimeActivity: () => observedThread,
    sendSchema: { type: "object" },
    send: handlers.send ?? (() => sendReference),
  });
}

const projectValue = <A>(result: { ok: true; value: A } | { ok: false; error: unknown }): A => {
  assert(result.ok);
  return result.value;
};

export async function liveProjectRepositories(context: TestContext) {
  const { harness, factory, endpoint } = await authorizedLiveOAuth(
    context,
    { projects: true },
    { open: { git: new LiveGitAdapter() } },
  );
  const root = await realpath(dirname(harness.databasePath));
  const first = join(root, "first");
  const second = join(root, "second");
  const git = (command: string, args: string[]) =>
    promisify(execFile)(command, args, {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: harness.processHome },
    });
  await mkdir(first);
  await git("git", ["init", "--initial-branch=main", first]);
  await git("git", [
    "-C",
    first,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  await git("git", ["clone", first, second]);
  const p = projectValue(await factory.addRepository({ path: first }));
  const alias = join(root, "alias");
  await symlink(first, alias);
  const worktree = join(root, "execution");
  await git("git", ["-C", first, "worktree", "add", "-b", "execution", worktree]);

  return { factory, endpoint, root, first, second, p, alias, worktree };
}

export const reportReadSchema = {
  type: "object",
  properties: Object.fromEntries([
    ...["threadId", "itemId", "view"].map((f) => [f, { type: "string" }]),
    ...["textOffset", "afterPosition", "limit", "maxCharsPerItem"].map((f) => [
      f,
      { type: "integer" },
    ]),
  ]),
  required: ["threadId"],
};
export const reportPage = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
  thread: { threadId: "known", projectId: "neutral", activeRunId: null },
  items,
  hasMore: false,
  nextPosition: items.length ? 0 : null,
  ...overrides,
});
export async function reportAdapter(
  c: TestContext,
  read: (args: Record<string, unknown>) => unknown,
  schema = reportReadSchema,
) {
  const { live: t3, endpoint } = await authorizedLiveOAuth(c, {
    runtimeActivity: read,
    readSchema: schema,
  });
  return { t3, endpoint };
}

/** An authorized live T3 whose otherwise compatible send schema advertises a numeric `mode.enum`,
 * which support evaluation cannot read. */
export function malformedSendLiveT3(
  c: TestContext,
  options: { readonly resourceMetadataUnavailable?: boolean } = {},
) {
  const fields = ["environmentId", "threadId", "clientRequestId", "message"];
  const sendSchema = {
    type: "object",
    properties: {
      ...Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
      mode: { type: "string", enum: 42 },
    },
  };
  return authorizedLiveOAuth(c, {
    sendSchema,
    send: () => ({}),
    readSchema: reportReadSchema,
    ...options,
  });
}

export async function claudeRuntimeConfig(c: TestContext) {
  const state = await legacyRuntimeRepository(c, "neutral-json", true);
  const original = {
    mcpServers: { other: { command: "keep", env: { EXAMPLE: "preserve" } } },
    unrelated: { enabled: true },
  };
  const path = join(state.root, ".mcp.json");
  await writeFile(path, JSON.stringify(original));
  return { ...state, original, path };
}

async function legacyRuntimeRepository(c: TestContext, directoryName: string, claude = false) {
  const h = await factoryHarness(c);
  const root = join(dirname(h.databasePath), directoryName);
  await mkdir(root);
  await promisify(execFile)("git", ["init", root], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: h.processHome },
  });
  const t3 = new ControlledT3();
  t3.connection.approve();
  if (claude)
    t3.projects.controlledProviders.push({
      ...t3.projects.controlledProviders[0]!,
      providerInstanceId: "claude-local",
      driverKind: "claudeAgent",
    });
  const f = await h.open({ t3 });
  assert((await f.configureConnection({ endpoint: "http://127.0.0.1:3773/mcp" })).ok);
  const p = await f.addRepository({ path: root });
  assert(p.ok);
  const input = {
    name: "Worker",
    prompt: "Work",
    execution: controlledExecution(t3.connection.environmentId, {
      providerInstanceId: claude ? "claude-local" : "codex-main",
      modelOptions: [],
    }),
    exits: [],
  };
  const a = await f.createAgent(input);
  assert(a.ok);
  return { h, root, t3, f, p, a, input, selection: { projectId: p.value.id, agentId: a.value.id } };
}

export async function runtimeReadinessFixture(c: TestContext) {
  const h = await factoryHarness(c);
  const root = join(dirname(h.databasePath), "neutral-readiness");
  await mkdir(root);
  await promisify(execFile)("git", ["init", root], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dirname(h.databasePath) },
  });
  const t3 = new ControlledT3();
  t3.connection.approve();
  const f = await h.open({ t3 });
  await f.configureConnection({ endpoint: "http://127.0.0.1:3773/mcp" });
  const p = await f.addRepository({ path: root });
  const a = await f.createAgent({
    name: "Worker",
    prompt: "Work",
    execution: controlledExecution(t3.connection.environmentId, { modelOptions: [] }),
    exits: [],
  });
  assert(p.ok && a.ok);
  return { f, t3, git: h.git, selection: { projectId: p.value.id, agentId: a.value.id }, root };
}
