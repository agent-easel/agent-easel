import { assert, expect, it } from "@effect/vitest";
import { remoteServer } from "./support/remote-clients.ts";
import { settingsHost } from "./support/telemetry.ts";

it("a saved opt-out stays off after restarting even with explicit environment opt-in", async (context) => {
  // Arrange
  const { ingest, open } = await settingsHost(context);
  const host = await open();
  assert((await host.set(false)).ok);
  await host.close();

  // Act
  const restarted = await open("true");

  // Assert
  expect(await (await restarted.read()).json()).toMatchObject({
    ok: true,
    value: { telemetryEnabled: false, effectiveEnabled: false, disabledReason: null },
  });
  await restarted.close();
  expect(ingest.requests).toHaveLength(0);
});

it("saving opt-out aborts an active batch and prevents any retry", async (context) => {
  // Arrange
  const { ingest, open } = await settingsHost(context, ["hang"]);
  const host = await open();
  await ingest.firstRequest;
  const started = performance.now();

  // Act
  const response = await host.set(false);

  // Assert
  expect(await response.json()).toMatchObject({ ok: true, value: { effectiveEnabled: false } });
  await ingest.disconnected;
  expect(performance.now() - started).toBeLessThan(5000);
  await host.close();
  expect(ingest.requests).toHaveLength(1);
});

it("saving On cannot enable delivery against the environment override", async (context) => {
  // Arrange
  const { ingest, open } = await settingsHost(context);
  const host = await open("false");
  assert((await host.set(false)).ok);

  // Act
  const response = await host.set(true);

  // Assert
  expect(await response.json()).toMatchObject({
    ok: true,
    value: { telemetryEnabled: true, effectiveEnabled: false, disabledReason: "environment" },
  });
  await host.close();
  expect(ingest.requests).toHaveLength(0);
});

it("an approved client cannot change the Factory host’s telemetry preference", async (context) => {
  // Arrange
  const server = await remoteServer(context, { telemetry: { env: {} } });
  const laptop = await server.approved("Laptop");

  // Act
  const reply = await laptop.send("PUT", "/api/settings/telemetry", { telemetryEnabled: false });

  // Assert
  expect(reply.status).toBe(403);
  expect(reply.body).toMatchObject({ ok: false, error: { code: "host_only" } });
  const read = await laptop.send("GET", "/api/settings/telemetry");
  expect(read.body).toMatchObject({
    ok: true,
    value: { telemetryEnabled: true, effectiveEnabled: false },
  });
});
