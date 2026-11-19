import { upstreamPublishedTheme } from "../../../apps/backend/test/support/t3-theme-fixture.ts";
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

/** Theme colors of the host's controlled T3 environment, as `t3_theme_read` serves them. */
export function appearanceFixture({ t3 }: Host) {
  return {
    actions: {
      publish({ defaultTheme }: { defaultTheme: string }) {
        t3.appearance.themes = publishedThemeFiles;
        t3.appearance.defaultTheme = defaultTheme;
      },
      /** `t3 theme set <id>` on the environment; the id need not be published. */
      setDefaultTheme({ theme }: { theme: string }) {
        t3.appearance.defaultTheme = theme;
      },
      /** A T3 build that lists no `t3_theme_read`. */
      unsupported() {
        t3.appearance.supported = false;
      },
    },
    /**
     * A T3 with `t3_theme_read`, no published themes and no default theme, so journeys see
     * Factory's own colors until they choose a T3 theme.
     */
    reset() {
      t3.appearance.supported = true;
      t3.appearance.themes = [];
      t3.appearance.defaultTheme = "";
    },
  };
}
