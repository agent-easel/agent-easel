import { assert, expect, it } from "@effect/vitest";
import type { TriggerPreview } from "@t3-factory/contracts";
import { triggerChecked, triggerSaved } from "./support/scenarios.ts";
import {
  atlasRepository,
  checkingWorld,
  otherProjectWatcher,
  reviewingWorld,
  startedIssues,
  triggerEdit,
  triggerWorld,
} from "./support/triggers.ts";

const admissions = (preview: TriggerPreview) =>
  preview.issues.map((issue) => [issue.number, issue.admission]);

it("previewing a Trigger before enabling it lists its ready issues oldest first, marks those within the limit as starting now and starts nothing", async (c) => {
  // Arrange
  const world = await reviewingWorld(c, { maxActiveRuns: 2 });
  world.readyIssue(7, "Newest", "2026-11-12T09:00:00.000Z");
  world.readyIssue(5, "Same time, higher number", "2026-11-10T09:00:00.000Z");
  world.readyIssue(4, "Same time, lower number", "2026-11-10T09:00:00.000Z");

  // Act
  const preview = await world.f.previewTrigger(world.trigger.id, triggerEdit(world.trigger, {}));

  // Assert
  assert(preview.ok);
  expect(admissions(preview.value)).toStrictEqual([
    [4, "starts_now"],
    [5, "starts_now"],
    [7, "waits"],
  ]);
  expect(preview.value.issues[0]).toMatchObject({
    issue: "factory-maintainer/atlas#4",
    title: "Same time, lower number",
    url: "https://github.com/factory-maintainer/atlas/issues/4",
  });
  expect(preview.value).toMatchObject({
    problem: null,
    warnings: [],
    login: "factory-maintainer",
    revision: 1,
  });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
  expect(await world.f.getTrigger(world.trigger.id)).toStrictEqual({
    ok: true,
    value: world.trigger,
  });
});

it("a preview counts the Trigger's active Runs against the limit and leaves out issues it already started", async (c) => {
  // Arrange
  const world = await checkingWorld(c, { maxActiveRuns: 2 });
  world.readyIssue(1, "Started", "2026-11-09T09:00:00.000Z");
  const checked = await triggerChecked(world.f, world.trigger.id);
  world.readyIssue(2, "Fits the last slot", "2026-11-10T09:00:00.000Z");
  world.readyIssue(3, "Waits", "2026-11-11T09:00:00.000Z");

  // Act
  const preview = await world.f.previewTrigger(world.trigger.id, triggerEdit(checked, {}));

  // Assert
  assert(preview.ok);
  expect(admissions(preview.value)).toStrictEqual([
    [2, "starts_now"],
    [3, "waits"],
  ]);
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([1]);
});

it("a preview of a raised limit admits as the edit would, while the saved limit stays", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.readyIssue(1, "First", "2026-11-09T09:00:00.000Z");
  world.readyIssue(2, "Second", "2026-11-10T09:00:00.000Z");

  // Act
  const preview = await world.f.previewTrigger(
    world.trigger.id,
    triggerEdit(world.trigger, { maxActiveRuns: 2 }),
  );

  // Assert
  assert(preview.ok);
  expect(admissions(preview.value)).toStrictEqual([
    [1, "starts_now"],
    [2, "starts_now"],
  ]);
  expect(preview.value.revision).toBeNull();
  const saved = await world.f.getTrigger(world.trigger.id);
  assert(saved.ok);
  expect(saved.value.maxActiveRuns).toBe(1);
});

it("previewing a new Trigger on a public repository without an author filter carries the author-filter notice and saves nothing", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c, { ...atlasRepository, visibility: "public" });

  // Act
  const preview = await f.previewNewTrigger({
    ...triggerInput,
    github: { ...triggerInput.github, query: "label:factory:ready" },
  });

  // Assert
  assert(preview.ok);
  expect(preview.value.warnings.map((warning) => warning.code)).toStrictEqual([
    "trigger_author_filter_removed",
  ]);
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [] });
});

it("previewing a new Trigger warns that a disabled Trigger of another Project watches the same repository", async (c) => {
  // Arrange
  const world = await triggerWorld(c);
  await otherProjectWatcher(world, "Other Project watcher");

  // Act
  const preview = await world.f.previewNewTrigger(world.triggerInput);

  // Assert
  assert(preview.ok);
  expect(preview.value.warnings).toStrictEqual([
    {
      code: "trigger_repository_shared",
      path: "projectId",
      message:
        "Trigger Other Project watcher already watches factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
    },
  ]);
});

it("previewing an edit warns about every other Trigger on the repository and never about the edited one", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  await otherProjectWatcher(world, "Docs issues");

  // Act
  const preview = await world.f.previewTrigger(world.trigger.id, triggerEdit(world.trigger, {}));

  // Assert
  assert(preview.ok);
  expect(preview.value.warnings.map((warning) => warning.message)).toStrictEqual([
    "Trigger Docs issues already watches factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
  ]);
});

it("a preview names several other Triggers on the repository in one warning", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  await otherProjectWatcher(world, "Docs issues");
  await triggerSaved(world.f, { ...world.triggerInput, name: "Bug issues" });

  // Act
  const preview = await world.f.previewNewTrigger({ ...world.triggerInput, name: "Third" });

  // Assert
  assert(preview.ok);
  expect(preview.value.warnings.map((warning) => warning.message)).toStrictEqual([
    "Triggers Bug issues, Docs issues, Ready issues already watch factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
  ]);
});

it("a preview while T3 cannot launch reports the check's problem and starts no issue now", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.readyIssue(1, "Would start");
  world.t3.contract.support.launch = false;

  // Act
  const preview = await world.f.previewTrigger(world.trigger.id, triggerEdit(world.trigger, {}));

  // Assert
  assert(preview.ok);
  expect(preview.value).toMatchObject({
    issues: [],
    problem: {
      code: "start_blocked",
      message: expect.stringContaining("T3 launch contract is unsupported."),
    },
  });
});

it("a preview that cannot read GitHub reports the check's problem and leaves the Trigger without an Error", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.readyIssue(1, "Unread");
  world.github.signedIn = false;

  // Act
  const preview = await world.f.previewTrigger(world.trigger.id, triggerEdit(world.trigger, {}));

  // Assert
  assert(preview.ok);
  expect(preview.value).toMatchObject({
    issues: [],
    problem: { code: "github_signed_out" },
    login: null,
  });
  const saved = await world.f.getTrigger(world.trigger.id);
  assert(saved.ok);
  expect(saved.value.error).toBeNull();
});
