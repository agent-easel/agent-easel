import { expect, it } from "@effect/vitest";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestContext } from "@effect/vitest";
import { LiveT3Adapter } from "../src/adapters/live-t3.ts";
import { latestAppearance } from "./support/appearance.ts";
import { factoryHarness } from "./support/factory.ts";
import { subscribe } from "./support/live.ts";
import { oauthT3 } from "./support/oauth-t3.ts";
import { upstreamPublishedTheme } from "./support/t3-theme-fixture.ts";

/** T3's published "Nightfall" file as `t3_theme_read` returns it: without its id. */
const { id: _id, ...nightfallFile } = upstreamPublishedTheme("seed-dark").wire;

/** A Factory whose only T3 credential is the approved MCP OAuth grant of `external`. */
async function authorizedFactory(
  context: TestContext,
  external: Awaited<ReturnType<typeof oauthT3>>,
  credentialsDirectory?: (directory: string) => Promise<void>,
) {
  const harness = await factoryHarness(context);
  const directory = join(dirname(harness.databasePath), "credentials");
  await credentialsDirectory?.(directory);
  let approval = "";
  const adapter = new LiveT3Adapter({
    credentialsDirectory: directory,
    callbackPort: 0,
    openBrowser: async (url) => {
      approval = url;
    },
  });
  const factory = await harness.open({ t3: adapter });
  await factory.configureConnection({ endpoint: external.endpoint });
  await factory.authorizeConnection();
  expect((await fetch(external.approvalUrl(approval))).status).toBe(200);
  await factory.recheckConnection();
  return { factory, adapter, directory };
}

it("Factory follows T3's published default theme over the authorized T3 connection without another pairing", async (context) => {
  // Arrange
  const reads: unknown[] = [];
  const external = await oauthT3({
    themeRead: (args) => {
      reads.push(args);
      return args.themeId === "nightfall"
        ? { current: "nightfall", published: [], theme: nightfallFile, guide: "" }
        : {
            current: "nightfall",
            builtIn: ["t3-chat", "ocean"],
            published: [{ id: "nightfall", name: "Nightfall", hasCss: false }],
            guide: "",
          };
    },
  });
  context.onTestFinished(() => external.close());

  // Act
  const { factory } = await authorizedFactory(context, external);

  // Assert
  const live = subscribe(context, factory.live.watchAppearance());
  const messages = await live.until(
    (received) => latestAppearance(received)?.state === "following",
  );
  expect(latestAppearance(messages)?.presentation?.theme).toStrictEqual({
    id: "nightfall",
    name: "Nightfall",
  });
  expect(latestAppearance(messages)?.presentation?.modes.dark.kind).toBe("inherited");
  expect(reads).toContainEqual({ themeId: "nightfall" });
});

it("a T3 that lists no t3_theme_read reads as unsupported rather than as an outage", async (context) => {
  // Arrange
  const external = await oauthT3();
  context.onTestFinished(() => external.close());
  const { adapter } = await authorizedFactory(context, external);

  // Act
  const read = await adapter.readTheme({ endpoint: external.endpoint });

  // Assert
  expect(read).toBe(null);
});

it("a default theme id outside T3's published form reaches Factory cut and unable to name a theme", async (context) => {
  // Arrange
  const external = await oauthT3({
    themeRead: () => ({ current: "ocean".repeat(12), builtIn: [], published: [], guide: "" }),
  });
  context.onTestFinished(() => external.close());
  const { adapter } = await authorizedFactory(context, external);

  // Act
  const read = await adapter.readTheme({ endpoint: external.endpoint });

  // Assert
  expect(read?.defaultTheme).toBe(`${"ocean".repeat(12).slice(0, 48)}…`);
  expect(read?.themes).toStrictEqual([]);
});

it("the token of the former separately paired theme-color grant is deleted", async (context) => {
  // Arrange
  const external = await oauthT3();
  context.onTestFinished(() => external.close());
  const leftover = `t3-appearance-${"0".repeat(64)}.json`;

  // Act
  const { directory } = await authorizedFactory(context, external, async (directory) => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, leftover), JSON.stringify({ token: "former-theme-token" }));
  });

  // Assert
  expect(await readdir(directory)).not.toContain(leftover);
});
