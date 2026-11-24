import { useId, type ReactNode } from "react";
import { optionValue } from "@agent-easel/domain-validation";
import type { AgentDraftModel, AgentDraftSnapshot } from "../agent-draft.ts";
import type {
  AgentExecutionSettings,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
} from "@agent-easel/contracts";
import { Switch } from "@/components/ui/switch";
import { Surface } from "@/components/ui/surface";
import { ChoiceMenu, type MenuChoice } from "@/components/choice-menu";
import { modelOptionChoices } from "@/lib/agent-display";

type ExecutionSettingsState = AgentDraftSnapshot["choices"] &
  Pick<AgentDraftModel, "setEnvironmentId" | "chooseProvider" | "chooseModel" | "setOption"> & {
    readonly execution: AgentExecutionSettings;
  };

/** A select's trigger inside a Worker row (Figma Settings/Select). */
const rowSelectClass = "h-8 w-45 shrink-0 bg-card px-3 text-sm";

/**
 * Figma SA06e: the Worker's fields as one bordered group of label/control rows — Environment,
 * Provider, Model, then the model's options. A field stays disabled until its parent is chosen,
 * and without a model no option rows are shown. `leading` rows, such as an override's Project,
 * come first.
 */
export function ExecutionSettingsFields({
  role,
  settings,
  saving,
  leading,
}: {
  /** The Agent's own Worker, or one Project override's settings in its dialog. */
  role: "worker" | "override";
  settings: ExecutionSettingsState;
  saving: boolean;
  leading?: ReactNode;
}) {
  const { execution, environments, providers, selectedProvider, selectedModel } = settings;
  // An override's fields sit in a dialog over the Worker's, so their ids must differ.
  const idPrefix = role === "worker" ? "worker" : "override";
  // A provider without Factory reporting cannot run a Block, so it sits disabled at the bottom.
  const providerChoices = [
    ...providers.filter((entry) => entry.reporting.supported),
    ...providers.filter((entry) => !entry.reporting.supported),
  ].map((entry): MenuChoice => ({
    id: entry.providerInstanceId,
    label: entry.displayName ?? "Unknown provider",
    ...(entry.reporting.supported
      ? {}
      : { badge: "No Factory reporting", badgeKind: "neutral", disabled: true }),
  }));
  return (
    <Surface tone="group">
      {leading}
      <SelectRow
        id={`${idPrefix}-environment`}
        label="Environment"
        value={execution.environmentId}
        onChange={settings.setEnvironmentId}
        disabled={saving}
        choices={environments.map((entry) => ({ id: entry.environmentId, label: entry.label }))}
      />
      <SelectRow
        id={`${idPrefix}-provider`}
        label="Provider"
        value={execution.providerInstanceId}
        onChange={settings.chooseProvider}
        disabled={saving || !execution.environmentId}
        choices={providerChoices}
      />
      <SelectRow
        id={`${idPrefix}-model`}
        label="Model"
        value={execution.modelId}
        onChange={settings.chooseModel}
        disabled={saving || !execution.providerInstanceId}
        choices={(selectedProvider?.models ?? []).map((entry) => ({
          id: entry.id,
          label: entry.label ?? entry.id,
        }))}
      />
      {execution.modelId &&
        (selectedModel?.options ?? []).map((descriptor) => (
          <ModelOptionRow
            key={descriptor.id}
            id={`${idPrefix}-option-${descriptor.id}`}
            descriptor={descriptor}
            options={execution.modelOptions}
            onChange={(value) => settings.setOption(descriptor.id, value)}
            saving={saving}
          />
        ))}
    </Surface>
  );
}

/** One label/control row of the Worker group. */
function WorkerRow({
  label,
  labelId,
  htmlFor,
  children,
}: {
  label: string;
  labelId: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5 pr-1.5 pl-3">
      <label id={labelId} htmlFor={htmlFor} className="min-w-0 flex-1 text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A Worker row with a select; it is disabled with nothing to choose. */
export function SelectRow({
  id,
  label,
  value,
  onChange,
  disabled,
  choices,
  placeholder = "Choose…",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  choices: readonly MenuChoice[];
  placeholder?: string;
}) {
  return (
    <WorkerRow label={label} labelId={`${id}-label`} htmlFor={id}>
      <ChoiceMenu
        id={id}
        label={label}
        value={value}
        choices={choices}
        onChange={onChange}
        disabled={disabled || !choices.length}
        placeholder={placeholder}
        className={rowSelectClass}
      />
    </WorkerRow>
  );
}

/** One model option as a row: a switch for an on/off option, otherwise a select. */
function ModelOptionRow({
  id,
  descriptor,
  options,
  onChange,
  saving,
}: {
  id: string;
  descriptor: AgentModelOptionDescriptor;
  options: readonly AgentModelOptionValue[];
  onChange: (value: AgentModelOptionValue["value"]) => void;
  saving: boolean;
}) {
  const value = optionValue(options, descriptor);
  return (
    <WorkerRow label={descriptor.label} labelId={`${id}-label`} htmlFor={id}>
      {descriptor.type === "boolean" ? (
        <Switch
          id={id}
          className="mr-1.5"
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={saving || (descriptor.values !== undefined && descriptor.values.length < 2)}
        />
      ) : (
        <ModelOptionSelect
          id={id}
          label={descriptor.label}
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          saving={saving}
          className={rowSelectClass}
        />
      )}
    </WorkerRow>
  );
}

/** One model option: its label above a select, or beside a switch for an on/off option. */
export function ModelOptionField({
  id,
  label,
  descriptor,
  options,
  onChange,
  saving,
}: {
  id: string;
  label: string;
  descriptor: AgentModelOptionDescriptor;
  options: readonly AgentModelOptionValue[];
  onChange: (value: AgentModelOptionValue["value"]) => void;
  saving: boolean;
}) {
  const labelId = useId();
  const value = optionValue(options, descriptor);
  if (descriptor.type === "boolean")
    return (
      <div className="flex items-center gap-2">
        <label id={labelId} htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={saving || (descriptor.values !== undefined && descriptor.values.length < 2)}
        />
      </div>
    );
  return (
    <div className="grid gap-1.5">
      <label id={labelId} htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <ModelOptionSelect
        id={id}
        label={label}
        descriptor={descriptor}
        value={value}
        onChange={onChange}
        saving={saving}
      />
    </div>
  );
}

export function ModelOptionSelect({
  id,
  label,
  descriptor,
  value,
  onChange,
  saving,
  className,
}: {
  id: string;
  label: string;
  descriptor: AgentModelOptionDescriptor;
  value: AgentModelOptionValue["value"];
  onChange: (value: AgentModelOptionValue["value"]) => void;
  saving: boolean;
  className?: string;
}) {
  const { values } = descriptor;
  // Published value domains may mix types (e.g. [false, "auto"]); JSON keeps each typed.
  const key = values ? JSON.stringify(value) : String(value);
  return (
    <ChoiceMenu
      id={id}
      label={label}
      value={key}
      choices={modelOptionChoices(descriptor)}
      onChange={(next) => onChange(values ? (JSON.parse(next) as string | boolean) : next)}
      disabled={saving}
      placeholder="Choose…"
      {...(className ? { className } : {})}
    />
  );
}
