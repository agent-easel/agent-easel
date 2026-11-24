import { expect, it, vi } from "vite-plus/test";
import type { AgentDefinition } from "@agent-easel/contracts";
import { ApiError } from "../src/api.ts";
import { OfflineError } from "../src/transport.ts";
import { savedAgent } from "./support/agent-draft.ts";
import {
  comparedFlow,
  editedFlow,
  held,
  laterThan,
  openedFlow,
  rejection,
  savingFlow,
} from "./support/flow-draft.ts";
import {
  agentDraft,
  comparedAgent,
  createdAgent,
  deliver,
  echoed,
  editedAgent,
  failedDelete,
  ownerChangedElsewhere,
  pendingSave,
  publishedWhen,
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

it("a rejected save keeps the edits unsaved and shows Factory's message and issues", async () => {
  // Arrange
  const { draft, factory } = editedFlow("Edited");
  const issue = { code: "required", path: "name", message: "Name is required." };
  factory.updateFlow.mockRejectedValueOnce(rejection({ issues: [issue] }));

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 1 },
    content: { name: "Edited" },
    dirty: true,
    saving: false,
    saveOutcome: "rejected",
    error: "Flow is invalid.",
    issues: [issue],
    conflict: { status: "none" },
  });
});

it("a second save is not sent while the first is in flight", async () => {
  // Arrange
  const { draft, factory } = editedFlow();
  held(factory.updateFlow);
  void draft.save();

  // Act
  await draft.save();

  // Assert
  expect(factory.updateFlow).toHaveBeenCalledTimes(1);
  expect(draft.getSnapshot().saving).toBe(true);
});

it("an accepted removal clears unsaved changes before its caller navigates", async () => {
  // Arrange
  const { draft, factory } = editedFlow("Mine");
  const reported: { dirty: boolean; removing: boolean }[] = [];
  const unsubscribe = draft.subscribe(() => {
    const { dirty, removing } = draft.getSnapshot();
    reported.push({ dirty, removing });
  });

  // Act
  const removed = await draft.remove();

  // Assert
  expect(removed).toBe(true);
  expect(draft.getSnapshot()).toMatchObject({ dirty: false, removing: false, removalError: "" });
  expect(factory.removeFlow).toHaveBeenCalledWith("flow");
  expect(reported).toStrictEqual([
    { dirty: true, removing: true },
    { dirty: false, removing: false },
  ]);
  unsubscribe();
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

it("a fresh delivery of the saved revision keeps the draft and names no revision", () => {
  // Arrange
  const setup = editedAgent();
  const redelivered = savedAgent();

  // Act
  deliver(setup, [redelivered]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: redelivered,
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

it("taking a compared revision that is no longer the newest changes nothing", () => {
  // Arrange
  const { draft, factory, published } = comparedFlow();
  factory.saveElsewhere("Theirs again");
  published();

  // Act
  draft.takeLatest(2);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 1 },
    content: { name: "Mine" },
    dirty: true,
    conflict: { status: "compared", latest: { revision: 3 } },
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

it("a removal keeps revision resolution dismissed after a late save conflict", async () => {
  // Arrange
  const { draft, removedElsewhere, reply, saving } = savingFlow();
  await removedElsewhere();

  // Act
  reply.fail(rejection({ code: "conflict", message: "A stale save." }));
  await saving;

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    removed: true,
    conflict: { status: "none" },
    error: "",
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
    error: expect.stringContaining("nothing is retried"),
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

it("a failed removal of a definition another client removed meanwhile retains a clean draft", async () => {
  // Arrange
  const { draft, factory, removedElsewhere } = openedFlow();
  const reply = held(factory.removeFlow);
  const removing = draft.remove();
  await removedElsewhere();

  // Act
  reply.fail(new OfflineError("unknown"));
  const accepted = await removing;

  // Assert
  expect(accepted).toBe(false);
  expect(draft.getSnapshot()).toMatchObject({
    removed: true,
    dirty: false,
    removing: false,
    canSave: false,
    removalError: "",
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

it("a clean editor takes an owner changed elsewhere without asking", () => {
  // Arrange
  const setup = agentDraft();

  // Act
  ownerChangedElsewhere(setup, "northwind");

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3, projectId: "northwind" },
    owner: "northwind",
    ownerChange: { status: "none" },
    dirty: false,
  });
});

it("a dirty editor keeps its edits and must acknowledge an owner changed elsewhere before saving", () => {
  // Arrange
  const setup = editedAgent();

  // Act
  ownerChangedElsewhere(setup, "northwind");

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: "northwind",
    ownerChange: { status: "changed", from: null, to: "northwind" },
    conflict: { status: "none" },
    canSave: false,
  });
});

it("an acknowledged owner change keeps the edits and the next save expects the new owner", async () => {
  // Arrange
  const setup = editedAgent();
  ownerChangedElsewhere(setup, "northwind");
  setup.draft.acknowledgeOwner("northwind");

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.factory.updateAgent).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({ name: "Edited", expectedProjectId: "northwind" }),
  );
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Edited", projectId: "northwind" },
    dirty: false,
    ownerChange: { status: "none" },
  });
});

it("acknowledging an owner that is no longer the changed one keeps saving blocked", () => {
  // Arrange
  const setup = editedAgent();
  ownerChangedElsewhere(setup, "northwind");
  ownerChangedElsewhere(setup, "ledgerly");

  // Act
  setup.draft.acknowledgeOwner("northwind");

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    ownerChange: { status: "changed", from: null, to: "ledgerly" },
    canSave: false,
  });
});

it("an owner changed back to the acknowledged one needs no acknowledgement", () => {
  // Arrange
  const setup = editedAgent();
  ownerChangedElsewhere(setup, "northwind");

  // Act
  ownerChangedElsewhere(setup, null);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("a save refused for a stale owner keeps the draft and waits for the new owner instead of a newer revision", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.moveElsewhere("northwind");

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Edited" },
    dirty: true,
    conflict: { status: "none" },
    ownerChange: { status: "waiting" },
    canSave: false,
  });
});

it("after a stale-owner refusal, Studio's delivery of the new owner asks for acknowledgement", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();

  // Act
  echoed(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    ownerChange: { status: "changed", from: null, to: "northwind" },
    canSave: false,
  });
});

it("after a stale-owner refusal, Studio's delivery of the owner moved back to the acknowledged one lets the edits save", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();
  setup.factory.moveElsewhere(null);

  // Act
  echoed(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: null,
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("after a stale-owner refusal, a delivery of the state read before the move keeps waiting", async () => {
  // Arrange
  const setup = editedAgent();
  const beforeMove = setup.factory.latest();
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();

  // Act
  deliver(setup, [{ ...beforeMove }]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "waiting" },
    canSave: false,
  });
});

it("after a stale-owner refusal, a queued delivery read before the refusing move keeps waiting", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.moveElsewhere("northwind");
  const queued = setup.factory.moveElsewhere(null);
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();

  // Act
  deliver(setup, [queued]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "waiting" },
    canSave: false,
  });
});

it("after a stale-owner refusal whose read fails, a queued delivery read before the refusing move keeps waiting", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.getAgent.mockRejectedValue(new Error("Factory could not read the Agent."));
  setup.factory.moveElsewhere("northwind");
  const queued = setup.factory.moveElsewhere(null);
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();

  // Act
  deliver(setup, [queued]);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "waiting" },
    canSave: false,
  });
});

it("after a stale-owner refusal whose read failed, the next delivery reads again and the owner moved back lets the edits save", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.getAgent.mockRejectedValue(new Error("Factory could not read the Agent."));
  setup.factory.moveElsewhere("northwind");
  await setup.draft.save();
  setup.factory.getAgent.mockImplementation(async () => setup.factory.latest());
  setup.factory.moveElsewhere(null);
  const released = publishedWhen(setup, (snapshot) => snapshot.ownerChange.status === "none");

  // Act
  echoed(setup);

  // Assert
  expect(await released).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: null,
    canSave: true,
  });
});

it("a retried read after a stale-owner refusal checks the owner Studio delivered while it ran", async () => {
  // Arrange
  const setup = editedAgent();
  const unread = new Error("Factory could not read the Agent.");
  setup.factory.getAgent.mockRejectedValueOnce(unread).mockRejectedValueOnce(unread);
  setup.factory.moveElsewhere("northwind");
  const queued = setup.factory.moveElsewhere(null);
  const refusing = setup.factory.moveElsewhere("northwind");
  await setup.draft.save();
  let answerRead: (agent: AgentDefinition) => void = () => {};
  setup.factory.getAgent.mockImplementationOnce(
    () => new Promise<AgentDefinition>((resolve) => (answerRead = resolve)),
  );
  deliver(setup, [queued]);
  setup.factory.moveElsewhere(null);
  echoed(setup);
  const released = publishedWhen(setup, (snapshot) => snapshot.ownerChange.status === "none");

  // Act
  answerRead(refusing);

  // Assert
  expect(await released).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: null,
    canSave: true,
  });
});

it("after a stale-owner refusal, a read finding the owner already moved back lets the edits save", async () => {
  // Arrange
  const setup = editedAgent();
  setup.factory.moveElsewhere("northwind");
  setup.factory.getAgent.mockImplementationOnce(async () => setup.factory.moveElsewhere(null));

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: null,
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("a dirty editor's own Change owner needs no acknowledgement, also before Studio delivers it", () => {
  // Arrange
  const setup = editedAgent();
  const moved = setup.factory.moveElsewhere("northwind");

  // Act
  setup.draft.ownerChangedHere(moved);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: "northwind",
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("a dirty editor's own Change owner that Studio delivered before its reply needs no acknowledgement", () => {
  // Arrange
  const setup = editedAgent();
  const moved = ownerChangedElsewhere(setup, "northwind");

  // Act
  setup.draft.ownerChangedHere(moved);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: "northwind",
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("a Change owner reply older than the owner Studio delivered since leaves the delivered owner", () => {
  // Arrange
  const setup = editedAgent();
  const reply = setup.factory.moveElsewhere("northwind");
  ownerChangedElsewhere(setup, null);

  // Act
  setup.draft.ownerChangedHere(reply);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "none" },
    canSave: true,
  });
});

it("a Change owner reply older than a newer revision Studio delivered beside the edits leaves the delivered owner", () => {
  // Arrange
  const setup = editedAgent();
  const reply = setup.factory.moveElsewhere("northwind");
  setup.factory.saveElsewhere({ name: "Saved elsewhere", updatedAt: laterThan(reply.updatedAt) });
  ownerChangedElsewhere(setup, null);

  // Act
  setup.draft.ownerChangedHere(reply);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "none" },
    conflict: { status: "detected", revision: 4 },
  });
});

it("an owner moved back elsewhere after the editor's own Change owner asks for acknowledgement", () => {
  // Arrange
  const setup = editedAgent();
  setup.draft.ownerChangedHere(setup.factory.moveElsewhere("northwind"));

  // Act
  ownerChangedElsewhere(setup, null);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: null,
    ownerChange: { status: "changed", from: "northwind", to: null },
    canSave: false,
  });
});

it("a stale-owner refusal after the editor's own Change owner asks to acknowledge the owner Studio shows", async () => {
  // Arrange
  const setup = editedAgent();
  setup.draft.ownerChangedHere(setup.factory.moveElsewhere("northwind"));
  setup.factory.moveElsewhere(null);

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    owner: null,
    ownerChange: { status: "changed", from: "northwind", to: null },
    canSave: false,
  });
});
