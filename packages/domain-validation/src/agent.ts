import type {
  AgentExecutionSettings,
  AgentModelOptionValue,
  CreateAgentInput,
  DuplicateAgentInput,
  Result,
  RunTitleModel,
  UpdateAgentInput,
  UpdateRunTitleSettingInput,
  ValidationIssue,
} from "@t3-factory/contracts";
import { parseAgentExits } from "./block-exits.ts";
import { parseExpectedOwner, parseOwningProject, parseTargetOwner } from "./placement.ts";

/** What a save writes: everything a create does except the owning Project. */
type UpdateAgentContent = Omit<UpdateAgentInput, "expectedRevision" | "expectedProjectId">;

function agentNameIssue(): ValidationIssue {
  return {
    code: "invalid_name",
    path: "name",
    message: "Enter an Agent name between 1 and 200 characters.",
  };
}

function parseTrimmedString(
  value: unknown,
  path: string,
  max: number,
  code: string,
  message: string,
): Result<string> {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    return {
      ok: false,
      error: { code: "validation", message, issues: [{ code, path, message }] },
    };
  }
  return { ok: true, value: value.trim() };
}

/** A validation refusal with one field-addressed issue. */
export function invalid(code: string, path: string, message: string): Result<never> {
  return { ok: false, error: { code: "validation", message, issues: [{ code, path, message }] } };
}

const EXECUTION_REQUIRED =
  "Send execution settings with an environment, provider, model and thinking options, or null for an Agent without a model.";
const INVALID_OPTION = "Thinking options must use supported id and value pairs.";
const MODEL_OPTIONS_REQUIRED =
  "Send the model's thinking options as a list, empty when it has none.";

function parseModelOption(
  option: unknown,
  index: number,
  prefix: string,
): Result<AgentModelOptionValue> {
  const path = `${prefix}.modelOptions.${index}`;
  if (typeof option !== "object" || option === null || !("id" in option) || !("value" in option))
    return invalid("invalid_option", path, INVALID_OPTION);
  const id = parseTrimmedString(
    option.id,
    `${path}.id`,
    256,
    "invalid_option",
    "Each thinking option needs an id.",
  );
  if (!id.ok) return id;
  const value = option.value;
  if (typeof value === "boolean") return { ok: true, value: { id: id.value, value } };
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    return invalid("invalid_option", `${path}.value`, INVALID_OPTION);
  return { ok: true, value: { id: id.value, value } };
}

function parseModelOptions(execution: object, prefix: string): Result<AgentModelOptionValue[]> {
  if (
    "modelOptions" in execution &&
    execution.modelOptions !== undefined &&
    !Array.isArray(execution.modelOptions)
  )
    return invalid("invalid_option", `${prefix}.modelOptions`, INVALID_OPTION);
  const rawOptions =
    "modelOptions" in execution && Array.isArray(execution.modelOptions)
      ? execution.modelOptions
      : [];
  const modelOptions: AgentModelOptionValue[] = [];
  for (const [index, raw] of rawOptions.entries()) {
    const option = parseModelOption(raw, index, prefix);
    if (!option.ok) return option;
    modelOptions.push(option.value);
  }
  return { ok: true, value: modelOptions };
}

function parseExecutionReference(
  execution: object,
  field: "environmentId" | "providerInstanceId" | "modelId",
  code: string,
  message: string,
  prefix = "execution",
): Result<string> {
  return parseTrimmedString(
    field in execution ? (execution as Record<string, unknown>)[field] : undefined,
    `${prefix}.${field}`,
    512,
    code,
    message,
  );
}

/** The key is required: an explicit null saves an Agent that Needs a model, so an omitted key
 * never clears a model silently. */
function parseExecution(input: unknown): Result<AgentExecutionSettings | null> {
  if (typeof input !== "object" || input === null || !("execution" in input))
    return invalid("execution_required", "execution", EXECUTION_REQUIRED);
  if (input.execution === null) return { ok: true, value: null };
  return validateExecutionSettings(input.execution);
}

export function validateExecutionSettings(execution: unknown): Result<AgentExecutionSettings> {
  if (typeof execution !== "object" || execution === null)
    return invalid("execution_required", "execution", EXECUTION_REQUIRED);
  const environmentId = parseExecutionReference(
    execution,
    "environmentId",
    "invalid_environment",
    "Choose a T3 environment.",
  );
  if (!environmentId.ok) return environmentId;
  const providerInstanceId = parseExecutionReference(
    execution,
    "providerInstanceId",
    "invalid_provider",
    "Choose a provider or harness.",
  );
  if (!providerInstanceId.ok) return providerInstanceId;
  const modelId = parseExecutionReference(execution, "modelId", "invalid_model", "Choose a model.");
  if (!modelId.ok) return modelId;
  // Unlike a Run title model, an omitted list is partial settings, never "no options".
  if (!("modelOptions" in execution) || !Array.isArray(execution.modelOptions))
    return invalid("invalid_option", "execution.modelOptions", MODEL_OPTIONS_REQUIRED);
  const modelOptions = parseModelOptions(execution, "execution");
  if (!modelOptions.ok) return modelOptions;
  return {
    ok: true,
    value: {
      environmentId: environmentId.value,
      providerInstanceId: providerInstanceId.value,
      modelId: modelId.value,
      modelOptions: modelOptions.value,
    },
  };
}

function validateRunTitleModel(model: unknown): Result<RunTitleModel> {
  if (typeof model !== "object" || model === null)
    return invalid("run_title_model", "model", "Choose a provider instance and model.");
  return validateModelReference(model, "model");
}

/** A provider instance, model and thinking options without an environment, addressed at `prefix`. */
export function validateModelReference(model: object, prefix: string): Result<RunTitleModel> {
  const providerInstanceId = parseExecutionReference(
    model,
    "providerInstanceId",
    "invalid_provider",
    "Choose a provider instance.",
    prefix,
  );
  if (!providerInstanceId.ok) return providerInstanceId;
  const modelId = parseExecutionReference(
    model,
    "modelId",
    "invalid_model",
    "Choose a model.",
    prefix,
  );
  if (!modelId.ok) return modelId;
  const modelOptions = parseModelOptions(model, prefix);
  if (!modelOptions.ok) return modelOptions;
  return {
    ok: true,
    value: {
      providerInstanceId: providerInstanceId.value,
      modelId: modelId.value,
      modelOptions: modelOptions.value,
    },
  };
}

/**
 * The setting's shape only; whether T3 offers the model is checked against the live catalog.
 * Turning it on needs a model, while a disabled setting may keep one or none.
 */
export function validateUpdateRunTitleSetting(input: unknown): Result<UpdateRunTitleSettingInput> {
  const fields =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  if (typeof fields.enabled !== "boolean")
    return invalid("run_title_enabled", "enabled", "Say whether Generate Run titles is on.");
  if (fields.model === null || fields.model === undefined)
    return fields.enabled
      ? invalid(
          "run_title_model",
          "model",
          "Choose a provider instance and model before turning on Generate Run titles.",
        )
      : { ok: true, value: { enabled: false, model: null } };
  const model = validateRunTitleModel(fields.model);
  if (!model.ok) return model;
  return { ok: true, value: { enabled: fields.enabled, model: model.value } };
}

/**
 * The revision content every Agent create and save writes. Structural save validation is
 * deliberately separate from T3 capability availability.
 */
function validateAgentContent(input: unknown): Result<UpdateAgentContent> {
  const name = parseTrimmedString(
    typeof input === "object" && input !== null && "name" in input ? input.name : undefined,
    "name",
    200,
    "invalid_name",
    "Enter an Agent name between 1 and 200 characters.",
  );
  if (!name.ok) return name;
  const prompt = parseTrimmedString(
    typeof input === "object" && input !== null && "prompt" in input ? input.prompt : undefined,
    "prompt",
    120_000,
    "invalid_prompt",
    "Enter a prompt up to 120,000 characters.",
  );
  if (!prompt.ok) return prompt;
  const execution = parseExecution(input);
  if (!execution.ok) return execution;
  const exits = parseAgentExits(
    typeof input === "object" && input !== null && "exits" in input ? input.exits : undefined,
  );
  if (!exits.ok) return exits;
  return {
    ok: true,
    value: {
      name: name.value,
      prompt: prompt.value,
      execution: execution.value,
      exits: exits.value,
    },
  };
}

export function validateCreateAgent(input: unknown): Result<CreateAgentInput> {
  const content = validateAgentContent(input);
  if (!content.ok) return content;
  const projectId = parseOwningProject(input);
  if (!projectId.ok) return projectId;
  return { ok: true, value: { ...content.value, projectId: projectId.value } };
}

export function validateUpdateAgent(input: unknown): Result<UpdateAgentInput> {
  const revision =
    typeof input === "object" && input !== null && "expectedRevision" in input
      ? input.expectedRevision
      : undefined;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Include the revision you opened before saving.",
        issues: [
          {
            code: "invalid_revision",
            path: "expectedRevision",
            message: "Include the revision you opened before saving.",
          },
        ],
      },
    };
  }
  const expectedProjectId = parseExpectedOwner(input);
  if (!expectedProjectId.ok) return expectedProjectId;
  const content = validateAgentContent(input);
  if (!content.ok) return content;
  return {
    ok: true,
    value: {
      expectedRevision: revision,
      expectedProjectId: expectedProjectId.value,
      ...content.value,
    },
  };
}

export function validateDuplicateAgent(input: unknown): Result<DuplicateAgentInput> {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object") {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Send a name or an empty object to duplicate.",
        issues: [
          {
            code: "invalid_body",
            path: "",
            message: "Send a name or an empty object to duplicate.",
          },
        ],
      },
    };
  }
  const projectId = parseTargetOwner(input);
  if (!projectId.ok) return projectId;
  const target = projectId.value === undefined ? {} : { projectId: projectId.value };
  if (!("name" in input) || input.name === undefined) return { ok: true, value: target };
  const name = parseTrimmedString(
    input.name,
    "name",
    200,
    "invalid_name",
    agentNameIssue().message,
  );
  if (!name.ok) return name;
  return { ok: true, value: { name: name.value, ...target } };
}
