import { assert, expect, it } from "vite-plus/test";
import {
  MAX_THEME_JSON_BYTES,
  parseCustomThemeJson,
  parseStoredCustomTheme,
} from "@t3-factory/domain-validation";
import { noticesForApply } from "../src/components/theme-color-settings.tsx";

function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = hexLuminance(a);
  const lb = hexLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

it("a dark seed theme generates custom dark colors and keeps Factory light colors", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Nightfall",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  expect(result.presentation.name).toBe("Nightfall");
  expect(result.presentation.modes.dark.kind).toBe("custom");
  expect(result.presentation.modes.light.kind).toBe("baseline");
  expect(result.unreadColors).toBe(0);
});

it("a dark theme with a light variant generates custom colors for both modes", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Dusk",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    variants: {
      light: {
        canvas: "#fff8eb",
        accent: "#6d28d9",
      },
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  expect(result.presentation.modes.dark.kind).toBe("custom");
  expect(result.presentation.modes.light.kind).toBe("custom");
});

it("a T3 v1 config with one valid seed and explicit colors applies the colors to the base palette", () => {
  // Arrange
  const json = JSON.stringify({
    appearance: "dark",
    canvas: "#111111",
    colors: {
      accent: "#9d6cff",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  expect(result.presentation.name).toBe("Custom theme");
  expect(result.presentation.modes.dark.kind).toBe("custom");
});

it("a theme whose canvas does not match its declared polarity is rejected", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Inverted",
    appearance: "dark",
    canvas: "#ffffff",
    accent: "#6d28d9",
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(!result.ok);
  expect(result.details).toContain("does not read as Dark");
});

it("malformed JSON is rejected without throwing", () => {
  // Arrange
  const raw = "{ not json";

  // Act
  const result = parseCustomThemeJson(raw);

  // Assert
  assert(!result.ok);
  expect(result.message).toBe("Theme config is not valid JSON.");
});

it("UTF-8 payloads exceeding the 128 KB byte limit are rejected even when UTF-16 length is below the limit", () => {
  // Arrange
  const multibyte = "ą".repeat(MAX_THEME_JSON_BYTES / 2 + 10);
  const raw = JSON.stringify({
    name: "Large",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    extra: multibyte,
  });

  // Act
  const result = parseCustomThemeJson(raw);

  // Assert
  assert(!result.ok);
  expect(raw.length).toBeLessThan(MAX_THEME_JSON_BYTES);
  expect(result.message).toBe("Theme config is larger than the 128 KB limit.");
});

it("unreadable color values on mapped roles are ignored and counted while keeping the generated base", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Partial",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    colors: {
      sidebar: "not-a-color",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  expect(result.unreadColors).toBe(1);
  expect(result.presentation.modes.dark.kind).toBe("custom");
});

it("section labels maintain at least 3:1 contrast against sidebar as well as canvas and card surfaces", () => {
  // Arrange
  const json = JSON.stringify({
    name: "SidebarLabels",
    appearance: "dark",
    colors: {
      canvas: "#000000",
      surfaceRaised: "#000000",
      sidebar: "#606060",
      placeholder: "#606060",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.dark.kind === "custom");
  const c = result.presentation.modes.dark.colors;
  expect(contrastRatio(c["subtle-foreground"], c.sidebar)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(c["subtle-foreground"], c.background)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(c["subtle-foreground"], c.card)).toBeGreaterThanOrEqual(3);
});

it("foreground, secondary text, sidebar text and status colors are adjusted to meet WCAG contrast on hover and sidebar surfaces", () => {
  // Arrange
  const json = JSON.stringify({
    name: "LowContrast",
    appearance: "dark",
    colors: {
      canvas: "#121218",
      surfaceRaised: "#1c1c26",
      sidebar: "#181822",
      text: "#22222c",
      textMuted: "#262632",
      sidebarForeground: "#20202a",
      accent: "#6d28d9",
      accentForeground: "#6d28d9",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.dark.kind === "custom");
  const c = result.presentation.modes.dark.colors;
  expect(contrastRatio(c.foreground, c.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c.foreground, c.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["muted-foreground"], c.sidebar)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["muted-foreground"], c["sidebar-accent"])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["sidebar-foreground"], c.sidebar)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["sidebar-foreground"], c["sidebar-accent"])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c.destructive, c.sidebar)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["status-working"], c.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["primary-foreground"], c.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["primary-foreground"], c["primary-hover"])).toBeGreaterThanOrEqual(4.5);
});

it("status colors are adjusted away from Factory defaults when a surface would otherwise fail 4.5:1", () => {
  // Arrange
  const json = JSON.stringify({
    name: "LighterSidebar",
    appearance: "dark",
    colors: {
      canvas: "#121218",
      surfaceRaised: "#1c1c26",
      sidebar: "#52525b",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.dark.kind === "custom");
  const c = result.presentation.modes.dark.colors;
  expect(contrastRatio("#ef4444", "#52525b")).toBeLessThan(4.5);
  expect(c.destructive).not.toBe("#ef4444");
  expect(contrastRatio(c.destructive, c.sidebar)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c.destructive, c.background)).toBeGreaterThanOrEqual(4.5);
});

it("when one mode has impossible contrast, that mode falls back to Factory baseline while the other stays custom", () => {
  // Arrange
  const json = JSON.stringify({
    name: "ImpossibleLight",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    variants: {
      light: {
        canvas: "#ffffff",
        surfaceRaised: "#ffffff",
        sidebar: "#000000",
      },
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  expect(result.presentation.modes.dark.kind).toBe("custom");
  assert(result.presentation.modes.light.kind === "baseline");
  expect(result.presentation.modes.light.explanation).toContain("that cannot be made readable");
});

it("a mid-lightness accent lightens on hover when darkening would make action labels unreadable", () => {
  // Arrange
  const json = JSON.stringify({
    name: "MidAccent",
    appearance: "dark",
    canvas: "#121218",
    accent: "#7c7c7c",
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.dark.kind === "custom");
  const c = result.presentation.modes.dark.colors;
  expect(hexLuminance(c["primary-hover"])).toBeGreaterThan(hexLuminance(c.primary));
  expect(contrastRatio(c["primary-foreground"], c.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(c["primary-foreground"], c["primary-hover"])).toBeGreaterThanOrEqual(4.5);
});

it("a translucent color on a mapped role rejects that mode to Factory baseline", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Translucent",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    colors: {
      sidebar: "rgba(20, 18, 31, 0.5)",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(!result.ok);
  expect(result.details).toContain("colors Factory cannot read");
});

it("stored custom themes are re-derived from rawJson so tampered presentations cannot bypass WCAG checks", () => {
  // Arrange
  const rawJson = JSON.stringify({
    name: "Nightfall",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
  });
  const parsed = parseCustomThemeJson(rawJson);
  assert(parsed.ok);
  assert(parsed.presentation.modes.dark.kind === "custom");
  const tamperedPresentation = {
    version: 1,
    rawJson,
    presentation: {
      ...parsed.presentation,
      modes: {
        ...parsed.presentation.modes,
        dark: {
          kind: "custom",
          colors: {
            ...parsed.presentation.modes.dark.colors,
            foreground: parsed.presentation.modes.dark.colors.background,
          },
        },
      },
    },
  };
  const invalidJsonStored = {
    version: 1,
    rawJson: JSON.stringify({
      name: "Bad",
      appearance: "dark",
      canvas: "#ffffff",
      accent: "#000000",
    }),
    presentation: parsed.presentation,
  };

  // Act
  const restored = parseStoredCustomTheme(tamperedPresentation);
  const rejected = parseStoredCustomTheme(invalidJsonStored);

  // Assert
  assert(restored !== null);
  expect(restored.presentation).toStrictEqual(parsed.presentation);
  expect(rejected).toBeNull();
});

it("applying a theme with an unreadable mapped color while storage is unavailable preserves both notices", () => {
  // Arrange
  const parsed = parseCustomThemeJson(
    JSON.stringify({
      name: "PartialNoStorage",
      appearance: "dark",
      canvas: "#14121f",
      accent: "#9d6cff",
      colors: { sidebar: "not-a-color" },
    }),
  );
  assert(parsed.ok);

  // Act
  const notices = noticesForApply(
    {
      ok: true,
      presentation: parsed.presentation,
      unreadColors: parsed.unreadColors,
      storageWarning:
        "This browser blocks saved settings, so the custom colors apply until this tab closes.",
    },
    false,
  );

  // Assert
  expect(notices).toHaveLength(2);
  expect(notices[0]?.title).toBe("Custom colors applied for this tab only");
  expect(notices[1]?.title).toBe("1 color Factory cannot read was ignored");
});

it("low-contrast dark borders and inputs are lifted to stay visible on muted, card, canvas and sidebar surfaces", () => {
  // Arrange
  const json = JSON.stringify({
    name: "Vesper",
    appearance: "dark",
    colors: {
      canvas: "oklch(0.173042 0 0)",
      surfaceRaised: "oklch(0.200193 0 0)",
      border: "oklch(0.22645 0 0)",
      input: "oklch(0.22645 0 0)",
      sidebar: "oklch(0.173042 0 0)",
      text: "oklch(1 0 0)",
      textMuted: "oklch(0.705757 0 0)",
      placeholder: "oklch(0.431281 0 0)",
      focus: "oklch(0.86889 0.087746 60.679)",
      accent: "oklch(0.86889 0.087746 60.679)",
      accentForeground: "oklch(0 0 0)",
      sidebarForeground: "oklch(1 0 0)",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.dark.kind === "custom");
  const c = result.presentation.modes.dark.colors;
  expect(contrastRatio(c.border, c.background)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.muted)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.card)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.sidebar)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c["sidebar-border"], c.sidebar)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.input, c.muted)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.input, c.card)).toBeGreaterThanOrEqual(1.3);
});

it("low-contrast light borders and inputs are darkened to stay visible on muted, card, canvas and sidebar surfaces", () => {
  // Arrange
  const json = JSON.stringify({
    name: "SoftPaper",
    appearance: "light",
    colors: {
      canvas: "#ffffff",
      surfaceRaised: "#ffffff",
      sidebar: "#f7f7f8",
      border: "#f4f4f5",
      input: "#f4f4f5",
    },
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(result.ok);
  assert(result.presentation.modes.light.kind === "custom");
  const c = result.presentation.modes.light.colors;
  expect(contrastRatio(c.border, c.background)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.muted)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.card)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.border, c.sidebar)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c["sidebar-border"], c.sidebar)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.input, c.muted)).toBeGreaterThanOrEqual(1.3);
  expect(contrastRatio(c.input, c.card)).toBeGreaterThanOrEqual(1.3);
});
