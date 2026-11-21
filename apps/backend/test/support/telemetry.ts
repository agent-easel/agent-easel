import type { TestContext } from "@effect/vitest";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { json } from "node:stream/consumers";
import { loadConfiguration } from "../../src/config.ts";
import { startServer } from "../../src/server.ts";
import { factoryHarness } from "./factory.ts";

export async function mockIngest(
  context: TestContext,
  statuses: readonly (number | "hang")[] = [],
) {
  const requests: { path: string | undefined; method: string | undefined; body: unknown }[] = [];
  const signals = new EventEmitter();
  const firstRequest = once(signals, "request");
  const disconnected = once(signals, "disconnect");
  const server = createServer((request, response) => {
    void json(request).then(
      (body) => {
        const status = statuses[requests.length] ?? 200;
        requests.push({ path: request.url, method: request.method, body });
        signals.emit("request");
        if (status === "hang") {
          response.once("close", () => signals.emit("disconnect"));
          return;
        }
        response.writeHead(status).end();
      },
      () => response.writeHead(400).end(),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.onTestFinished(() => {
    server.close();
    server.closeAllConnections();
  });
  const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ingest`;
  return {
    host,
    env: {
      FACTORY_TELEMETRY_ENABLED: "true",
      FACTORY_TELEMETRY_HOST: host,
      FACTORY_POSTHOG_KEY: "local",
    },
    requests,
    events: (name: string) =>
      requests
        .flatMap(
          ({ body }) =>
            (body as { batch: { event: string; properties: Record<string, unknown> }[] }).batch,
        )
        .filter((entry) => entry.event === name),
    firstRequest,
    disconnected,
  };
}

export async function settingsHost(
  context: TestContext,
  statuses: readonly (number | "hang")[] = [],
) {
  const ingest = await mockIngest(context, statuses);
  const harness = await factoryHarness(context);
  const open = async (override?: string) => {
    const config = await loadConfiguration({
      FACTORY_HOME: harness.processHome,
      FACTORY_PORT: "0",
    });
    const server = await startServer(config, {
      uiDirectory: null,
      git: harness.git,
      telemetry: {
        packagedChannel: "stable",
        env: { ...ingest.env, FACTORY_TELEMETRY_ENABLED: override },
      },
    });
    context.onTestFinished(() => server.close());
    const url = `http://127.0.0.1:${server.address.port}/api/settings/telemetry`;
    return {
      close: server.close,
      read: () => fetch(url),
      set: (telemetryEnabled: boolean) =>
        fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-factory-request": "1" },
          body: JSON.stringify({ telemetryEnabled }),
        }),
    };
  };
  return { ingest, open };
}
