import { assert, expect, it } from "vite-plus/test";
import { parseCustomThemeJson, parseStoredCustomTheme } from "@t3-factory/domain-validation";

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

it("a theme with only one seed color is rejected", () => {
  // Arrange
  const json = JSON.stringify({
    appearance: "dark",
    canvas: "#14121f",
  });

  // Act
  const result = parseCustomThemeJson(json);

  // Assert
  assert(!result.ok);
  expect(result.message).toBe('Provide both "canvas" and "accent" hex colors, or neither.');
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

it("a stored custom theme snapshot round-trips and rejects tampered color values", () => {
  // Arrange
  const rawJson = JSON.stringify({
    name: "Nightfall",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
  });
  const parsed = parseCustomThemeJson(rawJson);
  assert(parsed.ok);
  const validStored = { version: 1, rawJson, presentation: parsed.presentation };
  assert(parsed.presentation.modes.dark.kind === "custom");
  const tampered = {
    ...validStored,
    presentation: {
      ...parsed.presentation,
      modes: {
        ...parsed.presentation.modes,
        dark: {
          kind: "custom",
          colors: {
            ...parsed.presentation.modes.dark.colors,
            background: "url(javascript:alert(1))",
          },
        },
      },
    },
  };

  // Act
  const restored = parseStoredCustomTheme(validStored);
  const rejected = parseStoredCustomTheme(tampered);

  // Assert
  expect(restored).toStrictEqual(validStored);
  expect(rejected).toBeNull();
});
