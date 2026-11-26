import { expect, it, vi } from "vite-plus/test";
import { api, ApiError } from "../src/api.ts";
import { installReportingHomes } from "../src/reporting-install.ts";

it("install all keeps successful and refused home attempts in the selected order", async () => {
  // Arrange
  const installed = {
    id: "first",
    provider: "codex",
    kind: "instance",
    instances: [],
    path: null,
    skillsPath: null,
    status: "installed",
    message: "",
    launchSkill: "current",
    runtimeEvidence: "UNVERIFIED",
    actions: { install: false, repair: false, reinstall: true },
  } as const;
  using request = vi
    .spyOn(api, "installReporting")
    .mockResolvedValueOnce({ ...installed, diagnosticAttempts: ["first-attempt"] })
    .mockRejectedValueOnce(
      new ApiError({
        code: "validation",
        message: "Refused",
        issues: [],
        diagnosticAttempts: ["refused-attempt"],
      }),
    )
    .mockResolvedValueOnce({ ...installed, id: "last", diagnosticAttempts: ["last-attempt"] });

  // Act
  const attempts = await installReportingHomes(["first", "refused", "last"], {
    running: vi.fn(),
    installed: vi.fn(),
    failed: vi.fn(),
  });

  // Assert
  expect(request.mock.calls).toEqual([
    [{ targetId: "first" }],
    [{ targetId: "refused" }],
    [{ targetId: "last" }],
  ]);
  expect(attempts).toEqual(["first-attempt", "refused-attempt", "last-attempt"]);
});
