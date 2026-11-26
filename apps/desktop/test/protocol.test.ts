import { expect, it } from "vite-plus/test";
import { allowsUiPermission } from "../src/protocol.ts";

it("allows sanitized clipboard writes from the bundled app origin in the main frame", () => {
  // Arrange
  const permission = "clipboard-sanitized-write";

  // Act
  const allowed = allowsUiPermission(permission, "factory://app/", true);

  // Assert
  expect(allowed).toBe(true);
});

it("allows sanitized clipboard writes from a bundled app route in the main frame", () => {
  // Arrange
  const permission = "clipboard-sanitized-write";

  // Act
  const allowed = allowsUiPermission(permission, "factory://app/runs/run-1", true);

  // Assert
  expect(allowed).toBe(true);
});

it("denies clipboard reads even from the bundled app main frame", () => {
  // Arrange
  const permission = "clipboard-read";

  // Act
  const allowed = allowsUiPermission(permission, "factory://app/", true);

  // Assert
  expect(allowed).toBe(false);
});

it("denies non-clipboard permissions from the bundled app main frame", () => {
  // Arrange
  const permission = "notifications";

  // Act
  const allowed = allowsUiPermission(permission, "factory://app/", true);

  // Assert
  expect(allowed).toBe(false);
});

it("denies sanitized clipboard writes from a non-main frame", () => {
  // Arrange
  const permission = "clipboard-sanitized-write";

  // Act
  const allowed = allowsUiPermission(permission, "factory://app/", false);

  // Assert
  expect(allowed).toBe(false);
});

it.each([
  { name: "another scheme and host", url: "https://example.com/" },
  { name: "a host that starts with app", url: "factory://app.example/" },
  { name: "a non-empty port", url: "factory://app:8080/" },
  { name: "embedded credentials", url: "factory://user@app/" },
  { name: "a malformed URL", url: "not a url" },
])("denies sanitized clipboard writes from $name", ({ url }) => {
  // Arrange
  const permission = "clipboard-sanitized-write";

  // Act
  const allowed = allowsUiPermission(permission, url, true);

  // Assert
  expect(allowed).toBe(false);
});
