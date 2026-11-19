import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  AppearancePresentation,
  AppearanceSource,
  Result,
  T3Appearance,
  T3Connection,
} from "@t3-factory/contracts";
import { parseAppearancePresentation } from "@t3-factory/domain-validation";
import type { T3Adapter, T3ThemeRead } from "../adapters/t3.ts";
import type { LiveChanges } from "../live-changes.ts";
import { periodicWorker } from "../periodic.ts";
import { presentThemeModes } from "./palette-mapping.ts";
import { resolveT3Theme, T3_RESOLVER_PIN, type T3ThemeLookup } from "./t3-theme-palettes.ts";

const CONNECTING = "Reading the T3 environment’s default theme…";
const UNVERIFIABLE =
  "Theme colors wait for an authorized T3 connection. Factory’s own colors are used meanwhile.";
const MISMATCH =
  "T3 answered for another environment than the one the T3 connection uses, so Factory’s own colors are used.";
const UNSUPPORTED =
  "This T3 does not share its default theme (it has no t3_theme_read tool), so Factory’s own colors are used. Update T3 to follow its theme.";
const outage = (retained: boolean) =>
  retained
    ? "T3 can’t be reached. Factory keeps the theme colors it received and reads them again automatically."
    : "T3 can’t be reached, so Factory’s own colors are used. Factory reads them again automatically.";

/** The default theme of a read as the pinned resolver reads it; null without a default. */
type Followed = { readonly themeId: string; readonly lookup: T3ThemeLookup } | null;

const follows = (read: T3ThemeRead): Followed =>
  read.defaultTheme
    ? { themeId: read.defaultTheme, lookup: resolveT3Theme(read.defaultTheme, read.themes) }
    : null;

const USES_FACTORY = "so Factory’s own colors are used.";

function followingExplanation(followed: Followed) {
  if (!followed) return `T3 has no default theme, ${USES_FACTORY}`;
  const { themeId, lookup } = followed;
  if (lookup.kind === "theme") {
    const ignored =
      lookup.unreadColors === 1
        ? " 1 color Factory cannot read was ignored."
        : ` ${lookup.unreadColors} colors Factory cannot read were ignored.`;
    return `Following T3’s default theme “${lookup.theme.name}”.${lookup.unreadColors ? ignored : ""}`;
  }
  if (lookup.kind === "missing")
    return `T3’s default theme “${themeId}” is not available in T3, ${USES_FACTORY} Factory follows it once T3 publishes it.`;
  return lookup.reason === "format"
    ? `T3’s default theme “${lookup.name}” uses a theme format Factory does not support, ${USES_FACTORY}`
    : `T3’s default theme “${lookup.name}” has no colors Factory can read, ${USES_FACTORY}`;
}

const revisionOf = (body: Omit<AppearancePresentation, "revision">) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);

/** Both modes of the followed theme validated into one presentation; null without a theme. */
function present(environmentId: string, followed: Followed): AppearancePresentation | null {
  if (followed?.lookup.kind !== "theme") return null;
  const { theme } = followed.lookup;
  const body = {
    environmentId,
    resolverPin: T3_RESOLVER_PIN,
    theme: { id: theme.id, name: theme.name },
    modes: presentThemeModes(theme),
  };
  return { revision: revisionOf(body), ...body };
}

/**
 * Theme-color inheritance from the T3 connection's environment. It reads T3's default theme
 * with `t3_theme_read` over the T3 connection, owns the one presentation approved clients
 * receive, and never affects connection readiness, Start, execution or Run attention.
 */
export const makeAppearance = (
  t3: T3Adapter,
  getConnection: () => Effect.Effect<Result<T3Connection>>,
  intervalMs: number,
  changes: LiveChanges,
) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const sql = yield* SqlClient.SqlClient;
    const mutex = yield* Semaphore.make(1);
    const serial = <A, E>(action: Effect.Effect<A, E>) => mutex.withPermits(1)(action);
    let endpoint: string | null = null;
    let presentation: AppearancePresentation | null = null;
    let binding: string | undefined;
    /** The stored snapshot's endpoint and revision; undefined until the first publication. */
    let stored: string | null | undefined;
    let status: T3Appearance = { state: "connecting", explanation: CONNECTING, presentation };

    /**
     * Keeps the one stored snapshot equal to the published presentation, so whatever ends the
     * colors (another source, no inherited default) also deletes it.
     */
    const store = Effect.gen(function* () {
      const key = endpoint && presentation ? `${endpoint}\n${presentation.revision}` : null;
      if (key === stored) return;
      if (endpoint && presentation)
        yield* sql`INSERT INTO appearance_snapshot (singleton, endpoint, presentation)
          VALUES (1, ${endpoint}, ${JSON.stringify(presentation)})
          ON CONFLICT (singleton) DO UPDATE SET
            endpoint = excluded.endpoint, presentation = excluded.presentation`;
      else yield* sql`DELETE FROM appearance_snapshot`;
      stored = key;
    }).pipe(Effect.orDie);

    /** The snapshot a previous process stored, when it is still bound to this endpoint, environment and resolver. */
    const restore = (target: string, environment: string) =>
      Effect.gen(function* () {
        const [row] = yield* sql<{ endpoint: string; presentation: string }>`
          SELECT endpoint, presentation FROM appearance_snapshot WHERE singleton = 1`;
        if (row?.endpoint !== target) return null;
        const snapshot = yield* Effect.try(() =>
          parseAppearancePresentation(JSON.parse(row.presentation)),
        ).pipe(Effect.orElseSucceed(() => null));
        return snapshot?.environmentId === environment && snapshot.resolverPin === T3_RESOLVER_PIN
          ? snapshot
          : null;
      }).pipe(Effect.orDie);

    const publish = (state: T3Appearance["state"], explanation: string, unreadableTheme?: string) =>
      Effect.gen(function* () {
        yield* store;
        status = {
          state,
          explanation,
          presentation,
          ...(unreadableTheme ? { unreadableTheme } : {}),
        };
        changes.appearanceChanged();
      });

    /**
     * The saved endpoint and the environment its authorization context was bound to. The
     * connection keeps that context after T3 rejects the grant, so a connection that requires
     * authorization has no environment: its colors end at once instead of being kept as if T3
     * were only unreachable.
     */
    const savedBinding = Effect.map(getConnection(), (connection) => {
      const saved = connection.ok ? connection.value : null;
      return {
        endpoint: saved?.endpoint ?? null,
        environment:
          saved?.state === "authorization-required"
            ? null
            : (saved?.authorizationContext?.environmentId ?? null),
      };
    });

    /** Reads T3's default theme for the saved connection and publishes what follows from it. */
    const reconcile: Effect.Effect<void> = Effect.gen(function* () {
      const saved = yield* savedBinding;
      binding = JSON.stringify(saved);
      // Colors of another endpoint or environment never outlive the replacement.
      if (saved.endpoint !== endpoint || presentation?.environmentId !== saved.environment)
        presentation = null;
      endpoint = saved.endpoint;
      const { environment } = saved;
      if (!endpoint || !environment) {
        presentation = null;
        return yield* publish("unavailable", UNVERIFIABLE);
      }
      const target = endpoint;
      const read = yield* Effect.tryPromise(() => t3.readTheme({ endpoint: target })).pipe(
        Effect.option,
      );
      if (read._tag === "None") return yield* publish("unavailable", outage(presentation !== null));
      // The connection can change while T3 answers; a read for a replaced source is obsolete.
      if (JSON.stringify(yield* savedBinding) !== binding) return;
      if (read.value === null) {
        presentation = null;
        return yield* publish("unsupported", UNSUPPORTED);
      }
      if (read.value.environmentId !== environment) {
        presentation = null;
        return yield* publish("unavailable", MISMATCH);
      }
      const followed = follows(read.value);
      const next = present(environment, followed);
      // An unchanged theme keeps its presentation object, so live delivery sends nothing.
      if (next?.revision !== presentation?.revision) presentation = next;
      const unreadableTheme =
        followed?.lookup.kind === "unsupported"
          ? followed.lookup.name
          : followed?.lookup.kind === "missing"
            ? followed.themeId
            : undefined;
      yield* publish("following", followingExplanation(followed), unreadableTheme);
    });

    /** Connection checks publish often; only a changed endpoint or environment matters here. */
    const connectionChanged = Effect.gen(function* () {
      if (JSON.stringify(yield* savedBinding) !== binding) yield* reconcile;
    });

    /**
     * The first status comes from local state alone, before T3 is asked anything: the snapshot
     * the previous process stored while it is bound to the connection's endpoint and
     * environment. Only this step adopts a stored snapshot, so no later source change can bring
     * old colors back; the first read that follows replaces or ends it.
     */
    yield* serial(
      Effect.gen(function* () {
        const saved = yield* savedBinding;
        endpoint = saved.endpoint;
        if (endpoint && saved.environment)
          presentation = yield* restore(endpoint, saved.environment);
        yield* publish("connecting", CONNECTING);
      }),
    );

    const connectionHint = yield* changes.watch({ kind: "connection" });
    yield* Effect.forkIn(
      Effect.forever(
        Effect.gen(function* () {
          yield* connectionHint.await;
          connectionHint.closeUnsafe();
          yield* serial(connectionChanged);
        }),
      ),
      scope,
    );
    // Startup never waits for T3: appearance is optional and independent of readiness.
    yield* Effect.forkIn(serial(reconcile), scope);
    const stopWorker = yield* periodicWorker(intervalMs, serial(reconcile), serial(Effect.void));
    yield* Effect.addFinalizer(() => stopWorker);

    return {
      getAppearance: () => Effect.sync(() => status),
      /** Read without waiting for a read in flight: it only compares local state. */
      getAppearanceSource: () =>
        Effect.map(savedBinding, (saved): Result<AppearanceSource | null> => ({
          ok: true,
          value: saved.environment
            ? { environmentId: saved.environment, resolverPin: T3_RESOLVER_PIN }
            : null,
        })),
    };
  });
