import { held } from "./support/flow-draft.ts";
import type { AgentDefinition } from "@t3-factory/contracts";
import { expect, it, vi } from "vite-plus/test";
import { ApiError } from "../src/api.ts";
import { OfflineError } from "../src/transport.ts";
import { savedAgent } from "./support/agent-draft.ts";
import {
  agentDraft,
  comparedAgent,
  createdAgent,
  deliver,
  echoed,
  editedAgent,
  failedDelete,
  pendingSave,
  removedElsewhere,
  savedElsewhere,
} from "./support/agent-editor.ts";

it("editing the Agent's name leaves unsaved changes", () => {
  // Arrange
  const { draft } = agentDraft();

  // Act
  draft.edit({ name: "Changed" });

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ content: { name: "Changed" }, dirty: true });
});

it("editing the Agent's prompt leaves unsaved changes", () => {
  // Arrange
  const { draft } = agentDraft();

  // Act
  draft.edit({ prompt: "New instructions" });

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { prompt: "New instructions" },
    dirty: true,
  });
});

it("editing the Agent's exits leaves unsaved changes", () => {
  // Arrange
  const { draft } = agentDraft();

  // Act
  draft.edit({
    exits: [{ id: "done", name: "reviewed", description: "Ready", messageRequired: true }],
  });

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: {
      exits: [{ id: "done", name: "reviewed", description: "Ready", messageRequired: true }],
    },
    dirty: true,
  });
});

it("restoring the saved field values clears unsaved changes", () => {
  // Arrange
  const execution = {
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "first",
    modelOptions: [],
  };
  const agent = savedAgent({ execution });
  const { draft } = agentDraft(agent);
  draft.edit({ name: "Changed", prompt: "New instructions", exits: [] });
  draft.setEnvironmentId("another-machine");

  // Act
  draft.edit({ name: agent.name, prompt: agent.prompt, exits: agent.exits, execution });

  // Assert
  expect(draft.getSnapshot().dirty).toBe(false);
});

it("content equal to the saved revision in another key order has no unsaved changes", () => {
  // Arrange
  const { draft } = agentDraft();

  // Act
  draft.edit({
    execution: {
      modelOptions: [
        { value: "low", id: "effort" },
        { value: true, id: "old" },
      ],
      modelId: "first",
      providerInstanceId: "primary",
      environmentId: "local",
    },
  });

  // Assert
  expect(draft.getSnapshot().dirty).toBe(false);
});

it("an accepted save sends the expected revision and adopts the saved Agent as a clean baseline", async () => {
  // Arrange
  const { draft, factory } = editedAgent();

  // Act
  const saved = await draft.save();

  // Assert
  expect(factory.updateAgent).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({
      name: "Edited",
      expectedRevision: 3,
    }),
  );
  expect(saved).toStrictEqual(factory.latest());
  expect(draft.getSnapshot()).toMatchObject({
    saved: { name: "Edited", revision: 4 },
    content: { name: "Edited" },
    dirty: false,
    saving: false,
    error: "",
  });
});

it("an accepted create adopts the new Agent identity and revision", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });

  // Act
  const saved = await draft.save();

  // Assert
  expect(factory.createAgent).toHaveBeenCalledWith(
    expect.objectContaining({ name: "New reviewer" }),
  );
  expect(factory.updateAgent).not.toHaveBeenCalled();
  expect(saved).toMatchObject({ id: "created", revision: 1 });
  expect(draft.getSnapshot()).toMatchObject({ saved, dirty: false });
});

it("a stale save keeps edits unsaved and blocks saving until the newer revision is resolved", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  factory.saveElsewhere({ name: "Saved elsewhere" });

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Edited" },
    dirty: true,
    error: "Saved elsewhere.",
    conflict: { status: "detected", revision: null },
    canSave: false,
    saving: false,
  });
});

it("a failure mentioning a newer revision without a conflict code does not raise a stale-save notice", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  factory.updateAgent.mockRejectedValueOnce(new Error("Could not read a newer revision."));

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    dirty: true,
    error: "Could not read a newer revision.",
    conflict: { status: "none" },
  });
});

it("an accepted delete leaves no unsaved changes", async () => {
  // Arrange
  const { draft, factory } = editedAgent();

  // Act
  const deleted = await draft.remove();

  // Assert
  expect(deleted).toBe(true);
  expect(factory.removeAgent).toHaveBeenCalledWith("agent");
  expect(draft.getSnapshot()).toMatchObject({ dirty: false, removing: false, removalError: "" });
});

it("a rejected delete keeps the draft unsaved and its failure separate from the save error", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  factory.updateAgent.mockRejectedValueOnce(new Error("Save unavailable."));
  await draft.save();
  factory.removeAgent.mockRejectedValueOnce(new Error("Agent is still used by a Flow."));

  // Act
  const deleted = await draft.remove();

  // Assert
  expect(deleted).toBe(false);
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    removing: false,
    error: "Save unavailable.",
    removalError: "Agent is still used by a Flow.",
  });
});

it("opening Delete again clears only its previous failure", async () => {
  // Arrange
  const { draft } = await failedDelete();

  // Act
  draft.clearRemovalError();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    removalError: "",
    error: "Save unavailable.",
    dirty: true,
  });
});

it("an edit notifies the unsaved-change guard synchronously", () => {
  // Arrange
  const { draft } = agentDraft();
  const guard = vi.fn(() => draft.getSnapshot().dirty);
  draft.subscribe(guard);

  // Act
  draft.edit({ name: "Edited" });

  // Assert
  expect(guard).toHaveLastReturnedWith(true);
});

it("a save completing after disposal cannot notify the former guard", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  const response = held(factory.updateAgent);
  const guard = vi.fn();
  const unsubscribe = draft.subscribe(guard);
  const saving = draft.save();
  unsubscribe();
  guard.mockClear();

  // Act
  response.answer(savedAgent({ revision: 4, name: "Edited" }));
  await saving;

  // Assert
  expect(guard).not.toHaveBeenCalled();
  expect(draft.getSnapshot()).toMatchObject({ dirty: false, saved: { revision: 4 } });
});

it("a clean editor adopts a revision saved elsewhere and says which revision it was updated to", () => {
  // Arrange
  const setup = agentDraft();

  // Act
  savedElsewhere(setup, { name: "Saved elsewhere" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Saved elsewhere" },
    content: { name: "Saved elsewhere" },
    dirty: false,
    updatedTo: 4,
    conflict: { status: "none" },
  });
});

it("a dirty editor keeps its draft and baseline and names the revision saved elsewhere", () => {
  // Arrange
  const setup = editedAgent();

  // Act
  savedElsewhere(setup, { name: "Saved elsewhere" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Edited" },
    dirty: true,
    conflict: { status: "detected", revision: 4 },
    updatedTo: null,
    canSave: false,
  });
});

it("a newer revision saved elsewhere replaces the revision a dirty editor names", () => {
  // Arrange
  const setup = editedAgent();
  savedElsewhere(setup, { name: "Revision 4" });

  // Act
  savedElsewhere(setup, { name: "Revision 5" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    conflict: { status: "detected", revision: 5 },
  });
});

it("a delivery of the saved revision with new settings status keeps the draft and names no revision", () => {
  // Arrange
  const setup = editedAgent();
  const agent = savedAgent();
  const unavailable: AgentDefinition = {
    ...agent,
    execution: agent.execution!,
    settingsStatus: {
      environment: { state: "available" },
      provider: { state: "unavailable" },
      model: { state: "available" },
      options: [],
    },
  };

  // Act
  deliver(setup, [unavailable]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: unavailable,
    content: { name: "Edited" },
    dirty: true,
    conflict: { status: "none" },
    updatedTo: null,
  });
});

it("a stale save is compared with the newer revision once Studio delivers it", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.saveElsewhere({ name: "Saved elsewhere" });
  await setup.draft.save();
  setup.draft.compare();

  // Act
  echoed(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    conflict: { status: "compared", latest: { revision: 4, name: "Saved elsewhere" } },
    error: "",
  });
});

it("keeping the edits against the newer revision rebinds the baseline, stays dirty and sends no save", () => {
  // Arrange
  const { draft, factory } = comparedAgent();

  // Act
  draft.keepEdits(4);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Saved elsewhere" },
    content: { name: "Edited" },
    dirty: true,
    conflict: { status: "none" },
    canSave: true,
  });
  expect(factory.updateAgent).not.toHaveBeenCalled();
});

it("a stale save kept against the newer revision saves against that revision", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.saveElsewhere({ name: "Saved elsewhere" });
  await setup.draft.save();
  echoed(setup);
  setup.draft.compare();
  setup.draft.keepEdits(4);

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.factory.updateAgent).toHaveBeenLastCalledWith(
    "agent",
    expect.objectContaining({ name: "Edited", expectedRevision: 4 }),
  );
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 5, name: "Edited" },
    dirty: false,
    conflict: { status: "none" },
    error: "",
  });
});

it("keeping the edits against a revision that is no longer the newest changes nothing", () => {
  // Arrange
  const setup = comparedAgent();
  savedElsewhere(setup, { name: "Revision 5" });

  // Act
  setup.draft.keepEdits(4);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    conflict: { status: "compared", latest: { revision: 5 } },
  });
});

it("an own save delivered before its reply is acknowledged without a saved-elsewhere notice", async () => {
  // Arrange
  const setup = editedAgent();
  const { reply, saving } = pendingSave(setup);
  const own = savedAgent({ name: "Edited", revision: 4 });
  deliver(setup, [own]);

  // Act
  reply.answer(own);
  await saving;

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Edited" },
    dirty: false,
    conflict: { status: "none" },
    updatedTo: null,
    saveOutcome: "succeeded",
  });
});

it("an own save delivered after its reply is acknowledged without a saved-elsewhere notice", async () => {
  // Arrange
  const setup = editedAgent();
  await setup.draft.save();

  // Act
  echoed(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: setup.factory.latest(),
    dirty: false,
    conflict: { status: "none" },
    updatedTo: null,
  });
});

it("a revision saved elsewhere while a save is pending is not announced before the reply", () => {
  // Arrange
  const setup = editedAgent();
  pendingSave(setup);

  // Act
  deliver(setup, [savedAgent({ name: "Saved elsewhere", revision: 4 })]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saving: true,
    saved: { revision: 3 },
    content: { name: "Edited" },
    conflict: { status: "none" },
    updatedTo: null,
  });
});

it("a higher revision saved elsewhere during a save is adopted after the save's reply", async () => {
  // Arrange
  const setup = editedAgent();
  const { reply, saving } = pendingSave(setup);
  deliver(setup, [savedAgent({ name: "Saved elsewhere", revision: 5 })]);

  // Act
  reply.answer(savedAgent({ name: "Edited", revision: 4 }));
  await saving;

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 5, name: "Saved elsewhere" },
    content: { name: "Saved elsewhere" },
    dirty: false,
    updatedTo: 5,
  });
});

it("a removal elsewhere before a late save success keeps the Agent removed", async () => {
  // Arrange
  const setup = editedAgent();
  const { reply, saving } = pendingSave(setup);
  removedElsewhere(setup);

  // Act
  reply.answer(savedAgent({ name: "Edited", revision: 4 }));
  const saved = await saving;

  // Assert
  expect(saved).toBeUndefined();
  expect(setup.draft.getSnapshot()).toMatchObject({
    removed: true,
    saved: { revision: 3 },
    content: { name: "Edited" },
    saving: false,
  });
});

it("a rejected save shows a newer revision's notice beside the error and keeps the baseline", async () => {
  // Arrange
  const setup = editedAgent();
  const { reply, saving } = pendingSave(setup);
  deliver(setup, [savedAgent({ name: "Saved elsewhere", revision: 4 })]);

  // Act
  reply.fail(new ApiError({ code: "validation", message: "Prompt is too long.", issues: [] }));
  await saving;

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Edited" },
    dirty: true,
    error: "Prompt is too long.",
    saveOutcome: "rejected",
    conflict: { status: "detected", revision: 4 },
    saving: false,
  });
});

it("a save the offline window did not send keeps the draft and says nothing was sent", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  factory.updateAgent.mockRejectedValueOnce(new OfflineError("not-sent"));

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    saving: false,
    saveOutcome: "not-sent",
    error: "Factory is offline. Nothing was sent; reconnect and check the current state first.",
  });
  expect(factory.updateAgent).toHaveBeenCalledTimes(1);
});

it("a save whose reply is lost reports an unknown outcome, keeps the draft and is not retried", async () => {
  // Arrange
  const { draft, factory } = editedAgent();
  factory.updateAgent.mockRejectedValueOnce(new OfflineError("unknown"));

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    saving: false,
    saveOutcome: "unknown",
    error: expect.stringMatching(/^Save outcome unknown\./),
  });
  expect(factory.updateAgent).toHaveBeenCalledTimes(1);
});

it("a delivered revision holding an unknown save's content is recognised as that save", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.updateAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  await setup.draft.save();

  // Act
  deliver(setup, [savedAgent({ name: "Edited", revision: 4 })]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Edited" },
    dirty: false,
    conflict: { status: "none" },
    saveOutcome: "succeeded",
    error: "",
  });
});

it("the new-Agent form is unaffected by Agents saved or removed elsewhere", () => {
  // Arrange
  const setup = agentDraft(null);
  setup.draft.edit({ name: "Unfinished" });

  // Act
  deliver(setup, [savedAgent({ id: "other", revision: 2 })], ["agent"]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: null,
    content: { name: "Unfinished" },
    dirty: true,
    conflict: { status: "none" },
    removed: false,
    canSave: true,
  });
});

it("a created Agent that Studio has not delivered yet is not treated as removed", async () => {
  // Arrange
  const setup = await createdAgent();

  // Act
  deliver(setup, [savedAgent({ id: "other" })]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { id: "created", revision: 1 },
    removed: false,
  });
});

it("a created Agent follows a revision saved elsewhere once Studio holds it", async () => {
  // Arrange
  const setup = await createdAgent();
  echoed(setup);

  // Act
  savedElsewhere(setup, { name: "Renamed elsewhere" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { id: "created", revision: 2, name: "Renamed elsewhere" },
    dirty: false,
    updatedTo: 2,
  });
});

it("an own delete delivered before its reply is not a removal elsewhere", async () => {
  // Arrange
  const setup = agentDraft();
  const reply = held(setup.factory.removeAgent);
  const removing = setup.draft.remove();
  removedElsewhere(setup);

  // Act
  reply.answer(undefined);
  await removing;

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    removed: false,
    dirty: false,
    removing: false,
  });
});

it("a clean Agent removed elsewhere retains a draft and refuses Save", async () => {
  // Arrange
  const setup = agentDraft();
  removedElsewhere(setup);

  // Act
  const result = await setup.draft.save();

  // Assert
  expect(result).toBeUndefined();
  expect(setup.factory.updateAgent).not.toHaveBeenCalled();
  expect(setup.draft.getSnapshot()).toMatchObject({ removed: true, dirty: false, canSave: false });
});

it("an Agent removed elsewhere refuses another Delete", async () => {
  // Arrange
  const setup = agentDraft();
  removedElsewhere(setup);

  // Act
  const deleted = await setup.draft.remove();

  // Assert
  expect(deleted).toBe(false);
  expect(setup.factory.removeAgent).not.toHaveBeenCalled();
});
