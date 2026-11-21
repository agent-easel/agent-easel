import { expect, it } from "vite-plus/test";
import { restorableBounds } from "../src/window-bounds.ts";

const builtInDisplay = { x: 0, y: 25, width: 1512, height: 920 };

it("a window left on a display that is no longer connected opens at the default size instead of off-screen", () => {
  // Arrange
  const onDisconnectedDisplay = { x: 1800, y: 100, width: 1200, height: 800 };

  // Act
  const restored = restorableBounds(onDisconnectedDisplay, [builtInDisplay]);

  // Assert
  expect(restored).toBeNull();
});
