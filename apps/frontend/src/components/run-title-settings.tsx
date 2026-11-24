import { useEffect, useId, useState } from "react";
import { Unplug } from "lucide-react";
import type {
  AgentCapabilities,
  AgentModelCapability,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  AgentProviderCapability,
  RunTitleDiagnostic,
  RunTitleModel,
  RunTitleSetting,
  UpdateRunTitleSettingInput,
} from "@agent-easel/contracts";
import { buildOptions, optionAvailability, optionValue } from "@agent-easel/domain-validation";
import { ChoiceMenu } from "@/components/choice-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "../api.ts";
import { MutationGate } from "../client-gate.tsx";
import { useClientScope } from "../client-scope.ts";
import { useSettingsNavigation } from "../settings-navigation.ts";
import { ModelOptionSelect } from "./execution-settings-fields.tsx";
import { modelOptionChoices } from "@/lib/agent-display";
import { dayAndTime } from "../time-format.ts";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsDetailRow, SettingsGroup, SettingsPage, SettingsRow } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";

const rowChoiceClass = "h-8 w-55";

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof ApiError
    ? [cause.message, ...cause.detail.issues.map((issue) => issue.message)].join(" ")
    : cause instanceof Error
      ? cause.message
      : fallback;

function useTitleSetting() {
  const [setting, setSetting] = useState<RunTitleSetting | null>(null);
  const [catalog, setCatalog] = useState<AgentCapabilities | null>();
  const [loadError, setLoadError] = useState("");
  const [loads, setLoads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    let active = true;
    api.getRunTitleSetting().then(
      (value) => active && setSetting(value),
      (cause: unknown) =>
        active && setLoadError(errorMessage(cause, "Factory could not read Run titles.")),
    );
    api.getAgentCapabilities().then(
      (value) => active && setCatalog(value),
      () => active && setCatalog(null),
    );
    return () => {
      active = false;
    };
  }, [loads]);
  const save = (next: UpdateRunTitleSettingInput) => {
    setSaving(true);
    setSaveError("");
    return api
      .updateRunTitleSetting(next)
      .then((value) => {
        setSetting(value);
        return true;
      })
      .catch((cause: unknown) => {
        setSaveError(errorMessage(cause, "Factory could not save Run titles."));
        return false;
      })
      .finally(() => setSaving(false));
  };
  const retry = () => {
    setLoadError("");
    setLoads((n) => n + 1);
  };
  return {
    setting,
    catalog,
    loadError,
    saveError,
    saving,
    save,
    retry,
    clearSaveError: () => setSaveError(""),
  };
}

export function RunTitleSettings() {
  const host = useClientScope() === "host";
  const { setting, catalog, loadError, saveError, saving, save, retry, clearSaveError } =
    useTitleSetting();
  const [enableDraft, setEnableDraft] = useState(false);
  const providers = catalog?.state === "ready" ? catalog.providers : null;
  const worker = titleWorker(providers, setting?.model);
  const toggle = (enabled: boolean) => {
    if (!setting) return;
    clearSaveError();
    if (enabled && !worker.model) setEnableDraft(true);
    else {
      setEnableDraft(false);
      if (setting.enabled !== enabled) void save({ enabled, model: setting.model });
    }
  };
  if (loadError) return <TitleReadError error={loadError} retry={retry} />;
  const checking = !setting || catalog === undefined;
  return (
    <SettingsPage
      title="Run titles"
      hostManaged={!host && !checking}
      badge={<TitleSettingBadge checking={checking} unsaved={enableDraft && !setting?.enabled} />}
    >
      {setting &&
        (host ? (
          <MutationGate>
            <HostTitleFields
              enabled={setting.enabled || enableDraft}
              saved={setting.model}
              worker={worker}
              providers={providers}
              catalogRead={catalog !== undefined}
              saving={saving}
              onToggle={toggle}
              onModelChange={(model) =>
                void save({ enabled: true, model }).then((saved) => {
                  if (saved) setEnableDraft(false);
                })
              }
            />
          </MutationGate>
        ) : (
          <ReadOnlyTitles setting={setting} providers={providers ?? []} />
        ))}
      {saveError && (
        <ProblemCard tone="error" title="Couldn’t save Run titles" details={saveError}>
          The saved setting is unchanged. Try again in a moment.
        </ProblemCard>
      )}
      {setting?.diagnostic && <LatestResult diagnostic={setting.diagnostic} />}
    </SettingsPage>
  );
}

function TitleReadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <SettingsPage title="Run titles" action={<Button onClick={retry}>Try again</Button>}>
      <ProblemCard tone="error" title="Couldn’t read Run titles" details={error} />
    </SettingsPage>
  );
}

function TitleSettingBadge({ checking, unsaved }: { checking: boolean; unsaved: boolean }) {
  if (unsaved) return <StatusBadge kind="neutral">Not saved yet</StatusBadge>;
  return checking ? <StatusBadge kind="checking">Checking</StatusBadge> : null;
}

function titleWorker(
  providers: readonly AgentProviderCapability[] | null,
  saved: RunTitleModel | null | undefined,
) {
  const provider = providers?.find(
    (entry) => entry.reporting.supported && entry.providerInstanceId === saved?.providerInstanceId,
  );
  const offered = provider?.models.find((entry) => entry.id === saved?.modelId);
  const valid = saved?.modelOptions.every(
    (option) => optionAvailability(offered, option) === "available",
  );
  return { provider, model: valid ? offered : undefined };
}

function HostTitleFields({
  enabled,
  saved,
  worker: { provider, model },
  providers,
  catalogRead,
  saving,
  onToggle,
  onModelChange,
}: {
  enabled: boolean;
  saved: RunTitleModel | null;
  worker: {
    provider: AgentProviderCapability | undefined;
    model: AgentModelCapability | undefined;
  };
  providers: readonly AgentProviderCapability[] | null;
  catalogRead: boolean;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onModelChange: (model: RunTitleModel) => void;
}) {
  const showWorker = enabled || saved !== null;
  const needsModel = Boolean(providers && saved && !model);
  const problemId = useId();
  return (
    <>
      <SettingsGroup label="Generation">
        <SettingsRow
          title="Generate Run titles"
          control={(text) => (
            <Switch
              aria-labelledby={text.title}
              checked={enabled}
              disabled={saving}
              onCheckedChange={onToggle}
            />
          )}
        />
        {showWorker && (
          <WorkerRows
            provider={provider}
            model={model}
            saved={saved}
            providers={providers}
            editable={enabled && !saving && providers !== null}
            problemId={needsModel ? problemId : undefined}
            onModelChange={onModelChange}
          />
        )}
      </SettingsGroup>
      {showWorker && catalogRead && !providers && <TitleConnectionProblem />}
      {needsModel && (
        <ProblemCard id={problemId} tone="attention" title="Run titles need a model">
          New Runs keep their first line as the title until you choose one.
        </ProblemCard>
      )}
    </>
  );
}

function WorkerRows({
  provider,
  model,
  saved,
  providers,
  editable,
  problemId,
  onModelChange,
}: {
  provider: AgentProviderCapability | undefined;
  model: AgentModelCapability | undefined;
  saved: RunTitleModel | null;
  providers: readonly AgentProviderCapability[] | null;
  editable: boolean;
  problemId: string | undefined;
  onModelChange: (model: RunTitleModel) => void;
}) {
  const chooseProvider = (id: string) => {
    const first = providers?.find((entry) => entry.providerInstanceId === id)?.models[0];
    if (first)
      onModelChange({
        providerInstanceId: id,
        modelId: first.id,
        modelOptions: buildOptions(first.options, []),
      });
  };
  const chooseModel = (id: string) => {
    const next = provider?.models.find((entry) => entry.id === id);
    if (saved && next)
      onModelChange({
        ...saved,
        modelId: next.id,
        modelOptions: buildOptions(
          next.options,
          saved.modelOptions.filter((option) => optionAvailability(next, option) === "available"),
        ),
      });
  };
  return (
    <>
      <SettingsRow
        title={workerLabel("Provider", !editable)}
        control={
          <ChoiceMenu
            id="run-title-provider"
            label="Provider"
            value={provider?.providerInstanceId ?? ""}
            choices={providerChoices(providers ?? [])}
            onChange={chooseProvider}
            disabled={!editable}
            placeholder={providers ? "Choose a provider" : "—"}
            empty="T3 offers no providers"
            className={rowChoiceClass}
          />
        }
      />
      <SettingsRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            {workerLabel("Model", !editable || !provider)}
            {problemId && <StatusBadge kind="attention">Needs a model</StatusBadge>}
          </span>
        }
        control={
          <ChoiceMenu
            id="run-title-model"
            label="Model"
            value={model?.id ?? ""}
            choices={(provider?.models ?? []).map((entry) => ({
              id: entry.id,
              label: entry.label ?? entry.id,
            }))}
            onChange={chooseModel}
            disabled={!editable || !provider}
            placeholder={provider || problemId ? "Choose a model" : "—"}
            describedBy={problemId}
            className={rowChoiceClass}
          />
        }
      />
      {saved &&
        model?.options?.map((descriptor) => (
          <OptionRow
            key={descriptor.id}
            descriptor={descriptor}
            model={saved}
            editable={editable}
            onChange={(value) =>
              onModelChange({
                ...saved,
                modelOptions: [
                  ...saved.modelOptions.filter((option) => option.id !== descriptor.id),
                  { id: descriptor.id, value },
                ],
              })
            }
          />
        ))}
    </>
  );
}

function workerLabel(name: string, disabled: boolean) {
  return <span className={disabled ? "text-muted-foreground" : undefined}>{name}</span>;
}

function TitleConnectionProblem() {
  const openSettings = useSettingsNavigation();
  return (
    <ProblemCard
      tone="neutral"
      icon={Unplug}
      title="Factory can’t reach T3"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openSettings({ tab: "connection" })}
        >
          Open T3 connection
        </Button>
      }
    >
      Provider and model choices load once T3 is connected.
    </ProblemCard>
  );
}

function providerChoices(providers: readonly AgentProviderCapability[]) {
  return providers
    .map((entry) => ({
      id: entry.providerInstanceId,
      label: entry.displayName ?? entry.providerInstanceId,
      disabled: !entry.reporting.supported || entry.models.length === 0,
      ...(!entry.reporting.supported ? { badge: "No Factory reporting" } : {}),
    }))
    .sort((left, right) => Number(left.disabled) - Number(right.disabled));
}

function OptionRow({
  descriptor,
  model,
  editable,
  onChange,
}: {
  descriptor: AgentModelOptionDescriptor;
  model: RunTitleModel;
  editable: boolean;
  onChange: (value: AgentModelOptionValue["value"]) => void;
}) {
  const value = optionValue(model.modelOptions, descriptor);
  const disabled = !editable || (descriptor.values !== undefined && descriptor.values.length < 2);
  return (
    <SettingsRow
      title={
        <span className={disabled ? "text-muted-foreground" : undefined}>{descriptor.label}</span>
      }
      control={(text) =>
        descriptor.type === "boolean" ? (
          <Switch
            aria-labelledby={text.title}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={onChange}
          />
        ) : (
          <ModelOptionSelect
            id={`run-title-option-${descriptor.id}`}
            label={descriptor.label}
            descriptor={descriptor}
            value={value}
            onChange={onChange}
            saving={disabled}
            className={rowChoiceClass}
          />
        )
      }
    />
  );
}

function ReadOnlyTitles({
  setting,
  providers,
}: {
  setting: RunTitleSetting;
  providers: readonly AgentProviderCapability[];
}) {
  const provider = providers.find(
    (entry) => entry.providerInstanceId === setting.model?.providerInstanceId,
  );
  const model = provider?.models.find((entry) => entry.id === setting.model?.modelId);
  const options = setting.model?.modelOptions ?? [];
  const names =
    model?.options?.flatMap((descriptor) => {
      const option = options.find((item) => item.id === descriptor.id);
      if (!option || optionAvailability(model, option) !== "available") return [];
      if (descriptor.type === "boolean") return option.value ? [descriptor.label] : [];
      return [
        modelOptionChoices(descriptor).find(
          ({ id }) =>
            id === (descriptor.values ? JSON.stringify(option.value) : String(option.value)),
        )?.label ?? String(option.value),
      ];
    }) ?? [];
  return (
    <SettingsGroup label="Generation">
      <SettingsDetailRow label="Generate Run titles" value={setting.enabled ? "On" : "Off"} />
      <SettingsDetailRow
        label="Worker"
        value={
          model
            ? [provider?.displayName, model.label, ...names].filter(Boolean).join(" · ") || "—"
            : "—"
        }
      />
    </SettingsGroup>
  );
}

const diagnosticOutcomes: Record<RunTitleDiagnostic["outcome"], string> = {
  skipped: "Title generation was skipped",
  failed: "Title generation failed",
  "timed-out": "Title generation timed out",
};

function LatestResult({ diagnostic }: { diagnostic: RunTitleDiagnostic }) {
  const run = diagnostic.runNumber === null ? "A Run" : `Run #${diagnostic.runNumber}`;
  return (
    <ProblemCard
      tone="neutral"
      title={`${run} kept its first-line title`}
      details={diagnostic.message}
    >
      {diagnosticOutcomes[diagnostic.outcome]} · {dayAndTime(diagnostic.recordedAt)}
    </ProblemCard>
  );
}
