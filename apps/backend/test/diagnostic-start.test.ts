import { assert, expect, it } from "@effect/vitest";
import { preparedServer } from "./support/prepared-runner.ts";

it("a rejected Start exports its failed readiness verdict under the Start tag", async (c) => {
  // Arrange
  const { f, mcp, input } = await preparedServer(c);
  assert((await f.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const rejected = await fetch(new URL("/api/runs", mcp), {
    method: "POST",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: JSON.stringify({
      ...input,
      projectId: "private-project-canary",
      input: "private-prompt-canary",
    }),
  });

  // Assert
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({
    ok: false,
    error: { startReadinessRejected: true, issues: [{ code: "project_connection" }] },
  });
  const exported = await fetch(new URL("/api/settings/diagnostics/export", mcp));
  expect(exported.status).toBe(200);
  const log = await exported.text();
  expect(log).toMatch(
    /### Start · .* UTC · failed[\s\S]*fail  Start readiness  project_connection/,
  );
  expect(log).not.toContain("Start preflight");
  expect(log).not.toContain("private-");
});

it("a rejected preflight exports its verdict under the preflight tag", async (c) => {
  // Arrange
  const { f, mcp, input } = await preparedServer(c);
  assert((await f.setDiagnosticRecording({ enabled: true })).ok);

  // Act
  const rejected = await f.checkStart(input.projectId, "private-flow-canary");

  // Assert
  expect(rejected).toMatchObject({ ok: false, error: { code: "not_found" } });
  const exported = await fetch(new URL("/api/settings/diagnostics/export", mcp));
  expect(exported.status).toBe(200);
  const log = await exported.text();
  expect(log).toMatch(
    /### Start preflight · .* UTC · failed[\s\S]*fail  Start readiness  flow_unavailable/,
  );
  expect(log).not.toContain("### Start ·");
  expect(log).not.toContain("private-flow-canary");
});
