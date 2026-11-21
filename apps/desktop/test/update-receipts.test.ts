import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, vi } from "vite-plus/test";
import { stageUpdate, reportClientUpdates } from "../src/update-receipts.ts";

it("the installed desktop retries its verified receipt with the original host after an offline upgrade", async (context) => {
  // Arrange
  const profile = await mkdtemp(join(tmpdir(), "factory-update-"));
  context.onTestFinished(() => rm(profile, { recursive: true, force: true }));
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ status: 200 });
  const connection = { request };
  await stageUpdate(profile, "selected host", "1.0.0-beta.1", "1.0.0");
  await reportClientUpdates(profile, "selected host", "1.0.0-beta.1", connection);
  await reportClientUpdates(profile, "different host", "1.0.0", connection);
  expect(request).not.toHaveBeenCalled();
  await expect(reportClientUpdates(profile, "selected host", "1.0.0", connection)).rejects.toThrow(
    "offline",
  );

  // Act
  await reportClientUpdates(profile, "selected host", "1.0.1", connection);
  await reportClientUpdates(profile, "selected host", "1.0.1", connection);

  // Assert
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  expect(JSON.parse(request.mock.calls[1]![3].toString())).toEqual({
    receiptId: expect.any(String),
    fromVersion: "1.0.0-beta.1",
    toVersion: "1.0.0",
  });
});
