import assert from "node:assert/strict";
import { test } from "node:test";
import { findBetaValidation } from "./find-beta-validation.mjs";

const repository = "owner/factory";
const sha = "a".repeat(40);
const head = "b".repeat(40);
const tested = "c".repeat(40);
const actions = `repos/${repository}/actions`;
const qualityUrl = "https://github.com/owner/factory/actions/runs/1";
const prQualityUrl = "https://github.com/owner/factory/actions/runs/3";
const journeysUrl = "https://github.com/owner/factory/actions/runs/2";

function validationInput({
  testedTree = "same-tree",
  markerConclusion = "success",
  qualityConclusion = "success",
  prQualityRuns = [],
  prQualityMarker = `Full quality gate passed on ${tested}`,
} = {}) {
  const commits = `repos/${repository}/commits`;
  const responses = {
    [`${commits}/${sha}`]: { commit: { tree: { sha: "same-tree" } } },
    [`${commits}/${tested}`]: { commit: { tree: { sha: testedTree } } },
    [`${commits}/${sha}/pulls`]: [
      {
        merged_at: "2026-11-20",
        base: { ref: "main" },
        merge_commit_sha: sha,
        head: { sha: head },
      },
    ],
    [`${actions}/workflows/quality.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=1`]: {
      workflow_runs: [{ conclusion: qualityConclusion, html_url: qualityUrl }],
    },
    [`${actions}/workflows/quality.yml/runs?event=pull_request&head_sha=${head}&per_page=10`]: {
      workflow_runs: prQualityRuns,
    },
    [`${actions}/runs/3/jobs?filter=latest`]: {
      jobs: [
        {
          name: "Quality gate",
          conclusion: "success",
          steps: prQualityMarker ? [{ name: prQualityMarker, conclusion: "success" }] : [],
        },
      ],
    },
    [`${actions}/workflows/ui-journeys.yml/runs?event=pull_request&head_sha=${head}&per_page=1`]: {
      workflow_runs: [{ id: 2, conclusion: "success", html_url: journeysUrl }],
    },
    [`${actions}/runs/2/jobs?filter=latest`]: {
      jobs: [
        {
          name: "Controlled UI journeys",
          conclusion: "success",
          steps: [{ name: `Full UI suite passed on ${tested}`, conclusion: markerConclusion }],
        },
      ],
    },
  };
  return {
    repository,
    sha,
    async read(path) {
      assert.ok(Object.hasOwn(responses, path), `Unexpected GitHub API path ${path}`);
      return responses[path];
    },
  };
}

await test("Beta reuses a full suite run on the same tree under a different commit", async () => {
  // Arrange
  const input = validationInput();

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: qualityUrl, journeys: journeysUrl });
});

await test("Beta requires fresh journeys when the passed PR suite tested a different tree", async () => {
  // Arrange
  const input = validationInput({ testedTree: "old-tree" });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: qualityUrl, journeys: undefined });
});

await test("Beta requires fresh journeys when a successful PR check skipped the suite", async () => {
  // Arrange
  const input = validationInput({ markerConclusion: "skipped" });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: qualityUrl, journeys: undefined });
});

await test("Beta requires a fresh quality gate while the main push gate is pending", async () => {
  // Arrange
  const input = validationInput({ qualityConclusion: null });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: undefined, journeys: journeysUrl });
});

await test("Beta reuses a passing PR quality gate on the same tree while main push is pending", async () => {
  // Arrange
  const input = validationInput({
    qualityConclusion: null,
    prQualityRuns: [
      { id: 99, display_title: "Reuse code gate for PR 1", conclusion: "success", html_url: "x" },
      {
        id: 3,
        display_title: "Full code gate for PR 1",
        conclusion: "success",
        html_url: prQualityUrl,
      },
    ],
  });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: prQualityUrl, journeys: journeysUrl });
});

await test("Beta requires a fresh quality gate when the PR quality gate tested a different tree", async () => {
  // Arrange
  const input = validationInput({
    qualityConclusion: null,
    testedTree: "old-tree",
    prQualityRuns: [
      {
        id: 3,
        display_title: "Full code gate for PR 1",
        conclusion: "success",
        html_url: prQualityUrl,
      },
    ],
  });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: undefined, journeys: undefined });
});

await test("Beta rejects a PR quality gate without a full-gate marker step", async () => {
  // Arrange
  const input = validationInput({
    qualityConclusion: null,
    prQualityMarker: null,
    prQualityRuns: [
      {
        id: 3,
        display_title: "Full code gate for PR 1",
        conclusion: "success",
        html_url: prQualityUrl,
      },
    ],
  });

  // Act
  const validation = await findBetaValidation(input);

  // Assert
  assert.deepEqual(validation, { quality: undefined, journeys: journeysUrl });
});
