import { expect, it } from "vite-plus/test";
import { validateCreateAgent } from "@t3-factory/domain-validation";
import { createShapedContent } from "../src/agent-draft.ts";
import { comparedAgentLines } from "../src/components/studio-agents/agent-revision-panel.tsx";
import { OfflineError } from "../src/transport.ts";
import { capabilities, savedAgent } from "./support/agent-draft.ts";
import { held } from "./support/flow-draft.ts";
import { factoryProject } from "./support/studio-definitions.ts";
import {
  agentDraft,
  comparedAgent,
  editedAgent,
  ownerChangedElsewhere,
  pendingSave,
  publishedWhen,
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

it("a saved model T3 no longer offers opens cleared, reading Needs a model without a change to save", () => {
  // Arrange
  const agent = savedAgent({
    execution: {
      environmentId: "local",
      providerInstanceId: "primary",
      modelId: "gone-model",
      modelOptions: [{ id: "effort", value: "high" }],
    },
  });

  // Act
  const { draft } = agentDraft(agent);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    content: {
      execution: {
        environmentId: "local",
        providerInstanceId: "primary",
        modelId: "",
        modelOptions: [],
      },
    },
    needsModel: true,
    dirty: false,
  });
});

it("a saved environment T3 no longer offers clears the whole Worker selection", () => {
  // Arrange
  const agent = savedAgent({
    execution: {
      environmentId: "gone",
      providerInstanceId: "primary",
      modelId: "first",
      modelOptions: [],
    },
  });

  // Act
  const { draft } = agentDraft(agent);

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual({
    environmentId: "",
    providerInstanceId: "",
    modelId: "",
    modelOptions: [],
  });
});

it("a saved selection is kept as saved while T3's capabilities are unavailable", () => {
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
  const { draft } = agentDraft(agent, null);

  // Assert
  expect(draft.getSnapshot().content.execution).toStrictEqual(agent.execution);
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

it("removing the Worker saves the Agent without a model", async () => {
  // Arrange
  const { draft, factory } = agentDraft();
  draft.removeWorker();

  // Act
  await draft.save();

  // Assert
  expect(factory.updateAgent).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({ execution: null, expectedRevision: 3 }),
  );
  expect(draft.getSnapshot()).toMatchObject({ saved: { execution: null }, dirty: false });
});

it("loading the compared revision leaves a clean draft of that revision", () => {
  // Arrange
  const { draft } = comparedAgent();

  // Act
  draft.loadLatest(4);

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    saved: { revision: 4, name: "Saved elsewhere" },
    content: { name: "Saved elsewhere" },
    dirty: false,
    conflict: { status: "none" },
    canSave: true,
  });
});

it("loading a revision that is no longer the newest changes nothing", () => {
  // Arrange
  const setup = comparedAgent();
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

it("a removal elsewhere dismisses the comparison and keeps the draft", () => {
  // Arrange
  const setup = comparedAgent();

  // Act
  removedElsewhere(setup);

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({
    removed: true,
    conflict: { status: "none" },
    content: { name: "Edited" },
    dirty: true,
  });
});

it("an Agent Duplicate creates the copy in the chosen target owner and returns it", async () => {
  // Arrange
  const setup = agentDraft();

  // Act
  const copy = await setup.draft.duplicate("northwind", "Reviewer copy");

  // Assert
  expect(setup.factory.duplicateAgent).toHaveBeenCalledWith("agent", {
    projectId: "northwind",
    name: "Reviewer copy",
  });
  expect(copy).toMatchObject({ id: "copy", name: "Reviewer copy" });
});

it("a lost Create checks its own request and ends in a safe state if the lookup fails", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  factory.getAgentCreateOutcome.mockRejectedValueOnce(new OfflineError());

  // Act
  await draft.save();

  // Assert
  expect(factory.getAgentCreateOutcome).toHaveBeenCalledWith(
    factory.createAgent.mock.calls[0]![0].requestId,
  );
  expect(draft.getSnapshot()).toMatchObject({
    saved: null,
    content: { name: "New reviewer" },
    saveOutcome: "unknown",
    canSave: false,
    createCheck: { status: "unconfirmed" },
  });
});

it("Create again stays blocked while Factory is checking the original request", async () => {
  // Arrange
  const setup = agentDraft(null);
  const { draft, factory } = setup;
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  const reply = held(factory.getAgentCreateOutcome);
  const checking = publishedWhen(setup, (state) => state.createCheck.status === "checking");
  const saving = draft.save();
  await checking;

  // Act
  draft.createAgain();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    canSave: false,
    createCheck: { status: "checking" },
  });
  reply.answer({ status: "unconfirmed" });
  await saving;
});

it("a lost Create that made nothing offers Create again after Factory confirms absence", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  factory.getAgentCreateOutcome.mockResolvedValueOnce({ status: "absent" });
  await draft.save();

  // Act
  draft.createAgain();

  // Assert
  expect(draft.getSnapshot()).toMatchObject({
    canSave: true,
    error: "",
    saveOutcome: null,
    createCheck: { status: "none" },
  });
});

it("a recovered Create opens the Agent even when another client changed its content", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null);
  draft.edit({ name: "New reviewer", prompt: "Review the change." });
  const made = savedAgent({ id: "made", name: "Edited elsewhere", revision: 2 });
  factory.createAgent.mockRejectedValueOnce(new OfflineError("unknown"));
  factory.getAgentCreateOutcome.mockResolvedValueOnce({ status: "created", agent: made });
  await draft.save();

  // Act
  const opened = draft.openCreated();

  // Assert
  expect(opened).toStrictEqual(made);
  expect(draft.getSnapshot()).toMatchObject({
    saved: made,
    dirty: false,
    error: "",
    createCheck: { status: "none" },
  });
});

it("two exits with one name are tagged Duplicate and block Save before any request", async () => {
  // Arrange
  const { draft, factory } = agentDraft();
  const exits = [
    { id: "a", name: "Ready for review", description: "", messageRequired: false },
    { id: "b", name: " Ready for review ", description: "", messageRequired: true },
    { id: "c", name: "", description: "", messageRequired: false },
  ];
  draft.edit({ exits });

  // Act
  await draft.save();

  // Assert
  const snapshot = draft.getSnapshot();
  expect(snapshot.canSave).toBe(false);
  expect(Object.fromEntries(snapshot.exitProblems!.tags)).toStrictEqual({
    a: "Duplicate",
    b: "Duplicate",
    c: "Required",
  });
  expect(snapshot.exitProblems!.card.title).toBe("Two exits are named “Ready for review”");
  expect(factory.updateAgent).not.toHaveBeenCalled();
});

it("an Agent removed elsewhere refuses Duplicate", async () => {
  // Arrange
  const setup = agentDraft();
  removedElsewhere(setup);

  // Act
  const copy = await setup.draft.duplicate(null, "Copy");

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

it("a new Agent created for a Project leaves out the Project overrides its draft held", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null, capabilities);
  draft.edit({ name: "Releaser", prompt: "Release the change." });
  draft.setOverride({ projectId: "northwind", execution: savedAgent().execution! });

  // Act
  await draft.save("ledgerly");

  // Assert
  expect(factory.createAgent).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "ledgerly", projectOverrides: [] }),
  );
  expect(draft.getSnapshot()).toMatchObject({ dirty: false, error: "" });
});

it("two Agent revisions that differ only in a Project override read differently in the comparison", () => {
  // Arrange
  const base = savedAgent();
  const overridden = savedAgent({
    projectOverrides: [
      {
        projectId: "northwind",
        execution: { ...base.execution!, providerInstanceId: "other", modelId: "other-first" },
      },
    ],
  });

  // Act
  const shown = [
    comparedAgentLines(base, [], capabilities),
    comparedAgentLines(overridden, [], capabilities),
  ];

  // Assert
  expect(shown[0]).not.toStrictEqual(shown[1]);
  expect(shown[1]).toContainEqual(expect.objectContaining({ text: "Unknown Project" }));
  expect(shown[1]).toContainEqual(expect.objectContaining({ text: "  Model  Other model" }));
});

it("a refused Create for a Project keeps the Project overrides in the draft", async () => {
  // Arrange
  const { draft, factory } = agentDraft(null, capabilities);
  draft.edit({ name: "", prompt: "Release the change." });
  const override = { projectId: "northwind", execution: savedAgent().execution! };
  draft.setOverride(override);

  // Act
  await draft.save("ledgerly");

  // Assert
  expect(factory.createAgent).not.toHaveBeenCalled();
  expect(draft.getSnapshot().content.projectOverrides).toStrictEqual([override]);
  expect(draft.getSnapshot().error).not.toBe("");
});

it("Agent revisions giving the same settings to two Projects with one title read differently", () => {
  // Arrange
  const execution = savedAgent().execution!;
  const projects = [factoryProject("atlas-1", "Atlas"), factoryProject("atlas-2", "Atlas")];
  const first = savedAgent({ projectOverrides: [{ projectId: "atlas-1", execution }] });
  const second = savedAgent({ projectOverrides: [{ projectId: "atlas-2", execution }] });

  // Act
  const shown = [
    comparedAgentLines(first, projects, capabilities),
    comparedAgentLines(second, projects, capabilities),
  ];

  // Assert
  expect(shown[0]).not.toStrictEqual(shown[1]);
});

it("acknowledging a move to a Project elsewhere keeps the draft's Project overrides and blocks Save", () => {
  // Arrange
  const setup = agentDraft();
  const override = { projectId: "northwind", execution: savedAgent().execution! };
  setup.draft.setOverride(override);
  ownerChangedElsewhere(setup, "ledgerly");

  // Act
  setup.draft.acknowledgeOwner("ledgerly");

  // Assert
  expect(setup.draft.getSnapshot()).toMatchObject({ strandedOverrides: true, canSave: false });
  expect(setup.draft.getSnapshot().content.projectOverrides).toStrictEqual([override]);
});

it("an Agent moved to a Project elsewhere saves without the Project overrides removed from its draft", async () => {
  // Arrange
  const setup = agentDraft();
  setup.draft.setOverride({ projectId: "northwind", execution: savedAgent().execution! });
  ownerChangedElsewhere(setup, "ledgerly");
  setup.draft.acknowledgeOwner("ledgerly");
  setup.draft.removeOverrides();

  // Act
  await setup.draft.save();

  // Assert
  expect(setup.factory.updateAgent).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({ expectedProjectId: "ledgerly", projectOverrides: [] }),
  );
});

it("a non-effort Worker option is visible as a changed setting in the Agent comparison", () => {
  // Arrange
  const base = savedAgent();
  const modified = savedAgent({
    execution: { ...base.execution!, modelOptions: [{ id: "old", value: false }] },
  });

  // Act
  const shown = comparedAgentLines(modified, [], capabilities);

  // Assert
  expect(shown).toContainEqual(expect.objectContaining({ text: "  Old  Off" }));
  expect(shown).toContainEqual(expect.objectContaining({ text: "  Effort  Low · Default" }));
  expect(shown).toContainEqual(expect.objectContaining({ text: "  Environment  Local" }));
});
