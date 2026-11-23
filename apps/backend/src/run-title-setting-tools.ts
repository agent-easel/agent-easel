import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import type { FactoryOperations } from "@t3-factory/contracts";
import { answerDefinitionCall, toolArguments } from "./authoring-tools.ts";

export type RunTitleSettingOperations = Pick<
  FactoryOperations,
  "getRunTitleSetting" | "updateRunTitleSetting"
>;

const modelSchema = {
  type: ["object", "null"],
  description:
    "The T3 provider instance, model and options for title threads, with ids from factory_get_agent_capabilities: a provider instance with reporting.supported, one of its models and the model option values (an empty list when choosing none). null keeps no model, which is allowed only when enabled is false.",
  properties: {
    providerInstanceId: { type: "string" },
    modelId: { type: "string" },
    modelOptions: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, value: { type: ["string", "boolean"] } },
        required: ["id", "value"],
      },
    },
  },
  required: ["providerInstanceId", "modelId", "modelOptions"],
};

export const runTitleSettingTools: Tool[] = [
  {
    name: "factory_get_run_title_setting",
    description:
      "Read Factory's installation-wide Generate Run titles setting from its stored records: host-local and inspect-only, it needs no Block id, changes nothing and never contacts T3. The reply has enabled, model (providerInstanceId, modelId and modelOptions, or null when none is chosen; a disabled setting keeps its model) and diagnostic (the latest title generation that skipped, failed or timed out, with its Run, outcome, message and time, or null). To find a model T3 offers, read factory_get_agent_capabilities. A model in the setting may no longer be offered by T3; only enabling checks the live catalog.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "factory_update_run_title_setting",
    description:
      "Change Generate Run titles, the installation-wide setting that decides whether every Run started from now on gets a generated title and which T3 model writes it. This is a change, not a read: while enabled, each future automatic Run starts one title thread on this model and spends its provider budget; the setting is captured at each Run's Start, so Runs already started keep what they captured, and Settings → Run titles and factory_get_run_title_setting show the saved value. Call it only when the user asked for this change, with the provider instance, model and options from factory_get_agent_capabilities. Enabling checks the choice against the live T3 catalog and a provider whose harness cannot report to Factory is refused; a rejected choice returns the validation issues and leaves the setting unchanged. enabled false keeps the chosen model unless model is null. The reply is the saved setting.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Whether future Runs get a generated title." },
        model: modelSchema,
      },
      required: ["enabled", "model"],
      additionalProperties: false,
    },
  },
];

const updateSteps: Partial<Record<string, string>> = {
  validation:
    "The setting is unchanged. Explain the issues to the user and choose another provider instance, model or options from factory_get_agent_capabilities; do not retry the same choice.",
  capabilities_unavailable:
    "The setting is unchanged because Factory could not read T3's catalog, so the choice was not judged. Tell the user, and call this tool again with the same arguments once T3 is reachable.",
};

export async function callRunTitleSettingTool(
  factory: RunTitleSettingOperations,
  name: string,
  args: unknown,
): Promise<CallToolResult | undefined> {
  if (name === "factory_get_run_title_setting")
    return answerDefinitionCall({}, () => factory.getRunTitleSetting());
  if (name === "factory_update_run_title_setting")
    return answerDefinitionCall(updateSteps, () =>
      factory.updateRunTitleSetting(toolArguments(args)),
    );
  return undefined;
}
