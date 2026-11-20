import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { factoryHarness } from "./support/factory.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import { readConnection, readyConnection, recheckConnection } from "./support/boundaries-setup.ts";

it("configureConnection rejects endpoint URLs that embed credentials", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const result = await factory.configureConnection({
    endpoint: "https://user:secret@host/mcp",
  });

  // Assert
  expect(result.ok).toBe(false);
});

it("a valid endpoint saves as authorization-required without leaking authorization context", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const saved = await factory.configureConnection({ endpoint: "http://127.0.0.1:3773/mcp" });

  // Assert
  expect(saved.ok).toBe(true);
  expect(saved.ok && saved.value.state).toBe("authorization-required");
  expect(saved.ok && saved.value.authorizationContext).toBe(null);
});

it.effect("transient T3 outages reconnect to ready without a manual recheck", (context) =>
  Effect.gen(function* () {
    // Arrange
    const harness = yield* Effect.promise(() => factoryHarness(context));
    const t3 = new ControlledT3();
    t3.connection.authorized = true;
    const factory = yield* harness.service({ t3, connectionRetryMs: 1000 });
    yield* factory.configureConnection({ endpoint: "http://localhost:3773/mcp" });
    t3.connection.available = false;
    yield* factory.recheckConnection();

    // Act
    t3.connection.available = true;
    yield* TestClock.adjust(1000);

    // Assert
    const reconnected = yield* factory.getConnection();
    assert(reconnected.ok);
    expect(reconnected.value.state).toBe("ready");
  }),
);

it("revoked refresh requires explicit reauthorization and does not auto-start the browser", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.connection.authorized = true;
  const factory = await harness.open({ t3, connectionRetryMs: 10 });
  await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" });
  t3.contract.compatible = true;
  t3.connection.authorized = false;

  // Act
  await factory.recheckConnection();

  // Assert
  expect((await readConnection(factory)).state).toBe("authorization-required");
  expect(t3.connection.authorizationStarts).toBe(0);
});

it("successful reauthorization replaces the stored authorization context", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.connection.authorized = true;
  const factory = await harness.open({ t3, connectionRetryMs: 10 });
  await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" });
  const original = await readConnection(factory);
  t3.connection.authorized = false;
  await factory.recheckConnection();
  await factory.authorizeConnection();
  expect((await readConnection(factory)).authorizationContext).toBe(null);
  t3.connection.approve();

  // Act
  await factory.recheckConnection();

  // Assert
  const approved = await readConnection(factory);
  expect(approved.state).toBe("ready");
  expect(approved.authorizationContext?.id).not.toBe(original.authorizationContext?.id);
  expect(t3.connection.authorizationStarts).toBe(1);
});

it("changing the saved endpoint creates a new authorization binding", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.connection.authorized = true;
  const factory = await harness.open({ t3, connectionRetryMs: 10 });
  await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" });
  await factory.recheckConnection();
  const approved = await readConnection(factory);

  // Act
  await factory.configureConnection({ endpoint: "https://other.example/mcp" });

  // Assert
  assert.notEqual(
    (await readConnection(factory)).authorizationContext?.id,
    approved.authorizationContext?.id,
  );
});

it("plaintext non-loopback endpoints are rejected", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const result = await factory.configureConnection({ endpoint: "http://host.example/mcp" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
});

it("endpoint query parameters cannot carry credentials", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const result = await factory.configureConnection({
    endpoint: "https://host.example/mcp?token=secret",
  });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
});

it("a failed reopen of the approval page stays reported on later checks while approval is pending", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  const factory = await harness.open({ t3, connectionRetryMs: 60_000 });
  await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" });
  await factory.authorizeConnection();
  t3.connection.hostBrowserOpens = false;
  const reopened = await factory.openConnectionAuthorization();
  assert(reopened.ok);
  expect(reopened.value.authorizationOpenFailed).toBe(true);

  // Act
  await factory.recheckConnection();

  // Assert
  const connection = await readConnection(factory);
  expect(connection.authorizationPending).toBe(true);
  expect(connection.authorizationOpenFailed).toBe(true);
  expect(connection.explanation).toMatch(/could not open the backend-host browser/);
});

it("later checks of the same ready connection keep its ready generation", async (context) => {
  // Arrange
  const { factory, ready } = await readyConnection(context);

  // Act
  const rechecked = await factory.recheckConnection();

  // Assert
  assert(rechecked.ok);
  expect(rechecked.value.readyGeneration).toBe(ready.readyGeneration);
});

it("a reconnect after T3 was unavailable is a new ready generation for the same authorization context", async (context) => {
  // Arrange
  const { t3, factory, ready } = await readyConnection(context);
  t3.connection.available = false;
  expect((await recheckConnection(factory)).readyGeneration).toBeNull();
  t3.connection.available = true;

  // Act
  const reconnected = await factory.recheckConnection();

  // Assert
  assert(reconnected.ok);
  expect(reconnected.value.state).toBe("ready");
  expect(reconnected.value.authorizationContext?.id).toBe(ready.authorizationContext?.id);
  expect(reconnected.value.readyGeneration).toEqual(expect.any(String));
  expect(reconnected.value.readyGeneration).not.toBe(ready.readyGeneration);
});

it("a new authorization context while T3 stays ready is a new ready generation", async (context) => {
  // Arrange
  const { t3, factory, ready } = await readyConnection(context);
  t3.connection.identity = "controlled-grant-another";

  // Act
  const replaced = await factory.recheckConnection();

  // Assert
  assert(replaced.ok);
  expect(replaced.value.state).toBe("ready");
  expect(replaced.value.authorizationContext?.id).not.toBe(ready.authorizationContext?.id);
  expect(replaced.value.readyGeneration).toEqual(expect.any(String));
  expect(replaced.value.readyGeneration).not.toBe(ready.readyGeneration);
});
