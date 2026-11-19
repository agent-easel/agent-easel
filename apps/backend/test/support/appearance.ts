import { assert, type TestContext } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { AppearanceLiveMessage, T3Appearance } from "@t3-factory/contracts";
import type { FactoryService } from "../../src/index.ts";
import { ControlledT3 } from "./controlled-t3.ts";
import { factoryHarness } from "./factory.ts";
import { subscribe } from "./live.ts";

export const T3_ENDPOINT = "http://127.0.0.1:3773/mcp";

/** The appearance the window would show after the messages received so far. */
export function latestAppearance(messages: readonly AppearanceLiveMessage[]): T3Appearance | null {
  return messages.at(-1)?.appearance ?? null;
}

/** An approved controlled T3 whose environment default is Ocean. */
function oceanT3(arrange: (t3: ControlledT3) => void) {
  const t3 = new ControlledT3();
  t3.connection.approve();
  t3.appearance.defaultTheme = "ocean";
  arrange(t3);
  return t3;
}

/** Backend services in the caller's scope with an authorized connection to `t3`. */
function connectedOn(
  harness: Awaited<ReturnType<typeof factoryHarness>>,
  t3: ControlledT3,
  connectionRetryMs: number,
) {
  return Effect.gen(function* () {
    const factory: FactoryService["Service"] = yield* harness.service({ t3, connectionRetryMs });
    assert((yield* factory.configureConnection({ endpoint: T3_ENDPOINT })).ok);
    return factory;
  });
}

/**
 * Backend services in the test's scope, connected to an approved T3 whose default is Ocean, so
 * TestClock drives the periodic theme read; `connectionRetryMs` paces connection and theme reads.
 */
export function connectedService(
  context: TestContext,
  arrange: (t3: ControlledT3) => void = () => {},
  connectionRetryMs = 1_000,
) {
  return Effect.gen(function* () {
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const t3 = oceanT3(arrange);
    const factory = yield* connectedOn(harness, t3, connectionRetryMs);
    const live = subscribe(context, factory.live.watchAppearance());
    return { factory, t3, live };
  });
}

/** The same, once Factory follows T3's default theme. */
export function followingService(
  context: TestContext,
  arrange: (t3: ControlledT3) => void = () => {},
) {
  return Effect.gen(function* () {
    const connected = yield* connectedService(context, arrange);
    yield* Effect.promise(() =>
      connected.live.until((received) => latestAppearance(received)?.state === "following"),
    );
    return connected;
  });
}

/**
 * A backend that followed `ocean` and then stopped, leaving its stored theme colors for the
 * backend a test starts next with `harness.service`.
 */
export function stoppedFollowingService(context: TestContext) {
  return Effect.gen(function* () {
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const t3 = oceanT3(() => {});
    yield* Effect.scoped(
      Effect.gen(function* () {
        const factory = yield* connectedOn(harness, t3, 1_000);
        const live = subscribe(context, factory.live.watchAppearance());
        yield* Effect.promise(() =>
          live.until((received) => latestAppearance(received)?.presentation?.theme.id === "ocean"),
        );
      }),
    );
    return { harness, t3 };
  });
}
