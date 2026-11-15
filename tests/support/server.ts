import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { proxyFixture } from "./proxy.ts";
import { appearanceFixture } from "./fixture/appearance.ts";
import { startJourneyDiscord, discordFixture } from "./fixture/discord.ts";
import { startHost } from "./fixture/host.ts";
import { liveFixture } from "./fixture/live.ts";
import { recordedServerUpdates, remoteAccessFixture } from "./fixture/remote-access.ts";
import { reportingFixture } from "./fixture/reporting.ts";
import { runImagesAndTitlesFixture } from "./fixture/run-images-and-titles.ts";
import { scenariosFixture } from "./fixture/scenarios.ts";
import { FIXTURE_PREFIX, type FixtureModule } from "./fixture/seam.ts";

const discord = await startJourneyDiscord();
const serverUpdates = recordedServerUpdates();
const host = await startHost({
  discordApiUrl: discord.apiUrl,
  applicationUpdates: serverUpdates.applicationUpdates,
});
const remoteAccess = await remoteAccessFixture(host, serverUpdates, () => live.snapshotDelayMs());
const live = liveFixture(host.server.address.port, remoteAccess.liveSocketCount);
const scenarios = await scenariosFixture(host);

/**
 * Every fixture module, in shared reset order: the host's T3 connection comes back first, since
 * the other modules' resets need it available and authorized.
 */
const modules = {
  remoteAccess,
  live,
  discord: discordFixture(discord),
  appearance: appearanceFixture(host),
  reporting: reportingFixture(host),
  runImagesAndTitles: runImagesAndTitlesFixture(host, scenarios),
  scenarios,
} satisfies Record<string, FixtureModule>;

export type FixtureModules = typeof modules;

async function readJson(incoming: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  return body === "" ? undefined : JSON.parse(body);
}

/** Runs one fixture action, or the shared reset; an unknown path is an error, never proxied. */
async function dispatch(pathname: string, input: unknown): Promise<unknown> {
  const [name, action, ...rest] = pathname.slice(FIXTURE_PREFIX.length + 1).split("/");
  if (name === "reset" && action === undefined) {
    for (const module of Object.values(modules)) await module.reset();
    return undefined;
  }
  const module: FixtureModule | undefined = Object.hasOwn(modules, name!)
    ? modules[name as keyof FixtureModules]
    : undefined;
  if (!module || !action || rest.length > 0 || !Object.hasOwn(module.actions, action))
    throw new UnknownFixtureRoute(pathname);
  return module.actions[action]!(input as never);
}

class UnknownFixtureRoute extends Error {
  constructor(pathname: string) {
    super(`Unknown fixture route ${pathname}`);
  }
}

const isFixturePath = (pathname: string) =>
  pathname === FIXTURE_PREFIX || pathname.startsWith(`${FIXTURE_PREFIX}/`);

const proxy = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", "http://fixture");
  if (incoming.method === "POST" && isFixturePath(url.pathname)) {
    void readJson(incoming)
      .then((input) => dispatch(url.pathname, input))
      .then((observed) => {
        outgoing.writeHead(observed === undefined ? 204 : 200, {
          "content-type": "application/json",
        });
        outgoing.end(observed === undefined ? undefined : JSON.stringify(observed));
      })
      .catch((error: unknown) => {
        console.error(error);
        outgoing.writeHead(error instanceof UnknownFixtureRoute ? 404 : 500, {
          "content-type": "text/plain",
        });
        outgoing.end(error instanceof Error ? error.message : String(error));
      });
    return;
  }
  live.record(incoming, url.pathname);
  if (remoteAccess.relay(incoming, outgoing)) return;
  if (isFixturePath(url.pathname)) {
    outgoing.writeHead(404, { "content-type": "text/plain" });
    outgoing.end(`Unknown fixture route ${url.pathname}`);
    return;
  }
  proxyFixture(incoming, outgoing, host.server.address.port);
});
proxy.on("upgrade", (incoming: IncomingMessage, socket: Duplex) => {
  if (!remoteAccess.relayUpgrade(incoming, socket)) live.relayHostUpgrade(incoming, socket);
});
await new Promise<void>((resolve) => proxy.listen(host.port, "127.0.0.1", resolve));

async function shutdown() {
  proxy.close();
  await Promise.all([host.close(), remoteAccess.close()]);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void shutdown().catch((cause: unknown) => {
      process.stderr.write(`${new Error("Fixture shutdown failed.", { cause }).stack}\n`);
      process.exit(1);
    });
  });
