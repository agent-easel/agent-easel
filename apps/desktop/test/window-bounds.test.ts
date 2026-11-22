import { expect, it } from "vite-plus/test";
import {
  captureWindowBounds,
  restorableBounds,
  type WindowBounds,
  type WindowBoundsSnapshot,
} from "../src/window-bounds.ts";

const builtInDisplay = { x: 0, y: 25, width: 1512, height: 920 };

function windowSnapshot(
  normalBounds: WindowBounds,
  state: {
    readonly destroyed?: boolean;
    readonly minimized?: boolean;
    readonly maximized?: boolean;
    readonly fullScreen?: boolean;
  } = {},
): WindowBoundsSnapshot {
  return {
    isDestroyed: () => state.destroyed === true,
    isMinimized: () => state.minimized === true,
    isFullScreen: () => state.fullScreen === true,
    isMaximized: () => state.maximized === true,
    getNormalBounds: () => normalBounds,
  };
}

it("a window left on a display that is no longer connected opens at the default size instead of off-screen", () => {
  // Arrange
  const onDisconnectedDisplay = { x: 1800, y: 100, width: 1200, height: 800 };

  // Act
  const restored = restorableBounds(onDisconnectedDisplay, [builtInDisplay]);

  // Assert
  expect(restored).toBeNull();
});

it("a maximized window remembers its maximized state alongside its normal bounds", () => {
  // Arrange
  const target = windowSnapshot({ x: 120, y: 80, width: 1100, height: 700 }, { maximized: true });

  // Act
  const captured = captureWindowBounds(target, null);

  // Assert
  expect(captured).toStrictEqual({ x: 120, y: 80, width: 1100, height: 700, maximized: true });
});

it("a full-screen window remembers its full-screen state alongside its normal bounds", () => {
  // Arrange
  const target = windowSnapshot(
    { x: 150, y: 90, width: 1150, height: 720 },
    { fullScreen: true, maximized: true },
  );

  // Act
  const captured = captureWindowBounds(target, null);

  // Assert
  expect(captured).toStrictEqual({ x: 150, y: 90, width: 1150, height: 720, fullScreen: true });
});

it("a minimized window keeps the previously remembered bounds and maximized state", () => {
  // Arrange
  const previous: WindowBounds = { x: 120, y: 80, width: 1100, height: 700, maximized: true };
  const target = windowSnapshot({ x: 0, y: 30, width: 1512, height: 920 }, { minimized: true });

  // Act
  const captured = captureWindowBounds(target, previous);

  // Assert
  expect(captured).toStrictEqual(previous);
});
