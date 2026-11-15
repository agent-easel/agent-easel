/** Model options against a live catalog model: which values it accepts and the values a choice starts with. */
import type {
  AgentExecutionSettings,
  AgentModelCapability,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  AgentSettingAvailability,
} from "@t3-factory/contracts";

/** Whether the catalog model offers this option with the selected value. */
export function optionAvailability(
  model: AgentModelCapability | undefined,
  selected: AgentModelOptionValue,
): AgentSettingAvailability {
  const descriptor = model?.options?.find((entry) => entry.id === selected.id);
  if (!descriptor) return "unavailable";
  if (descriptor.values)
    return descriptor.values.includes(selected.value) ? "available" : "unavailable";
  if (descriptor.type === "boolean")
    return typeof selected.value === "boolean" ? "available" : "unavailable";
  if (typeof selected.value !== "string") return "unavailable";
  return descriptor.choices?.some((choice) => choice.id === selected.value)
    ? "available"
    : "unavailable";
}

export function optionValue(
  options: readonly AgentModelOptionValue[],
  descriptor: AgentModelOptionDescriptor,
) {
  const selected = options.find((entry) => entry.id === descriptor.id);
  if (selected) return selected.value;
  if (descriptor.default !== undefined) return descriptor.default;
  if (descriptor.values) return descriptor.values[0] ?? "";
  if (descriptor.type === "boolean") return false;
  return descriptor.choices?.[0]?.id ?? "";
}

export function buildOptions(
  descriptors: readonly AgentModelOptionDescriptor[] | undefined,
  current: readonly AgentModelOptionValue[],
): AgentModelOptionValue[] {
  if (!descriptors?.length) return [];
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    value: optionValue(current, descriptor),
  }));
}

/**
 * The selection of a catalog model for an imported model hint: the hint's options the model
 * accepts are kept, its other options take their defaults, and the hint's remaining options are
 * dropped.
 */
export function hintedSelection(
  choice: Pick<AgentExecutionSettings, "environmentId" | "providerInstanceId">,
  model: AgentModelCapability,
  hintOptions: readonly AgentModelOptionValue[],
): { selection: AgentExecutionSettings; droppedOptions: AgentModelOptionValue[] } {
  const accepted = (option: AgentModelOptionValue) =>
    optionAvailability(model, option) === "available";
  return {
    selection: {
      ...choice,
      modelId: model.id,
      modelOptions: buildOptions(model.options, hintOptions.filter(accepted)),
    },
    droppedOptions: hintOptions.filter((option) => !accepted(option)),
  };
}
