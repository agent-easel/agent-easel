import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { TelemetrySetting, UpdateChannel } from "@t3-factory/contracts";

const bucket = Schema.Literals(["0", "1", "2-5", "6+"]);

const eventProperties = {
  "app.started": Schema.Struct({
    isFirstRun: Schema.Boolean,
    projectCount: bucket,
    flowCount: bucket,
    agentCount: bucket,
  }),
};

type EventProperties = { [K in keyof typeof eventProperties]: (typeof eventProperties)[K]["Type"] };
type EventName = keyof EventProperties;
type ServerMode = "desktop" | "server";

export interface TelemetryOptions {
  readonly home?: string;
  readonly packagedChannel?: UpdateChannel;
  readonly packagedKey?: string;
  readonly serverMode?: ServerMode;
  readonly preference?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
}

export interface Telemetry {
  readonly enabled: boolean;
  readonly disabledReason: TelemetrySetting["disabledReason"];
  readonly setPreference: (enabled: boolean) => Effect.Effect<void>;
  readonly record: <K extends EventName>(
    event: K,
    properties: EventProperties[K],
  ) => Effect.Effect<void>;
  readonly flush: () => Effect.Effect<void>;
}

export function telemetryCount(count: number): typeof bucket.Type {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2-5";
  return "6+";
}

const defaultHost = "https://t3factory.app/ingest";
const flushInterval = 10_000;
const sendTimeout = 10_000;
const retryWindow = 30 * 60_000;
const maximumBackoff = 5 * 60_000;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

async function readIdentity(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== 37 || (info.mode & 0o077) !== 0)
      throw new Error("Invalid telemetry identity file");
    const buffer = Buffer.alloc(37);
    const { bytesRead } = await file.read(buffer);
    const identity = buffer.toString("utf8", 0, 36);
    if (bytesRead !== 37 || buffer[36] !== 10 || !uuidV4.test(identity))
      throw new Error("Invalid telemetry identity");
    return identity;
  } finally {
    await file.close();
  }
}

async function installationId(home: string): Promise<string> {
  const path = join(home, "telemetry-id");
  const identity = await readIdentity(path).catch(async (error: unknown) => {
    if (!hasCode(error, "ENOENT")) throw error;
    const candidate = randomUUID();
    const temporaryPath = join(home, `.telemetry-id-${candidate}`);
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      try {
        await file.writeFile(`${candidate}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporaryPath, path);
        return candidate;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        return await readIdentity(path);
      }
    } finally {
      await unlink(temporaryPath);
    }
  });
  return createHash("sha256").update(identity).digest("hex");
}

function eventUuid(now: number): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x70;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function batchEndpoint(host: string): URL | undefined {
  if (!URL.canParse(host)) return;
  const url = new URL(host);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/batch/`;
  return url;
}

const disabled: Telemetry = {
  enabled: false,
  disabledReason: "unavailable",
  setPreference: () => Effect.void,
  record: () => Effect.void,
  flush: () => Effect.void,
};

interface BufferedEvent {
  readonly uuid: string;
  readonly event: EventName;
  readonly distinct_id: string;
  readonly timestamp: string;
  readonly properties: object;
}

function sendBatch(
  fetchBatch: typeof fetch,
  endpoint: URL,
  apiKey: string,
  batch: readonly BufferedEvent[],
  timeout: number,
  optOut: AbortSignal,
) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchBatch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, batch }),
        redirect: "manual",
        signal: AbortSignal.any([signal, optOut]),
      });
      await response.body?.cancel();
      return response.status;
    },
    catch: () => undefined,
  }).pipe(
    Effect.orElseSucceed(() => null),
    Effect.timeoutOption(timeout),
    Effect.map(Option.getOrNull),
  );
}

function transient(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

const jitteredBackoff = (base: number) => Math.min(maximumBackoff, base * (1 + Math.random() / 2));

export const makeTelemetry = (
  home: string,
  applicationVersion?: string,
  options: TelemetryOptions = {},
) =>
  Effect.gen(function* () {
    const env = options.env ?? process.env;
    const override = env.FACTORY_TELEMETRY_ENABLED;
    if (override === "false") return { ...disabled, disabledReason: "environment" } as const;
    if (override !== "true" && !options.packagedChannel) return disabled;
    const apiKey = (env.FACTORY_POSTHOG_KEY ?? options.packagedKey)?.trim();
    if (!apiKey) return disabled;
    const endpoint = batchEndpoint(env.FACTORY_TELEMETRY_HOST ?? defaultHost);
    if (!endpoint) {
      yield* Effect.logWarning(
        "Anonymous analytics is disabled because the ingest URL is invalid.",
      );
      return disabled;
    }
    const distinctId = yield* Effect.tryPromise(() => installationId(options.home ?? home)).pipe(
      Effect.catch(() =>
        Effect.logWarning("Anonymous analytics could not open its installation identity.").pipe(
          Effect.as(null),
        ),
      ),
    );
    if (distinctId === null) return disabled;

    const appVersion =
      applicationVersion?.match(/^\d{1,10}\.\d{1,10}\.\d{1,10}(?:-beta\.[1-9]\d{0,9})?$/)?.[0] ??
      "source";
    const metadata = {
      appVersion,
      channel: options.packagedChannel ?? "stable",
      os: process.platform,
      arch: process.arch,
      serverMode: options.serverMode ?? "server",
      $process_person_profile: false,
      $geoip_disable: true,
    } as const;
    const queue: BufferedEvent[] = [];
    const fetchBatch = options.fetch ?? fetch;
    const clock = yield* Clock.Clock;
    const semaphore = yield* Semaphore.make(1);
    let enabled = options.preference ?? true;
    let sending: AbortController | undefined;
    let retry:
      | { last: BufferedEvent; deadline: number; nextAttempt: number; base: number }
      | undefined;
    let resumeAt = 0;

    const discardThrough = (last: BufferedEvent) => {
      queue.splice(0, queue.indexOf(last) + 1);
      retry = undefined;
    };

    function finishSend(status: number | null, last: BufferedEvent, deadline: number) {
      const now = clock.currentTimeMillisUnsafe();
      if (transient(status)) {
        const base = retry ? Math.min(maximumBackoff, retry.base * 2) : 2000;
        retry = {
          last,
          deadline,
          nextAttempt: Math.min(deadline, now + jitteredBackoff(base)),
          base,
        };
        return;
      }
      discardThrough(last);
      if (status !== null && (status < 200 || status >= 300))
        resumeAt = now + jitteredBackoff(2000);
    }

    const record: Telemetry["record"] = (event, properties) =>
      Effect.gen(function* () {
        if (!enabled || !Object.hasOwn(eventProperties, event)) return;
        const decoded = Schema.decodeUnknownOption(eventProperties[event], {
          onExcessProperty: "error",
        })(properties);
        if (Option.isNone(decoded)) return;
        const now = yield* Clock.currentTimeMillis;
        const uuid = yield* Effect.try(() => eventUuid(now)).pipe(Effect.orElseSucceed(() => null));
        if (uuid === null || !enabled) return;
        if (queue.length === 1000) queue.shift();
        const startup =
          event === "app.started" ? { version: appVersion, mode: metadata.serverMode } : {};
        queue.push({
          uuid,
          event,
          distinct_id: distinctId,
          timestamp: new Date(now).toISOString(),
          properties: { ...decoded.value, ...metadata, ...startup },
        });
      });

    const flush = () =>
      semaphore.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (!enabled || queue.length === 0 || now < resumeAt) return;
          const retrySize = retry ? queue.indexOf(retry.last) + 1 : 0;
          if (retrySize === 0) retry = undefined;
          if (retry && now >= retry.deadline) {
            discardThrough(retry.last);
            yield* Effect.logWarning(
              "Anonymous analytics dropped a batch after its retry window expired.",
            );
            return;
          }
          if (retry && now < retry.nextAttempt) return;
          const batch = queue.slice(0, retrySize || 20);
          const last = batch[batch.length - 1]!;
          const deadline = retry?.deadline ?? now + retryWindow;
          const controller = new AbortController();
          sending = controller;
          const status = yield* sendBatch(
            fetchBatch,
            endpoint,
            apiKey,
            batch,
            Math.min(sendTimeout, deadline - now),
            controller.signal,
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                sending = undefined;
              }),
            ),
          );
          if (!controller.signal.aborted) finishSend(status, last, deadline);
        }),
      );

    yield* Effect.addFinalizer(() =>
      flush().pipe(Effect.interruptible, Effect.timeoutOption(1000), Effect.asVoid),
    );
    yield* Effect.forkScoped(
      Effect.sleep(flushInterval).pipe(
        Effect.andThen(
          Effect.forever(
            Effect.gen(function* () {
              const scheduled = clock.currentTimeMillisUnsafe() + flushInterval;
              yield* flush();
              const next = retry?.nextAttempt ?? scheduled;
              yield* Effect.sleep(Math.max(0, next - clock.currentTimeMillisUnsafe()));
            }),
          ),
        ),
      ),
    );

    return {
      get enabled() {
        return enabled;
      },
      disabledReason: null,
      setPreference: (preference: boolean) =>
        Effect.sync(() => {
          enabled = preference;
          if (preference) return;
          queue.length = 0;
          retry = undefined;
          resumeAt = 0;
          sending?.abort();
        }),
      record,
      flush,
    } satisfies Telemetry;
  });
