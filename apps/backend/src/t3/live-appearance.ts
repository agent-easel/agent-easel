import type { T3AppearanceReader } from "./appearance.ts";
import { structured, type T3Calls, type T3Endpoint } from "./connection.ts";
import { readEnvironmentIdentity } from "./environment-identity.ts";
import { themeListing, themeRead } from "./theme-read.ts";

export class LiveT3Appearance implements T3AppearanceReader {
  private readonly connection: T3Calls;

  constructor(connection: T3Calls) {
    this.connection = connection;
  }

  async readTheme(target: T3Endpoint) {
    return this.connection.authorized(target, async (session) => {
      const tools = await session.tools();
      if (!tools.some((tool) => tool.name === "t3_theme_read")) return null;
      const read = async (args: Record<string, string>) =>
        structured(await session.call("t3_theme_read", args, 10_000));
      const environmentId = await readEnvironmentIdentity(session);
      const listing = themeListing(await read({}));
      const file = listing.published.includes(listing.defaultTheme)
        ? await read({ themeId: listing.defaultTheme })
        : null;
      return themeRead(environmentId, listing, file);
    });
  }
}
