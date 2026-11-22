import { expect, it } from "vite-plus/test";
import {
  captureWindowBounds,
  restorableBounds,
  WindowBoundsTracker,
  type RevealableWindow,
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

function fakeWindow(initial: WindowBounds) {
  let normalBounds = initial;
  let destroyed = false;
  let minimized = false;
  let maximized = false;
  let fullScreen = false;
  let shows = 0;
  let restores = 0;
  const target: RevealableWindow = {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isFullScreen: () => fullScreen,
    isMaximized: () => maximized,
    getNormalBounds: () => normalBounds,
    maximize: () => {
      maximized = true;
    },
    restore: () => {
      minimized = false;
      restores += 1;
    },
    show: () => {
      shows += 1;
    },
  };
  return {
    target,
    resize: (bounds: WindowBounds) => {
      normalBounds = bounds;
    },
    minimize: () => {
      minimized = true;
    },
    destroy: () => {
      destroyed = true;
    },
    setFullScreen: (value: boolean) => {
      fullScreen = value;
    },
    shows: () => shows,
    restores: () => restores,
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

it("a window shown by a second activation before ready-to-show still captures resizes made before close or Quit", () => {
  // Arrange
  const tracker = new WindowBoundsTracker({ x: 120, y: 80, width: 1100, height: 700 });
  tracker.prepareOpen([builtInDisplay]);
  const win = fakeWindow({ x: 120, y: 80, width: 1100, height: 700 });
  tracker.reveal(win.target);
  win.resize({ x: 140, y: 60, width: 1280, height: 840 });

  // Act
  const captured = tracker.capture(win.target);

  // Assert
  expect(captured).toStrictEqual({ x: 140, y: 60, width: 1280, height: 840 });
});

it("a maximized window shown by an early activation is maximized immediately and ignored by a later ready-to-show", () => {
  // Arrange
  const tracker = new WindowBoundsTracker({
    x: 120,
    y: 80,
    width: 1100,
    height: 700,
    maximized: true,
  });
  tracker.prepareOpen([builtInDisplay]);
  const win = fakeWindow({ x: 120, y: 80, width: 1100, height: 700 });
  tracker.reveal(win.target);
  win.minimize();

  // Act
  const savedAfterReady = tracker.revealInitial(win.target);

  // Assert
  expect(savedAfterReady).toBe(false);
  expect(win.target.isMaximized()).toBe(true);
  expect(win.target.isMinimized()).toBe(true);
  expect(win.shows()).toBe(1);
});

it("minimizing a fallback window after disconnecting its previous display preserves the fallback bounds instead of the disconnected display's state", () => {
  // Arrange
  const onDisconnectedDisplay: WindowBounds = {
    x: 1800,
    y: 100,
    width: 1200,
    height: 800,
    fullScreen: true,
  };
  const tracker = new WindowBoundsTracker(onDisconnectedDisplay);
  const restored = tracker.prepareOpen([builtInDisplay]);
  const fallback = fakeWindow({ x: 56, y: 40, width: 1400, height: 900 });
  const savedOnReveal = tracker.revealInitial(fallback.target);
  fallback.minimize();

  // Act
  const capturedOnClose = tracker.capture(fallback.target);

  // Assert
  expect(restored).toBeNull();
  expect(savedOnReveal).toBe(true);
  expect(capturedOnClose).toStrictEqual({ x: 56, y: 40, width: 1400, height: 900 });
});

it("quitting before a fallback window is shown clears the disconnected display's obsolete bounds", () => {
  // Arrange
  const tracker = new WindowBoundsTracker({
    x: 1800,
    y: 100,
    width: 1200,
    height: 800,
    maximized: true,
  });
  tracker.prepareOpen([builtInDisplay]);
  const fallback = fakeWindow({ x: 56, y: 40, width: 1400, height: 900 });

  // Act
  const capturedOnQuit = tracker.capture(fallback.target);

  // Assert
  expect(capturedOnQuit).toBeNull();
});
