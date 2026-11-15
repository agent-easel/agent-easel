import { upstreamPublishedTheme } from "../../../apps/backend/test/support/t3-theme-fixture.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/**
 * Theme files the T3 owner published, as upstream's parity fixture defines them: "Nightfall"
 * from dark seeds only, "Dusk" from dark seeds with a Light variant, and "Future" in a theme
 * file version Factory does not read.
 */
const nightfallThemeFile = upstreamPublishedTheme("seed-dark").wire;
const publishedThemeFiles = [
  nightfallThemeFile,
  upstreamPublishedTheme("seed-with-variant").wire,
  { ...nightfallThemeFile, id: "future", name: "Future", version: 2 },
];

/** Theme colors of the host's controlled T3 environment. */
export function appearanceFixture({ factory, t3 }: Host) {
  return {
    actions: {
      publish: () => t3.appearance.publishThemes(publishedThemeFiles),
      /** `t3 theme set <id>` on the environment; the id need not be published. */
      setDefaultTheme({ theme }: { theme: string }) {
        t3.appearance.setDefaultTheme(theme);
      },
      async pair() {
        requireSuccess(await factory.pairAppearance({ pairing: t3.appearance.pairingCode }));
      },
      pairingCode: () => ({ code: t3.appearance.pairingCode }),
      /** `t3 auth session revoke` from another T3 process: open subscriptions keep streaming. */
      revoke() {
        t3.appearance.sessionValid = false;
      },
    },
    /**
     * No grant, no published themes, T3's default theme Ocean and a session T3 still accepts.
     * T3's grant map is the adapter's credential store, so Factory holds a grant exactly when it
     * has an entry, including one paired through the UI.
     */
    async reset() {
      if (t3.appearance.grants.size > 0) requireSuccess(await factory.disconnectAppearance());
      t3.appearance.sessionValid = true;
      if (t3.appearance.themes.length > 0) t3.appearance.publishThemes([]);
      if (t3.appearance.defaultTheme !== "ocean") t3.appearance.setDefaultTheme("ocean");
    },
  };
}
