import { assert, expect, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { factoryHarness } from "./support/factory.ts";
import { mockIngest } from "./support/telemetry.ts";

const startupProperties = {
  isFirstRun: false,
  projectCount: "2-5",
  flowCount: "6+",
  agentCount: "1",
} as const;

it("backend startup sends an anonymous Beta event using the private identity it keeps across restarts", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context, { freshDatabase: true });
  const options = {
    applicationVersion: "1.2.3-beta.4",
    telemetry: {
      packagedChannel: "beta" as const,
      packagedKey: "test-build-token",
      serverMode: "desktop" as const,
      env: { FACTORY_TELEMETRY_HOST: ingest.host, FACTORY_POSTHOG_KEY: "test-runtime-token" },
    },
  };
  await (await harness.open(options)).close();
  const identityPath = join(harness.processHome, "telemetry-id");

  // Act
  await (await harness.open(options)).close();

  // Assert
  const identity = (await readFile(identityPath, "utf8")).trim();
  expect(identity).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect((await stat(identityPath)).mode & 0o777).toBe(0o600);
  const installId = createHash("sha256").update(identity).digest("hex");
  const startup = {
    path: "/ingest/batch/",
    method: "POST",
    body: {
      api_key: "test-runtime-token",
      batch: [
        {
          uuid: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          event: "app.started",
          distinct_id: installId,
          timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
          properties: {
            $process_person_profile: false,
            $geoip_disable: true,
            appVersion: "1.2.3-beta.4",
            version: "1.2.3-beta.4",
            channel: "beta",
            os: process.platform,
            arch: process.arch,
            serverMode: "desktop",
            mode: "desktop",
            isFirstRun: true,
            projectCount: "0",
            flowCount: "0",
            agentCount: "0",
          },
        },
      ],
    },
  };
  expect(ingest.requests).toStrictEqual([startup, startup]);
});

it.effect(
  "a transient rejection preserves event identity and retries only after its backoff",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const ingest = yield* Effect.promise(() => mockIngest(context, [503]));
      const harness = yield* Effect.promise(() => factoryHarness(context));
      const { telemetry } = yield* harness.service({
        telemetry: { env: ingest.env },
      });
      yield* telemetry.flush();
      yield* TestClock.adjust(1000);
      yield* telemetry.flush();
      expect(ingest.requests).toHaveLength(1);
      yield* TestClock.adjust(3000);

      // Act
      yield* telemetry.flush();

      // Assert
      expect(ingest.requests).toHaveLength(2);
      expect(ingest.requests[1]).toStrictEqual(ingest.requests[0]);
    }),
);

it.effect.each([400, 401, 413])(
  "a batch rejected with %i is dropped and the next batch waits",
  (status, context) =>
    Effect.gen(function* () {
      // Arrange
      const ingest = yield* Effect.promise(() => mockIngest(context, [status]));
      const harness = yield* Effect.promise(() => factoryHarness(context));
      const { telemetry } = yield* harness.service({
        telemetry: { env: ingest.env },
      });
      yield* telemetry.flush();
      yield* telemetry.record("app.started", startupProperties);
      yield* telemetry.flush();
      expect(ingest.requests).toHaveLength(1);
      yield* TestClock.adjust(4000);

      // Act
      yield* telemetry.flush();

      // Assert
      expect(ingest.requests).toHaveLength(2);
      expect(ingest.requests[1]?.body).toMatchObject({
        batch: [{ properties: startupProperties }],
      });
    }),
);

it("shutdown releases the backend within the telemetry budget even when ingestion hangs", async (context) => {
  // Arrange
  const ingest = await mockIngest(context, ["hang"]);
  const harness = await factoryHarness(context);
  const factory = await harness.open({
    telemetry: { env: ingest.env },
  });
  const started = performance.now();

  // Act
  await factory.close();

  // Assert
  expect(performance.now() - started).toBeLessThan(1500);
  expect(ingest.requests).toHaveLength(1);
  await ingest.disconnected;
});

it.effect("the backend sends queued telemetry on its ten-second background flush", (context) =>
  Effect.gen(function* () {
    // Arrange
    const ingest = yield* Effect.promise(() => mockIngest(context));
    const harness = yield* Effect.promise(() => factoryHarness(context));
    yield* harness.service({ telemetry: { env: ingest.env } });
    yield* TestClock.adjust(9999);
    expect(ingest.requests).toHaveLength(0);

    // Act
    yield* TestClock.adjust(1);

    // Assert
    yield* Effect.promise(() => ingest.firstRequest);
    expect(ingest.requests[0]?.body).toMatchObject({ batch: [{ event: "app.started" }] });
  }),
);

it.for([
  { label: "source without explicit opt-in", packaged: {}, enabled: undefined, key: "local" },
  {
    label: "packaged Release forced off by environment",
    packaged: { packagedChannel: "stable" as const },
    enabled: "false",
    key: "local",
  },
  {
    label: "packaged Release without a token",
    packaged: { packagedChannel: "stable" as const },
    enabled: undefined,
    key: undefined,
  },
])(
  "$label sends no startup event and creates no telemetry identity",
  async ({ packaged, enabled, key }, context) => {
    // Arrange
    const ingest = await mockIngest(context);
    const harness = await factoryHarness(context);

    // Act
    await (
      await harness.open({
        telemetry: {
          ...packaged,
          env: {
            FACTORY_TELEMETRY_HOST: ingest.host,
            FACTORY_TELEMETRY_ENABLED: enabled,
            FACTORY_POSTHOG_KEY: key,
          },
        },
      })
    ).close();

    // Assert
    expect(ingest.requests).toHaveLength(0);
    await expect(stat(join(harness.processHome, "telemetry-id"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("an invalid identity leaves the backend available and telemetry silent", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context);
  const identityPath = join(harness.processHome, "telemetry-id");
  await writeFile(identityPath, "private-path-or-other-invalid-content", { mode: 0o600 });

  // Act
  await (await harness.open({ telemetry: { env: ingest.env } })).close();

  // Assert
  expect(ingest.requests).toHaveLength(0);
  expect(await readFile(identityPath, "utf8")).toBe("private-path-or-other-invalid-content");
});

it.live(
  "the telemetry catalog rejects unknown events, extra fields, and unbucketed values",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const ingest = yield* Effect.promise(() => mockIngest(context));
      const harness = yield* Effect.promise(() => factoryHarness(context));
      const { telemetry } = yield* harness.service({ telemetry: { env: ingest.env } });
      yield* telemetry.flush();
      yield* telemetry.record("app.started", {
        ...startupProperties,
        projectName: "private",
      } as never);
      yield* telemetry.record("app.started", {
        ...startupProperties,
        agentCount: "/private/path",
      } as never);
      yield* telemetry.record("$identify" as "app.started", startupProperties);

      // Act
      yield* telemetry.flush();

      // Assert
      expect(ingest.requests).toHaveLength(1);
    }),
);

it("startup after First-run setup sends bucketed active definitions from the existing home", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context);
  const factory = await harness.open();
  assert((await factory.completeFirstRunSetup()).ok);
  assert((await factory.createFlow({ name: "Private Flow one" })).ok);
  assert((await factory.createFlow({ name: "Private Flow two" })).ok);
  await factory.close();

  // Act
  await (
    await harness.open({
      telemetry: {
        packagedChannel: "stable",
        packagedKey: "test-packaged-token",
        env: { FACTORY_TELEMETRY_HOST: ingest.host },
      },
    })
  ).close();

  // Assert
  expect(ingest.requests[0]?.body).toMatchObject({
    api_key: "test-packaged-token",
    batch: [
      {
        properties: {
          channel: "stable",
          isFirstRun: false,
          projectCount: "0",
          flowCount: "2-5",
          agentCount: "0",
        },
      },
    ],
  });
  expect(JSON.stringify(ingest.requests)).not.toContain("Private Flow");
});

it.live(
  "an overflowing telemetry queue drops its oldest events and sends at most twenty per batch",
  (context) =>
    Effect.gen(function* () {
      // Arrange
      const ingest = yield* Effect.promise(() => mockIngest(context));
      const harness = yield* Effect.promise(() => factoryHarness(context));
      const { telemetry } = yield* harness.service({ telemetry: { env: ingest.env } });
      yield* telemetry.record("app.started", { ...startupProperties, projectCount: "1" });
      yield* telemetry.record("app.started", { ...startupProperties, projectCount: "6+" });
      yield* Effect.forEach(
        Array.from({ length: 999 }),
        () => telemetry.record("app.started", startupProperties),
        { discard: true },
      );

      // Act
      yield* telemetry.flush();

      // Assert
      expect(ingest.requests[0]?.body).toMatchObject({
        batch: [
          { properties: { projectCount: "6+" } },
          ...Array.from({ length: 19 }, () => ({ properties: { projectCount: "2-5" } })),
        ],
      });
    }),
);

it.live("shutdown sends queued analytics while deferred enrichment is stalled", (context) =>
  Effect.gen(function* () {
    // Arrange
    const ingest = yield* Effect.promise(() => mockIngest(context));
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const scope = yield* Scope.make();
    const { telemetry } = yield* harness
      .service({ telemetry: { env: ingest.env } })
      .pipe(Scope.provide(scope));
    yield* telemetry.recordLater(Effect.never);

    // Act
    yield* Scope.close(scope, Exit.void);

    // Assert
    expect(ingest.events("app.started")).toHaveLength(1);
  }),
);

it.effect("a stalled batch is disconnected at the ten-second send timeout", (context) =>
  Effect.gen(function* () {
    // Arrange
    const ingest = yield* Effect.promise(() => mockIngest(context, ["hang"]));
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const { telemetry } = yield* harness.service({ telemetry: { env: ingest.env } });
    const flushing = yield* Effect.forkScoped(telemetry.flush());
    yield* Effect.promise(() => ingest.firstRequest);
    yield* TestClock.adjust(9999);
    expect(flushing.pollUnsafe()).toBeUndefined();

    // Act
    yield* TestClock.adjust(1);

    // Assert
    yield* Fiber.join(flushing);
    yield* Effect.promise(() => ingest.disconnected);
    expect(ingest.requests).toHaveLength(1);
  }),
);

it.live("telemetry sends the catalogued Run title action", (context) =>
  Effect.gen(function* () {
    // Arrange
    const ingest = yield* Effect.promise(() => mockIngest(context));
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const { telemetry } = yield* harness.service({ telemetry: { env: ingest.env } });

    // Act
    yield* telemetry.record("feature.used", { feature: "run_title_generated" });
    yield* telemetry.flush();

    // Assert
    expect(ingest.events("feature.used")).toMatchObject([
      { properties: { feature: "run_title_generated" } },
    ]);
  }),
);

it.effect.each([
  { feature: "private title" },
  { feature: "run_title_generated", title: "private title" },
])("telemetry discards uncatalogued feature properties %j", (properties, context) =>
  Effect.gen(function* () {
    // Arrange
    const ingest = yield* Effect.promise(() => mockIngest(context));
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const { telemetry } = yield* harness.service({ telemetry: { env: ingest.env } });

    // Act
    yield* telemetry.record("feature.used", properties as never);
    yield* telemetry.flush();

    // Assert
    expect(ingest.events("feature.used")).toHaveLength(0);
    expect(JSON.stringify(ingest.requests)).not.toContain("private title");
  }),
);
