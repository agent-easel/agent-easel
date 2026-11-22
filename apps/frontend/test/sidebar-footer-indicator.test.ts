import { expect, it } from "vite-plus/test";
import { sidebarFooterIndicator } from "../src/sidebar-footer-indicator.ts";

const reportingWarning = {
  state: "attention",
  label: "Agent reporting needs attention",
  message: "Agent reporting needs attention",
  launchSkill: null,
} as const;

it("Factory Offline wins over a lost T3 connection and a reporting warning", () => {
  // Arrange
  const state = {
    factory: { kind: "offline", observedAt: Date.UTC(2026, 10, 22, 15, 53, 48) },
    presentation: "unavailable",
    reporting: reportingWarning,
    configured: true,
  } as const;

  // Act
  const indicator = sidebarFooterIndicator(state);

  // Assert
  expect(indicator).toMatchObject({
    label: "Offline",
    status: true,
    tone: "error",
    tab: "connection",
  });
  expect(indicator.text).toMatch(/^Offline · last observed \d{2}:\d{2}:\d{2}$/);
});

it("the Offline text without an observation time is Offline", () => {
  // Arrange
  const state = {
    factory: { kind: "offline", observedAt: null },
    presentation: "ready",
    reporting: { state: "installed", label: "", message: "", launchSkill: null },
    configured: true,
  } as const;

  // Act
  const indicator = sidebarFooterIndicator(state);

  // Assert
  expect(indicator.text).toBe("Offline");
});
