import assert from "node:assert/strict";
import test from "node:test";
import { selectAffectedJourneys, shouldRunUiJourneys } from "./select-ui-journeys.mjs";

await test("documentation and review-only changes skip journeys", () => {
  // Arrange
  const paths = [
    "docs/testing.md",
    "docs/agents/domain.md",
    "README.md",
    "CONTRIBUTING.md",
    "GLOSSARY.md",
    "AGENTS.md",
    "LICENSE",
    ".github/pull_request_template.md",
    "sentinel.config.yaml",
    ".agents/rules/tests.md",
  ];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, false);
});

await test("frontend changes run journeys", () => {
  // Arrange
  const paths = ["apps/frontend/src/main.tsx"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("backend changes run journeys", () => {
  // Arrange
  const paths = ["apps/backend/src/server.ts"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("workflow changes run journeys", () => {
  // Arrange
  const paths = [".github/workflows/ui-journeys.yml"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("unknown paths run journeys", () => {
  // Arrange
  const paths = ["new-tool.txt"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("a source file renamed into docs still runs journeys", () => {
  // Arrange
  const paths = ["apps/frontend/src/old.ts", "docs/old.md"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("an empty diff runs journeys", () => {
  // Arrange
  const paths = [];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("scripts under docs run journeys", () => {
  // Arrange
  const paths = ["docs/generate.mjs"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("verification skill changes run journeys", () => {
  // Arrange
  const paths = [".agents/skills/verify-agenteasel/SKILL.md"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("shared contract changes run journeys", () => {
  // Arrange
  const paths = ["packages/contracts/src/index.ts"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("dependency changes run journeys", () => {
  // Arrange
  const paths = ["pnpm-lock.yaml"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("landing source changes run journeys", () => {
  // Arrange
  const paths = ["apps/landing/src/styles.css"];

  // Act
  const run = shouldRunUiJourneys(paths);

  // Assert
  assert.equal(run, true);
});

await test("local selection combines mapped features and modified specs once", () => {
  // Arrange
  const specs = new Set([
    "tests/canvas-viewport.e2e.ts",
    "tests/keyboard-shortcuts.e2e.ts",
    "tests/smoke.e2e.ts",
    "tests/new-name.e2e.ts",
  ]);
  const paths = [
    "apps/frontend/src/components/keyboard-settings.tsx",
    "tests/keyboard-shortcuts.e2e.ts",
    "tests/new-name.e2e.ts",
    "tests/old-name.e2e.ts",
    "docs/testing.md",
  ];

  // Act
  const selected = selectAffectedJourneys(paths, specs);

  // Assert
  assert.deepEqual(selected, [
    "tests/canvas-viewport.e2e.ts",
    "tests/keyboard-shortcuts.e2e.ts",
    "tests/new-name.e2e.ts",
  ]);
});

await test("local selection skips a diff limited to documentation and unit tests", () => {
  // Arrange
  const paths = ["docs/testing.md", "apps/backend/test/flows.test.ts"];

  // Act
  const selected = selectAffectedJourneys(paths, new Set(["tests/smoke.e2e.ts"]));

  // Assert
  assert.deepEqual(selected, []);
});

for (const path of [
  "tests/support/fixture/projects.ts",
  "e2e.config.ts",
  "scripts/dev/seed-flows.ts",
  "apps/backend/test/support/controlled-t3.ts",
  "apps/frontend/src/components/ui/button.tsx",
]) {
  await test(`local selection runs the full suite for ${path}`, () => {
    // Arrange
    const spec = "tests/smoke.e2e.ts";

    // Act
    const selected = selectAffectedJourneys([spec, path], new Set([spec]));

    // Assert
    assert.equal(selected, null);
  });
}

await test("a mapped feature runs the full suite when its spec mapping is stale", () => {
  // Arrange
  const paths = ["apps/frontend/src/components/keyboard-settings.tsx"];

  // Act
  const selected = selectAffectedJourneys(paths, new Set(["tests/canvas-viewport.e2e.ts"]));

  // Assert
  assert.equal(selected, null);
});
