import { expect, it } from "vite-plus/test";
import { validateCreateAgent } from "@t3-factory/domain-validation";
import { createShapedContent } from "../src/agent-draft.ts";
import { OfflineError } from "../src/transport.ts";
import { capabilities, savedAgent } from "./support/agent-draft.ts";
import {
  agentDraft,
  comparedAgent,
  editedAgent,
  pendingSave,
  removedElsewhere,
  savedElsewhere,
} from "./support/agent-editor.ts";

it("a new Agent starts with one optional-message exit and the first reporting provider's first model and defaults", () => {
  // Arrange

  // Act
  const { draft } = agentDraft(null);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: {
      name: "",
      prompt: "",
      execution: {
        environmentId: "local",
        providerInstanceId: "primary",
        modelId: "first",
        modelOptions: [
          { id: "effort", value: "low" },
          { id: "old", value: true },
        ],
      },
      exits: [{ id: expect.any(String), name: "done", description: "", messageRequired: false }],
    },
    dirty: false,
  });
});

it("a new Agent leaves the provider unset when none supports Factory reporting", () => {
  // Arrange
  const offered = { ...capabilities, providers: [capabilities.providers[0]!] };

  // Act
  const { draft } = agentDraft(null, offered);

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual({
    environmentId: "local",
    providerInstanceId: "",
    modelId: "",
    modelOptions: [],
  });
});

it("a new Agent leaves worker settings unset without T3 capabilities", () => {
  // Arrange

  // Act
  const { draft } = agentDraft(null, null);

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual({
    environmentId: "",
    providerInstanceId: "",
    modelId: "",
    modelOptions: [],
  });
});

it("an Agent saved without a model opens with no Worker choice preselected", () => {
  // Arrange
  const agent = savedAgent({ execution: null });

  // Act
  const { draft } = agentDraft(agent);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: {
      execution: { environmentId: "", providerInstanceId: "", modelId: "", modelOptions: [] },
    },
    needsModel: true,
    dirty: false,
  });
});

it("saved worker settings that T3 no longer offers are kept without substitution", () => {
  // Arrange
  const agent = savedAgent({
    execution: {
      environmentId: "gone",
      providerInstanceId: "gone-provider",
      modelId: "gone-model",
      modelOptions: [{ id: "gone-option", value: "original" }],
    },
  });

  // Act
  const { draft } = agentDraft(agent);

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual(agent.execution);
  expect(draft.getSnapshot()).toMatchObject({
    dirty: false,
    choices: { providers: [], selectedProvider: undefined, selectedModel: undefined },
  });
});

it("a model-less Agent removed elsewhere recovers as a valid create request without a model", () => {
  // Arrange
  const setup = agentDraft(savedAgent({ execution: null }));
  removedElsewhere(setup);

  // Act
  const recovered = createShapedContent(setup.draft.getSnapshot().content);

  // Assert
  expect(recovered.execution).toBeNull();
  expect(validateCreateAgent(recovered).ok).toBe(true);
});

it("choosing a provider selects its first model, preserves shared options and defaults the rest", () => {
  // Arrange
  const { draft } = agentDraft(
    savedAgent({
      execution: {
        environmentId: "local",
        providerInstanceId: "primary",
        modelId: "first",
        modelOptions: [
          { id: "effort", value: "high" },
          { id: "old", value: true },
        ],
      },
    }),
  );

  // Act
  draft.chooseProvider("other");

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual({
    environmentId: "local",
    providerInstanceId: "other",
    modelId: "other-first",
    modelOptions: [
      { id: "effort", value: "high" },
      { id: "new", value: false },
    ],
  });
  expect(draft.getSnapshot().dirty).toBe(true);
});

it("choosing a model preserves shared options and defaults the rest", () => {
  // Arrange
  const { draft } = agentDraft(
    savedAgent({
      execution: {
        environmentId: "local",
        providerInstanceId: "primary",
        modelId: "first",
        modelOptions: [
          { id: "effort", value: "high" },
          { id: "old", value: true },
        ],
      },
    }),
  );

  // Act
  draft.chooseModel("second");

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual({
    environmentId: "local",
    providerInstanceId: "primary",
    modelId: "second",
    modelOptions: [
      { id: "effort", value: "high" },
      { id: "new", value: false },
    ],
  });
});

it("editing worker settings leaves unsaved changes", () => {
  // Arrange
  const { draft } = agentDraft();

  // Act
  draft.setEnvironmentId("another-machine");

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { execution: { environmentId: "another-machine" } },
    dirty: true,
    choices: { providers: [] },
  });
});

it("an invalid Agent is rejected with the validation message without sending a request", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    error: "Enter an Agent name between 1 and 200 characters.",
    saving: false,
  });
  expect(factory.createAgent).not.toHaveBeenCalled();
  expect(factory.updateAgent).not.toHaveBeenCalled();
});

it("a new Agent saves without a model when no provider supports Factory reporting", async () => {
  // Arrange
  const offered = { ...capabilities, providers: [capabilities.providers[0]!] };
  const { draft, factory } = agentDraft(null, offered);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });

  // Act
  await draft.save();

  // Assert
  expect(factory.createAgent).toHaveBeenCalledWith(expect.objectContaining({ execution: null }));
  expect(draft.getSnapshot()).toMatchObject({
    saved: { execution: null },
    needsModel: true,
    dirty: false,
    error: "",
  });
});

it("clearing the Worker selection saves the Agent without a model", async () => {
  // Arrange
  const { draft, factory } = agentDraft();
  draft.clearWorker();

  // Act
  await draft.save();

  // Assert
  expect(factory.updateAgent).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({ execution: null, expectedRevision: 3 }),
  );
  expect(draft.getSnapshot()).toMatchObject({ saved: { execution: null }, dirty: false });
});

it("loading the latest revision after confirmation leaves a clean draft of that revision", () => {
  // Arrange
  const { draft } = comparedAgent();
  draft.requestLoadLatest(4);

  // Act
  draft.loadLatest(4);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Saved elsewhere" },
    content: { name: "Saved elsewhere" },
    dirty: false,
    conflict: { status: "none" },
    confirmingLoad: null,
    canSave: true,
  });
});

it("loading the latest revision without confirmation keeps the draft", () => {
  // Arrange
  const { draft } = comparedAgent();

  // Act
  draft.loadLatest(4);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: { name: "Edited" },
    conflict: { status: "compared", latest: { revision: 4 } },
  });
});

it("a revision arriving during the Load latest confirmation closes it and moves the comparison to that revision", () => {
  // Arrange
  const setup = comparedAgent();
  setup.draft.requestLoadLatest(4);

  // Act
  savedElsewhere(setup, { name: "Revision 5" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    confirmingLoad: null,
    conflict: { status: "compared", latest: { revision: 5, name: "Revision 5" } },
    content: { name: "Edited" },
  });
});

it("confirming Load latest for a revision that is no longer the newest changes nothing", () => {
  // Arrange
  const setup = comparedAgent();
  setup.draft.requestLoadLatest(4);
  savedElsewhere(setup, { name: "Revision 5" });

  // Act
  setup.draft.loadLatest(4);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    saved: { revision: 3 },
    content: { name: "Edited" },
    conflict: { status: "compared", latest: { revision: 5 } },
  });
});

it("a removal elsewhere dismisses the comparison and its confirmation and keeps the draft", () => {
  // Arrange
  const setup = comparedAgent();
  setup.draft.requestLoadLatest(4);

  // Act
  removedElsewhere(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    removed: true,
    conflict: { status: "none" },
    confirmingLoad: null,
    content: { name: "Edited" },
    dirty: true,
  });
});

it("an Agent Duplicate returns the new copy", async () => {
  // Arrange
  const setup = agentDraft();

  // Act
  const copy = await setup.draft.duplicate();

  // Assert
  expect(copy).toMatchObject({ id: "copy", name: "Reviewer copy" });
});

it("a Create whose reply is lost blocks another Create until the Agent list has been checked", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));

  // Act
  await draft.save();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: null,
    content: { name: "New reviewer" },
    saveOutcome: "unknown",
    canSave: false,
    error: expect.stringContaining("check the Agent list before creating it again"),
  });
});

it("confirming the Agent list was checked after a lost Create allows Create again", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  await draft.save();

  // Act
  draft.allowCreateAgain();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({ canSave: true, error: "", saveOutcome: null });
});

it("an Agent removed elsewhere refuses Duplicate", async () => {
  // Arrange
  const setup = agentDraft();
  removedElsewhere(setup);

  // Act
  const copy = await setup.draft.duplicate();

  // Assert
  expect(copy).toBeUndefined();
  expect(setup.factory.duplicateAgent).not.toHaveBeenCalled();
});

it("a retained Agent stays editable while a superseded save reply is pending", () => {
  // Arrange
  const setup = editedAgent();
  pendingSave(setup);
  removedElsewhere(setup);

  // Act
  setup.draft.edit({ prompt: "Recover while the save reply is pending" });

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    removed: true,
    content: { prompt: "Recover while the save reply is pending" },
    canSave: false,
  });
});
