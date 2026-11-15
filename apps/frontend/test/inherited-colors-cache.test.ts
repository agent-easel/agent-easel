import { assert, expect, it } from "vite-plus/test";
import {
  cachedColors,
  followColors,
  forgetColors,
  rememberColors,
} from "../src/inherited-colors-cache.ts";
import type { AppearancePresentation, T3Appearance } from "@t3-factory/contracts";
import { oceanPresentation, memoryStorage } from "./support/inherited-colors.ts";

/** The source the cached Ocean snapshot came from, as its server declares it. */
const SOURCE = {
  environmentId: "environment-1",
  resolverPin: "d2c25950b4d9183ea342d5d5fc14c326b9e0172a",
};

const GROVE_SOURCE = { ...SOURCE, environmentId: "environment-2" };
/** One live delivery of a server that follows `presentation`. */
const following = (presentation: AppearancePresentation): T3Appearance => ({
  state: "following",
  explanation: "",
  presentation,
});

it("a client reopening on the same Factory server reuses both halves of its cached theme colors", () => {
  // Arrange
  const storage = memoryStorage();
  rememberColors(storage, "server-a", oceanPresentation());

  // Act
  const cached = cachedColors(storage, "server-a", SOURCE);

  // Assert
  expect(cached).toStrictEqual(oceanPresentation());
});

it("theme colors cached from one Factory server are not shown on another", () => {
  // Arrange
  const storage = memoryStorage();
  rememberColors(storage, "server-a", oceanPresentation());

  // Act
  const cached = cachedColors(storage, "server-b", SOURCE);

  // Assert
  expect(cached).toBe(null);
});

it.each([
  ["has no theme-color source any more", null],
  ["follows another T3 environment", { ...SOURCE, environmentId: "environment-2" }],
  ["resolves palettes at another pin", { ...SOURCE, resolverPin: "another-pin" }],
])("cached theme colors are not shown when the server %s", (_, source) => {
  // Arrange
  const storage = memoryStorage();
  rememberColors(storage, "server-a", oceanPresentation());

  // Act
  const cached = cachedColors(storage, "server-a", source);

  // Assert
  expect(cached).toBe(null);
});

it("a mounted client keeps the published theme colors when the server declares the same source again", () => {
  // Arrange
  const ocean = following(oceanPresentation());
  const shown = { declared: SOURCE, cached: null, published: ocean, refused: null };

  // Act
  const followed = followColors(shown, { ...SOURCE }, { value: ocean, synchronized: true });

  // Assert
  expect(followed.published).toBe(ocean);
});

it("a mounted client keeps its cached theme colors through an outage of the same source", () => {
  // Arrange
  const cached = oceanPresentation();
  const shown = { declared: SOURCE, cached, published: null, refused: null };

  // Act
  const followed = followColors(shown, { ...SOURCE }, { value: null, synchronized: false });

  // Assert
  expect(followed.cached).toBe(cached);
});

it.each([
  ["has no theme-color source any more", null],
  ["follows another T3 environment", { ...SOURCE, environmentId: "environment-2" }],
])(
  "a mounted client drops theme colors its live delivery still holds when the server %s",
  (_, source) => {
    // Arrange
    const ocean = following(oceanPresentation());
    const shown = {
      declared: SOURCE,
      cached: oceanPresentation(),
      published: ocean,
      refused: null,
    };

    // Act
    const followed = followColors(shown, source, { value: ocean, synchronized: true });

    // Assert
    expect(followed).toStrictEqual({
      declared: source,
      cached: null,
      published: null,
      refused: ocean,
    });
  },
);

it("theme colors dropped for a replaced source do not return while live delivery still holds them", () => {
  // Arrange
  const ocean = following(oceanPresentation());
  const live = { value: ocean, synchronized: true };
  const replaced = followColors(
    { declared: SOURCE, cached: null, published: ocean, refused: null },
    GROVE_SOURCE,
    live,
  );

  // Act
  const followed = followColors(replaced, GROVE_SOURCE, live);

  // Assert
  expect(followed.published).toBe(null);
});

it("a mounted client takes what the server publishes after its source was replaced", () => {
  // Arrange
  const ocean = following(oceanPresentation());
  const grove = following({
    ...oceanPresentation(),
    environmentId: GROVE_SOURCE.environmentId,
  });
  const replaced = followColors(
    { declared: SOURCE, cached: null, published: ocean, refused: null },
    GROVE_SOURCE,
    { value: ocean, synchronized: true },
  );

  // Act
  const followed = followColors(replaced, GROVE_SOURCE, { value: grove, synchronized: true });

  // Assert
  expect(followed.published).toBe(grove);
});

it("a cached snapshot whose colors were altered in storage is not applied", () => {
  // Arrange
  const storage = memoryStorage();
  rememberColors(storage, "server-a", oceanPresentation());
  const stored = storage.getItem("factory.inherited-colors");
  assert(stored);
  storage.setItem(
    "factory.inherited-colors",
    stored.replace("#17212b", "url(https://example.invalid/x)"),
  );

  // Act
  const cached = cachedColors(storage, "server-a", SOURCE);

  // Assert
  expect(cached).toBe(null);
});

it("the server ending inheritance removes the cached theme colors", () => {
  // Arrange
  const storage = memoryStorage();
  rememberColors(storage, "server-a", oceanPresentation());

  // Act
  forgetColors(storage);

  // Assert
  expect(cachedColors(storage, "server-a", SOURCE)).toBe(null);
  expect(storage.items.size).toBe(0);
});

it("the cache keeps one snapshot with both modes and no per-mode entries", () => {
  // Arrange
  const storage = memoryStorage();

  // Act
  rememberColors(storage, "server-a", oceanPresentation());

  // Assert
  expect([...storage.items.keys()]).toStrictEqual(["factory.inherited-colors"]);
});
