import { expect, it } from "vite-plus/test";
import { menuLabel } from "../src/menu-label.ts";

const width = (text: string) => text.length;

it("a menu name that fits is shown in full", () => {
  // Arrange
  const name = "Northwind release";

  // Act
  const label = menuLabel(name, [name, "Atlas demo"], 40, width);

  // Assert
  expect(label).toBe("Northwind release");
});

it("a long menu name truncates at the end when no other name would look the same", () => {
  // Arrange
  const name = "Northwind release checklist";

  // Act
  const label = menuLabel(name, [name], 12, width);

  // Assert
  expect(label).toBe("Northwind r…");
});

it("menu names that would truncate to the same text keep the ending that tells them apart", () => {
  // Arrange
  const quarterly = "Shared prefix ONE";
  const annual = "Shared prefix TWO";
  const peers = [quarterly, annual];

  // Act
  const labels = peers.map((name) => menuLabel(name, peers, 12, width));

  // Assert
  expect(labels).toStrictEqual(["Shared pre…E", "Shared pre…O"]);
});
