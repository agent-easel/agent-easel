import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import type { AppearanceLiveMessage } from "@t3-factory/contracts";
import {
  connectedService,
  followingService,
  latestAppearance,
  stoppedFollowingService,
  T3_ENDPOINT,
} from "./support/appearance.ts";
import { factoryHarness } from "./support/factory.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import { prepared } from "./support/prepared-runner.ts";
import { subscribe } from "./support/live.ts";
import { upstreamPublishedTheme } from "./support/t3-theme-fixture.ts";

/** T3's published "Nightfall": dark canvas and accent seeds, no Light variant. */
const nightfall = upstreamPublishedTheme("seed-dark").wire;

type Done = (messages: readonly AppearanceLiveMessage[]) => boolean;
type Live = { until(done: Done): Promise<readonly AppearanceLiveMessage[]> };

/** Lets the next periodic theme read run, then waits for the delivery `done` describes. */
const nextRead = (live: Live, done: Done) =>
  TestClock.adjust(1_000).pipe(Effect.andThen(Effect.promise(() => live.until(done))));

it.effect(
  "an authorized T3 connection follows its environment's built-in default in both modes without pairing",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* connectedService(context);

      // Act
      const messages = yield* Effect.promise(() =>
        live.until((received) => latestAppearance(received)?.state === "following"),
      );

      // Assert
      const presentation = latestAppearance(messages)?.presentation;
      expect(presentation?.theme).toStrictEqual({ id: "ocean", name: "Ocean" });
      expect(presentation?.environmentId).toBe(t3.environmentId);
      expect(presentation?.modes.light.kind).toBe("inherited");
      expect(presentation?.modes.dark.kind).toBe("inherited");
    }),
);

it.effect("a T3 without t3_theme_read keeps Factory's colors and asks for a T3 update", (context) =>
  Effect.gen(function* () {
    // Arrange
    const { live } = yield* connectedService(context, (t3) => {
      t3.appearance.supported = false;
    });

    // Act
    const messages = yield* Effect.promise(() =>
      live.until((received) => latestAppearance(received)?.state === "unsupported"),
    );

    // Assert
    expect(latestAppearance(messages)?.presentation).toBe(null);
    expect(latestAppearance(messages)?.explanation).toContain("Update T3");
  }),
);

it.effect("theme colors wait for an authorized T3 connection", (context) =>
  Effect.gen(function* () {
    // Arrange
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const t3 = new ControlledT3();

    // Act
    const factory = yield* harness.service({ t3, connectionRetryMs: 1_000 });
    assert((yield* factory.configureConnection({ endpoint: T3_ENDPOINT })).ok);

    // Assert
    const live = subscribe(context, factory.live.watchAppearance());
    const messages = yield* Effect.promise(() =>
      live.until((received) => latestAppearance(received)?.state === "unavailable"),
    );
    expect(latestAppearance(messages)?.explanation).toContain("authorized T3 connection");
    expect(t3.appearance.reads).toBe(0);
  }),
);

it.effect("a changed environment default replaces the presentation on the next read", (context) =>
  Effect.gen(function* () {
    // Arrange
    const { t3, live } = yield* followingService(context);

    // Act
    t3.appearance.defaultTheme = "ember";

    // Assert
    const messages = yield* nextRead(
      live,
      (received) => latestAppearance(received)?.presentation?.theme.id === "ember",
    );
    expect(latestAppearance(messages)?.presentation?.modes.dark.kind).toBe("inherited");
  }),
);

it.effect("a cleared environment default uses Factory's colors and explains why", (context) =>
  Effect.gen(function* () {
    // Arrange
    const { t3, live } = yield* followingService(context);

    // Act
    t3.appearance.defaultTheme = "";

    // Assert
    const messages = yield* nextRead(
      live,
      (received) => latestAppearance(received)?.presentation === null,
    );
    expect(latestAppearance(messages)?.state).toBe("following");
    expect(latestAppearance(messages)?.explanation).toContain("no default theme");
  }),
);

it.effect(
  "a published default theme generated from dark seeds is inherited in Dark while Light keeps Factory's colors and says why",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context);
      t3.appearance.themes = [nightfall];

      // Act
      t3.appearance.defaultTheme = "nightfall";

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation?.theme.id === "nightfall",
      );
      const followed = latestAppearance(messages);
      expect(followed?.explanation).toBe("Following T3’s default theme “Nightfall”.");
      expect(followed?.presentation?.modes.dark).toMatchObject({
        kind: "inherited",
        colors: { background: "#14121f", primary: "#7c5cff" },
      });
      expect(followed?.presentation?.modes.light).toStrictEqual({
        kind: "baseline",
        explanation: "T3 theme “Nightfall” has no Light colors. Factory’s Light colors are used.",
      });
    }),
);

it.effect(
  "an edit that adds a Light variant to the followed definition makes Light inherited too",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context, (t3) => {
        t3.appearance.themes = [nightfall];
        t3.appearance.defaultTheme = "nightfall";
      });

      // Act
      t3.appearance.themes = [{ ...nightfall, variants: { light: { canvas: "#fff8eb" } } }];

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation?.modes.light.kind === "inherited",
      );
      expect(latestAppearance(messages)?.presentation?.modes).toMatchObject({
        light: { colors: { background: "#fff8eb" } },
        dark: { colors: { background: "#14121f" } },
      });
    }),
);

it.effect(
  "a variant whose canvas does not read as its mode is rejected without discarding the valid other mode",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context);
      t3.appearance.themes = [{ ...nightfall, variants: { light: { canvas: "#000000" } } }];

      // Act
      t3.appearance.defaultTheme = "nightfall";

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation?.theme.id === "nightfall",
      );
      expect(latestAppearance(messages)?.presentation?.modes.dark.kind).toBe("inherited");
      expect(latestAppearance(messages)?.presentation?.modes.light).toStrictEqual({
        kind: "baseline",
        explanation:
          "T3 theme “Nightfall” has Light colors with a canvas that does not read as Light. Factory’s Light colors are used.",
      });
    }),
);

it.effect(
  "a published theme whose canvas is translucent is rejected for that mode as unreadable",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context);
      t3.appearance.themes = [{ ...nightfall, colors: { canvas: "#14121f80" } }];

      // Act
      t3.appearance.defaultTheme = "nightfall";

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation?.theme.id === "nightfall",
      );
      expect(latestAppearance(messages)?.presentation?.modes.dark).toStrictEqual({
        kind: "baseline",
        explanation:
          "T3 theme “Nightfall” has Dark colors with colors Factory cannot read. Factory’s Dark colors are used.",
      });
    }),
);

it.effect(
  "removing the followed definition from T3 returns to Factory's colors and says why",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context, (t3) => {
        t3.appearance.themes = [nightfall];
        t3.appearance.defaultTheme = "nightfall";
      });

      // Act
      t3.appearance.themes = [];

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation === null,
      );
      expect(latestAppearance(messages)?.state).toBe("following");
      expect(latestAppearance(messages)?.explanation).toBe(
        "T3’s default theme “nightfall” is not available in T3, so Factory’s own colors are used. Factory follows it once T3 publishes it.",
      );
    }),
);

it.effect(
  "a default theme in a format Factory does not support uses Factory's colors and Settings names it",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context);
      t3.appearance.themes = [{ ...nightfall, version: 2 }];

      // Act
      t3.appearance.defaultTheme = "nightfall";

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation === null,
      );
      expect(latestAppearance(messages)?.explanation).toBe(
        "T3’s default theme “Nightfall” uses a theme format Factory does not support, so Factory’s own colors are used.",
      );
    }),
);

it.effect(
  "a followed theme with a color Factory cannot read keeps the rest and Settings counts what was ignored",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { t3, live } = yield* followingService(context);
      t3.appearance.themes = [{ ...nightfall, colors: { accent: "var(--accent)" } }];

      // Act
      t3.appearance.defaultTheme = "nightfall";

      // Assert
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.presentation?.theme.id === "nightfall",
      );
      expect(latestAppearance(messages)?.explanation).toBe(
        "Following T3’s default theme “Nightfall”. 1 color Factory cannot read was ignored.",
      );
      expect(latestAppearance(messages)?.presentation?.modes.dark).toMatchObject({
        colors: { primary: "#7c5cff" },
      });
    }),
);

it.effect(
  "clients are told the connection's T3 environment as the current theme-color source",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { factory, t3 } = yield* followingService(context);

      // Act
      const source = yield* factory.getAppearanceSource();

      // Assert
      assert(source.ok);
      expect(source.value?.environmentId).toBe(t3.environmentId);
    }),
);

it.effect(
  "changing the T3 endpoint while T3 is unreachable discards the inherited colors of the previous source",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { factory, t3, live } = yield* followingService(context);
      t3.available = false;

      // Act
      assert((yield* factory.configureConnection({ endpoint: "http://127.0.0.1:4888/mcp" })).ok);

      // Assert
      const messages = yield* Effect.promise(() =>
        live.until((received) => latestAppearance(received)?.state === "unavailable"),
      );
      expect(latestAppearance(messages)?.presentation).toBe(null);
    }),
);

it.effect(
  "a T3 connection to another environment replaces the colors with that environment's",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { factory, t3, live } = yield* followingService(context);
      t3.environmentId = "replacement-environment";

      // Act
      assert((yield* factory.recheckConnection()).ok);

      // Assert
      const messages = yield* Effect.promise(() =>
        live.until(
          (received) =>
            latestAppearance(received)?.presentation?.environmentId === "replacement-environment",
        ),
      );
      expect(latestAppearance(messages)?.state).toBe("following");
    }),
);

it.effect("a transient outage keeps the last colors", (context) =>
  Effect.gen(function* () {
    // Arrange
    const { t3, live } = yield* followingService(context);

    // Act
    t3.available = false;

    // Assert
    const messages = yield* nextRead(
      live,
      (received) => latestAppearance(received)?.state === "unavailable",
    );
    expect(latestAppearance(messages)?.presentation?.theme.id).toBe("ocean");
  }),
);

it("Start is accepted and raises no attention while T3 shares no theme colors", async (context) => {
  // Arrange
  const { f, t3, input } = await prepared(context);
  t3.appearance.supported = false;
  assert((await f.recheckConnection()).ok);

  // Act
  const started = await f.startRun(input);

  // Assert
  assert(started.ok);
  expect(started.value.attention).toStrictEqual([]);
});

it.effect(
  "a backend restarted while T3 is unreachable publishes the last valid colors of the same source from its first status",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { harness, t3 } = yield* stoppedFollowingService(context);
      t3.available = false;

      // Act
      const factory = yield* harness.service({ t3, connectionRetryMs: 1_000 });

      // Assert
      const live = subscribe(context, factory.live.watchAppearance());
      const messages = yield* Effect.promise(() =>
        live.until((received) => latestAppearance(received)?.state === "unavailable"),
      );
      expect(messages.map((message) => message.appearance.presentation?.theme.id)).toStrictEqual(
        messages.map(() => "ocean"),
      );
    }),
);

it.effect(
  "reconnecting after a restart replaces the kept colors with T3's current default in one revision",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { harness, t3 } = yield* stoppedFollowingService(context);
      t3.available = false;
      const factory = yield* harness.service({ t3, connectionRetryMs: 1_000 });
      const restored = subscribe(context, factory.live.watchAppearance());
      yield* Effect.promise(() =>
        restored.until(
          (received) => latestAppearance(received)?.presentation?.theme.id === "ocean",
        ),
      );
      const live = subscribe(context, factory.live.watchAppearance());
      t3.appearance.defaultTheme = "iris";
      t3.available = true;

      // Act
      const messages = yield* nextRead(
        live,
        (received) => latestAppearance(received)?.state === "following",
      );

      // Assert
      expect(latestAppearance(messages)?.presentation?.theme.id).toBe("iris");
      expect(messages.filter((message) => !message.appearance.presentation)).toStrictEqual([]);
    }),
);

it.effect(
  "returning to an earlier T3 endpoint while T3 is unreachable restores none of its old colors",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const { harness, t3 } = yield* stoppedFollowingService(context);
      t3.available = false;
      const factory = yield* harness.service({ t3, connectionRetryMs: 1_000 });
      const restored = subscribe(context, factory.live.watchAppearance());
      yield* Effect.promise(() =>
        restored.until(
          (received) => latestAppearance(received)?.presentation?.theme.id === "ocean",
        ),
      );
      assert((yield* factory.configureConnection({ endpoint: "http://127.0.0.1:4888/mcp" })).ok);
      yield* Effect.promise(() =>
        restored.until((received) => latestAppearance(received)?.presentation === null),
      );

      // Act
      assert((yield* factory.configureConnection({ endpoint: T3_ENDPOINT })).ok);

      // Assert
      const messages = yield* Effect.promise(() =>
        restored.until((received) => latestAppearance(received)?.state === "unavailable"),
      );
      expect(latestAppearance(messages)?.presentation).toBe(null);
    }),
);
