import { expect, it } from "vite-plus/test";
import { createFlowDraft } from "../src/flow-draft.ts";
import {
  editedFlow,
  held,
  interactingFlow,
  unlistedFlow,
  notReady,
  openedFlow,
  comparedFlow,
  refusedFlow,
  savingFlow,
  validated,
} from "./support/flow-draft.ts";
import { savedAgent } from "./support/agent-draft.ts";

it("an edit made while a readiness check is in flight applies and drops that check's answer", async () => {
  // Arrange
  const { draft, factory } = editedFlow("Checked");
  const answer = held(factory.validateFlow);
  const checking = draft.check();

  // Act
  draft.edit({ name: "Later" });
  answer.answer(validated());
  await checking;

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Later" },
    busy: false,
    readiness: null,
  });
});

it("a clean Flow adopts a revision saved elsewhere and says it was updated", () => {
  // Arrange
  const { draft, factory, published } = openedFlow();
  factory.saveElsewhere("Theirs", notReady);

  // Act
  published();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 2 },
    content: { name: "Theirs" },
    dirty: false,
    updatedTo: 2,
    readiness: notReady,
    conflict: { status: "none" },
  });
});

it("a changed saved Agent keeps an unresolved revision conflict and its refused save", async () => {
  // Arrange
  const { draft, agentChanged } = await refusedFlow();

  // Act
  agentChanged();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ conflict: { status: "detected" }, canSave: false });
});

it("keeping the local draft against the compared revision clears its readiness check and sends no save", async () => {
  // Arrange
  const { draft, factory } = comparedFlow();
  await draft.check();

  // Act
  draft.keepLocal(2);

  // Assert
  expect(factory.updateFlow).not.toHaveBeenCalled();
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 2 },
    content: { name: "Mine" },
    dirty: true,
    readiness: null,
  });
});

it("a clean Flow waits for a drag, wire, Auto-arrange or typing to finish before adopting a revision", () => {
  // Arrange
  const { draft, factory, published } = interactingFlow();
  factory.saveElsewhere("Theirs");

  // Act
  published();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 1 },
    content: { name: "Review" },
    updatedTo: null,
    conflict: { status: "none" },
  });
});

it("a revision that arrived during an interaction is adopted when it ends with the draft clean", () => {
  // Arrange
  const { draft, factory, published, end } = interactingFlow();
  factory.saveElsewhere("Theirs");
  published();

  // Act
  end();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 2 },
    content: { name: "Theirs" },
    dirty: false,
    updatedTo: 2,
  });
});

it("an interaction that changed the draft keeps the change and names the revision that arrived meanwhile", () => {
  // Arrange
  const { draft, factory, published, end } = interactingFlow();
  factory.saveElsewhere("Theirs");
  published();
  draft.edit({ name: "Dropped here" });

  // Act
  end();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 1 },
    content: { name: "Dropped here" },
    dirty: true,
    conflict: { status: "detected", revision: 2 },
  });
});

it("a revision saved elsewhere makes readiness unknown at once, even while adoption waits", () => {
  // Arrange
  const { draft, factory, published } = interactingFlow();
  factory.saveElsewhere("Theirs");

  // Act
  published();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ readiness: null });
});

it("a revision saved elsewhere clears an unsaved draft's readiness check", async () => {
  // Arrange
  const { draft, factory, published } = editedFlow();
  await draft.check();
  factory.saveElsewhere("Theirs");

  // Act
  published();

  // Assert
  expect(draft.getSnapshot().readiness).toBeNull();
});

it("losing synchronization makes a clean Flow's readiness unknown", () => {
  // Arrange
  const { draft, disconnected } = openedFlow();

  // Act
  disconnected();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ readiness: null });
});

it("a removal elsewhere clears readiness and dismisses the comparison but keeps the draft", async () => {
  // Arrange
  const { draft, removedElsewhere } = comparedFlow();
  await draft.check();

  // Act
  await removedElsewhere();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    removed: true,
    content: { name: "Mine" },
    dirty: true,
    readiness: null,
    conflict: { status: "none" },
  });
});

it("an accepted removal makes a checked Flow's readiness unknown before Studio delivers it", async () => {
  // Arrange
  const { draft } = editedFlow("Mine");
  await draft.check();

  // Act
  await draft.remove();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ dirty: false, readiness: null });
});

it("an Agent change that only changes the saved Flow's readiness keeps the draft clean and unannounced", () => {
  // Arrange
  const { draft, factory, published } = openedFlow();

  // Act
  published({ ...factory.latest(), readiness: notReady });

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 1 },
    content: { name: "Review" },
    dirty: false,
    updatedTo: null,
    readiness: notReady,
  });
});

it("a change to an Agent an unsaved draft places clears its readiness check and asks for another", async () => {
  // Arrange
  const { draft, factory, agentChanged } = editedFlow();
  await draft.check();

  // Act
  agentChanged();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    dirty: true,
    readiness: null,
  });
  expect(factory.validateFlow).toHaveBeenCalledTimes(1);
});

it("a change to an Agent the Flow does not place keeps a shown readiness check", async () => {
  // Arrange
  const { draft, agentChanged } = editedFlow();
  await draft.check();

  // Act
  agentChanged(savedAgent({ id: "other", revision: 1 }));

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    readiness: { ready: true },
  });
});

it("a clean Flow's readiness check gives way to the saved Flow's readiness after an Agent it places changes", async () => {
  // Arrange
  const { draft, factory, agentChanged } = openedFlow();
  await draft.check();

  // Act
  agentChanged(savedAgent({ revision: 4 }), [{ ...factory.latest(), readiness: notReady }]);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    dirty: false,
    readiness: notReady,
  });
});

it("a readiness answer resolved against an Agent revision Studio has not shown yet is dropped", async () => {
  // Arrange
  const { draft, factory } = editedFlow();
  const answer = held(factory.validateFlow);
  const checking = draft.check();

  // Act
  answer.answer(validated(undefined, 4));
  await checking;

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ readiness: null });
});

it("a readiness check answered after a saved Agent changed is dropped", async () => {
  // Arrange
  const { draft, factory, agentChanged } = editedFlow();
  const answer = held(factory.validateFlow);
  const checking = draft.check();
  agentChanged();

  // Act
  answer.answer(validated());
  await checking;

  // Assert
  expect(draft.getSnapshot().readiness).toBeNull();
});

it("a readiness check answered after a saved Agent changed owner without a new revision is dropped", async () => {
  // Arrange
  const { draft, factory, agentChanged } = editedFlow();
  const answer = held(factory.validateFlow);
  const checking = draft.check();
  agentChanged(savedAgent({ projectId: "project-one" }));

  // Act
  answer.answer(validated());
  await checking;

  // Assert
  expect(draft.getSnapshot().readiness).toBeNull();
});

it("an owner changed elsewhere clears an unsaved draft's readiness check", async () => {
  // Arrange
  const { draft, factory, published } = editedFlow();
  await draft.check();

  // Act
  published(factory.moveElsewhere("northwind"));

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    owner: "northwind",
    readiness: null,
  });
});

it("a readiness check answered after the editor's own Change owner is dropped", async () => {
  // Arrange
  const { draft, factory } = editedFlow();
  const answer = held(factory.validateFlow);
  const checking = draft.check();
  draft.ownerChangedHere(factory.moveElsewhere("northwind"));

  // Act
  answer.answer(validated());
  await checking;

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ owner: "northwind", readiness: null });
});

it("a Flow missing from Studio's first current saved Flows is not found", () => {
  // Arrange
  const { definitions, factory } = unlistedFlow();

  // Act
  const draft = createFlowDraft("flow", definitions, factory);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    status: "failed",
    saved: null,
    removed: false,
    error: "Flow not found.",
    canSave: false,
  });
});

it("a created Flow opens from its create answer before Studio receives it live", () => {
  // Arrange
  const { definitions, factory } = unlistedFlow();

  // Act
  const draft = createFlowDraft("flow", definitions, factory, factory.latest());

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    status: "loaded",
    saved: { revision: 1 },
    removed: false,
    error: "",
  });
});

it("a Create answer cannot reopen a Flow Studio already delivered and then removed", () => {
  // Arrange
  const { definitions, factory, changed } = unlistedFlow();
  const created = factory.latest();
  changed({ flows: { upserts: [created], removals: [] } });
  changed({ flows: { upserts: [], removals: [created.id] } });

  // Act
  const draft = createFlowDraft(created.id, definitions, factory, created);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    status: "failed",
    saved: null,
    error: "Flow not found.",
    canSave: false,
  });
});

it("an unsaved draft names a revision saved elsewhere at once, even during an interaction", () => {
  // Arrange
  const { draft, factory, published } = interactingFlow();
  draft.edit({ name: "Mine" });
  factory.saveElsewhere("Theirs");

  // Act
  published();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Mine" },
    conflict: { status: "detected", revision: 2 },
  });
});

it("a clean Flow removed during an interaction immediately refuses saving and starting", async () => {
  // Arrange
  const { draft, removedElsewhere } = interactingFlow();

  // Act
  await removedElsewhere();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    removed: true,
    dirty: false,
    canSave: false,
  });
});

it("a retained Flow stays editable while a superseded save reply is pending", async () => {
  // Arrange
  const { draft, removedElsewhere } = savingFlow();
  await removedElsewhere();

  // Act
  draft.edit({ name: "Recovery edits" });

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    removed: true,
    content: { name: "Recovery edits" },
    canSave: false,
  });
});

it("a clean Flow retains its content when removed elsewhere", async () => {
  // Arrange
  const { draft, removedElsewhere } = openedFlow();
  const content = draft.getSnapshot().content;

  // Act
  await removedElsewhere();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ removed: true, dirty: false, canSave: false });
  expect(draft.getSnapshot().content).toBe(content);
});

it("a retained Flow refuses a readiness request", async () => {
  // Arrange
  const { draft, factory, removedElsewhere } = openedFlow();
  await removedElsewhere();

  // Act
  await draft.check();

  // Assert
  expect(factory.validateFlow).not.toHaveBeenCalled();
  expect(draft.getSnapshot().readiness).toBe(null);
});

it("a dirty Flow editor saves expecting the owner it acknowledged after a change elsewhere", async () => {
  // Arrange
  const setup = editedFlow("Mine");
  setup.published(setup.factory.moveElsewhere("northwind"));
  setup.draft.acknowledgeOwner("northwind");

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.factory.updateFlow).toHaveBeenCalledWith(
    "flow",
    expect.objectContaining({ name: "Mine", expectedRevision: 1, expectedProjectId: "northwind" }),
  );
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 2, name: "Mine", projectId: "northwind" },
    dirty: false,
  });
});
