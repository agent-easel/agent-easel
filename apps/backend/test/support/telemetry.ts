import type { TestContext } from "@effect/vitest";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { json } from "node:stream/consumers";

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
    firstRequest,
    disconnected,
  };
}
