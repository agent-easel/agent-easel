import { useEffect, useState } from "react";
import type {
  ChatModelKeyChange,
  ChatModelProviderKind,
  ChatModelSettings,
  UpdateChatModelInput,
} from "@agent-easel/contracts";
import { validateChatModelBaseUrl } from "@agent-easel/domain-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChoiceMenu } from "@/components/choice-menu";
import { StatusBadge } from "@/components/status-badge";
import { api } from "../api.ts";
import { reportChatModelSettings } from "../chat-control-attention.ts";
import { dayAndTime } from "../time-format.ts";
import { useSettingsDraftGuard } from "./settings-draft-guard.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsGroup, SettingsDetailRow } from "./settings-page.tsx";
import {
  ChatControlPage,
  chatControlError,
  FieldRow,
  SaveActions,
  SecretField,
  secretInputShown,
  useChatControlSection,
  type MovedSecretChoice,
  type SaveFailure,
} from "./chat-control-form.tsx";
import { fieldAria, type FieldState } from "./field-state.ts";

const providerChoices = [
  { id: "openai-compatible", label: "OpenAI-compatible" },
  { id: "anthropic", label: "Anthropic" },
];

interface Draft {
  readonly providerKind: ChatModelProviderKind | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly keyChoice: MovedSecretChoice;
  /** A new key; blank keeps whatever the key choice says. Held only in memory. */
  readonly keyValue: string;
}

const draftOf = ({ configuration }: ChatModelSettings): Draft => ({
  providerKind: configuration.providerKind,
  baseUrl: configuration.baseUrl ?? "",
  model: configuration.model ?? "",
  keyChoice: "keep",
  keyValue: "",
});

const destinationChanged = (draft: Draft, { configuration }: ChatModelSettings) =>
  draft.providerKind !== configuration.providerKind ||
  (draft.baseUrl.trim() || null) !== configuration.baseUrl;

/** Whether the destination changed while a key is stored, so the owner must decide about it. */
const keyDecisionNeeded = (draft: Draft, settings: ChatModelSettings) =>
  settings.configuration.keyConfigured && destinationChanged(draft, settings);

/** The key change this draft asks for, or null while a required decision is missing. */
function keyChange(draft: Draft, settings: ChatModelSettings): ChatModelKeyChange | null {
  const value = draft.keyValue.trim();
  if (!settings.configuration.keyConfigured)
    return value ? { kind: "replace", value } : { kind: "keep" };
  if (draft.keyChoice === "replace") return value ? { kind: "replace", value } : null;
  if (keyDecisionNeeded(draft, settings))
    return draft.keyChoice === "keep" ? null : { kind: draft.keyChoice };
  return draft.keyChoice === "reuse" ? { kind: "keep" } : { kind: draft.keyChoice };
}

function isDirty(draft: Draft, settings: ChatModelSettings) {
  const saved = draftOf(settings);
  return (
    destinationChanged(draft, settings) ||
    draft.model.trim() !== saved.model ||
    draft.keyValue.trim() !== "" ||
    draft.keyChoice === "remove"
  );
}

const saveInput = (
  draft: Draft,
  settings: ChatModelSettings,
  key: ChatModelKeyChange,
): UpdateChatModelInput => ({
  revision: settings.configuration.revision,
  providerKind: draft.providerKind,
  baseUrl: draft.baseUrl.trim() || null,
  model: draft.model.trim() || null,
  key,
});

/** Whether the host already holds exactly this save, so a lost acknowledgement was a success. */
const committed = (input: UpdateChatModelInput, current: ChatModelSettings) =>
  current.configuration.revision === input.revision + 1 &&
  current.configuration.providerKind === input.providerKind &&
  current.configuration.baseUrl === input.baseUrl &&
  current.configuration.model === input.model;

const complete = ({ configuration }: ChatModelSettings) =>
  Boolean(configuration.providerKind && configuration.baseUrl && configuration.model);

/** The latest Test, when it is evidence for the saved revision. */
const currentTest = ({ latestTest, configuration }: ChatModelSettings) =>
  latestTest?.revision === configuration.revision ? latestTest : null;

// The provider refused the request because of the key (HTTP 401 or 403).
const keyRefused = (message: string) => /HTTP 40[13]\b/.test(message);

/** The page's saved settings and draft, with its save, Test and Discard actions. */
function useChatModelPage() {
  const section = useChatControlSection({
    read: api.getChatModelSettings,
    update: api.updateChatModelSettings,
    draftOf,
    committed,
    name: "the Language model settings",
  });
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const test = async (revision: number) => {
    setTesting(true);
    setTestError("");
    return await api
      .testChatModel({ revision })
      .then(section.setSettings)
      .catch((cause: unknown) => {
        setTestError(chatControlError(cause, "Factory could not run the Test."));
      })
      .finally(() => {
        setTesting(false);
      });
  };
  const { settings, draft } = section;
  useEffect(() => {
    if (settings) reportChatModelSettings(settings);
  }, [settings]);
  return {
    ...section,
    dirty: settings !== null && draft !== null && isDirty(draft, settings),
    testing,
    testError,
    test,
  };
}

/** The header badge: a current conversation failure first, then the Test, then setup. */
function ModelBadge({ settings, testing }: { settings: ChatModelSettings; testing: boolean }) {
  if (settings.needsAttention) return <StatusBadge kind="error">Not answering</StatusBadge>;
  if (testing) return <StatusBadge kind="checking">Testing</StatusBadge>;
  if (!complete(settings)) return <StatusBadge kind="neutral">Not set up</StatusBadge>;
  const test = currentTest(settings);
  if (!test) return null;
  return test.outcome === "succeeded" ? (
    <StatusBadge kind="success">Test passed</StatusBadge>
  ) : (
    <StatusBadge kind="error">Test failed</StatusBadge>
  );
}

// Field paths a refused save names, as the host reports them.
const REQUIRED_PATHS = ["providerKind", "baseUrl", "model"] as const;
type RequiredPath = (typeof REQUIRED_PATHS)[number];

const CARD = {
  baseUrl: "chat-model-base-url-problem",
  key: "chat-model-key-problem",
  test: "chat-model-test-problem",
  save: "chat-model-save-problem",
} as const;

/**
 * Settings → Chat control → Language model, host only. Save and Discard sit in the page header
 * with Test connection, which tests only the saved configuration.
 */
export function ChatModelSettings() {
  const page = useChatModelPage();
  const { settings, draft } = page;
  const decision = useSettingsDraftGuard("chat-model", page.dirty ? ["Language model"] : []);
  return (
    <ChatControlPage
      title="Language model"
      badge={settings && <ModelBadge settings={settings} testing={page.testing} />}
      actions={settings && draft && <ModelActions page={page} settings={settings} draft={draft} />}
      loadError={page.loadError}
      onRetry={page.reload}
      decision={decision}
    >
      {settings && draft ? (
        <ModelForm
          settings={settings}
          draft={draft}
          saving={page.saving}
          saveFailure={page.saveFailure}
          testError={page.testError}
          onChange={page.setDraft}
        />
      ) : null}
    </ChatControlPage>
  );
}

const baseUrlProblemOf = (draft: Draft) => {
  if (!draft.baseUrl.trim()) return "";
  const validated = validateChatModelBaseUrl(draft.baseUrl, draft.providerKind);
  return validated.ok ? "" : validated.error.message;
};

/** Discard, Test connection on the saved configuration only, then Save. */
function ModelActions({
  page,
  settings,
  draft,
}: {
  page: ReturnType<typeof useChatModelPage>;
  settings: ChatModelSettings;
  draft: Draft;
}) {
  const key = keyChange(draft, settings);
  const save =
    page.dirty && !baseUrlProblemOf(draft) && key !== null
      ? () => void page.save(saveInput(draft, settings, key))
      : undefined;
  return (
    <SaveActions dirty={page.dirty} saving={page.saving} onSave={save} onDiscard={page.discard}>
      <Button
        type="button"
        variant="outline"
        disabled={page.dirty || !complete(settings) || page.testing}
        onClick={() => void page.test(settings.configuration.revision)}
      >
        Test connection
      </Button>
    </SaveActions>
  );
}

/** Each field's problem state, wired to the card that explains it. */
function fieldStates(draft: Draft, settings: ChatModelSettings, saveFailure: SaveFailure | null) {
  const required = (path: RequiredPath): FieldState | undefined =>
    saveFailure?.paths.includes(path) ? { tone: "error", cardId: CARD.save } : undefined;
  const test = currentTest(settings);
  const decide = keyDecisionNeeded(draft, settings);
  const keyState = (): FieldState | undefined => {
    if (decide)
      return draft.keyChoice === "keep" ? { tone: "attention", cardId: CARD.key } : undefined;
    return test?.outcome === "failed" && keyRefused(test.message)
      ? { tone: "error", cardId: CARD.test }
      : undefined;
  };
  return {
    providerKind: required("providerKind"),
    baseUrl: baseUrlProblemOf(draft)
      ? ({ tone: "error", cardId: CARD.baseUrl } satisfies FieldState)
      : required("baseUrl"),
    model: required("model"),
    key: keyState(),
  };
}

const requiredTag = (state: FieldState | undefined) =>
  state && <StatusBadge kind="error">Required</StatusBadge>;

function ModelForm({
  settings,
  draft,
  saving,
  saveFailure,
  testError,
  onChange,
}: {
  settings: ChatModelSettings;
  draft: Draft;
  saving: boolean;
  saveFailure: SaveFailure | null;
  testError: string;
  onChange: (draft: Draft) => void;
}) {
  const states = fieldStates(draft, settings, saveFailure);
  const baseUrlProblem = baseUrlProblemOf(draft);
  return (
    <>
      <SettingsGroup label="Connection">
        <FieldRow
          label="Provider"
          htmlFor="chat-model-provider"
          tag={requiredTag(states.providerKind)}
        >
          <ChoiceMenu
            id="chat-model-provider"
            label="Provider"
            value={draft.providerKind ?? ""}
            choices={providerChoices}
            onChange={(id) => onChange({ ...draft, providerKind: id as ChatModelProviderKind })}
            disabled={saving}
            placeholder="Choose a provider"
            className="h-8 flex-1"
          />
        </FieldRow>
        <FieldRow
          label="Base URL"
          htmlFor="chat-model-base-url"
          tag={
            baseUrlProblem ? (
              <StatusBadge kind="error">Invalid</StatusBadge>
            ) : (
              requiredTag(states.baseUrl)
            )
          }
        >
          <Input
            id="chat-model-base-url"
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            disabled={saving}
            className="flex-1 bg-muted font-mono text-label"
            {...fieldAria(states.baseUrl?.cardId)}
            onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
          />
        </FieldRow>
        <FieldRow label="Model" htmlFor="chat-model-name" tag={requiredTag(states.model)}>
          <Input
            id="chat-model-name"
            value={draft.model}
            placeholder="Model name"
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
            className="flex-1 bg-muted font-mono text-label"
            {...fieldAria(states.model?.cardId)}
            onChange={(event) => onChange({ ...draft, model: event.target.value })}
          />
        </FieldRow>
        <KeyRow
          settings={settings}
          draft={draft}
          state={states.key}
          disabled={saving}
          onChange={onChange}
        />
        {settings.latestTest && (
          <SettingsDetailRow label="Last tested" value={dayAndTime(settings.latestTest.testedAt)} />
        )}
      </SettingsGroup>
      <ModelProblems
        settings={settings}
        draft={draft}
        baseUrlProblem={baseUrlProblem}
        saveFailure={saveFailure}
        testError={testError}
      />
    </>
  );
}

/** The API key; after an address change a stored key waits for the owner's choice. */
function KeyRow({
  settings,
  draft,
  state,
  disabled,
  onChange,
}: {
  settings: ChatModelSettings;
  draft: Draft;
  state: FieldState | undefined;
  disabled: boolean;
  onChange: (draft: Draft) => void;
}) {
  const field = {
    id: "chat-model-key",
    label: "API key",
    stored: settings.configuration.keyConfigured,
    value: draft.keyValue,
    placeholder: "Optional",
    state,
    tag:
      state?.tone === "attention" ? (
        <StatusBadge kind="attention">Choose</StatusBadge>
      ) : (
        state && <StatusBadge kind="error">Refused</StatusBadge>
      ),
    disabled,
    onChoice: (choice: MovedSecretChoice) =>
      onChange({ ...draft, keyChoice: choice, keyValue: "" }),
    onValue: (value: string) => onChange({ ...draft, keyValue: value }),
  };
  return (
    <FieldRow
      label="API key"
      htmlFor={secretInputShown({ ...field, choice: draft.keyChoice }) ? field.id : undefined}
    >
      {keyDecisionNeeded(draft, settings) ? (
        <SecretField {...field} destinationChanged choice={draft.keyChoice} />
      ) : (
        <SecretField {...field} choice={draft.keyChoice === "reuse" ? "keep" : draft.keyChoice} />
      )}
    </FieldRow>
  );
}

/** One card per current problem, each with its next step. */
function ModelProblems({
  settings,
  draft,
  baseUrlProblem,
  saveFailure,
  testError,
}: {
  settings: ChatModelSettings;
  draft: Draft;
  baseUrlProblem: string;
  saveFailure: SaveFailure | null;
  testError: string;
}) {
  const test = currentTest(settings);
  const { runtimeProblem } = settings;
  const requiredWhileOn = REQUIRED_PATHS.some((path) => saveFailure?.paths.includes(path));
  return (
    <>
      {baseUrlProblem && (
        <ProblemCard id={CARD.baseUrl} tone="error" title="Base URL isn’t valid">
          {baseUrlProblem}
        </ProblemCard>
      )}
      {keyDecisionNeeded(draft, settings) && draft.keyChoice === "keep" && (
        <ProblemCard id={CARD.key} tone="attention" title="Send the stored key to the new address?">
          Use the stored key there, replace it, or send no key.
        </ProblemCard>
      )}
      {saveFailure && (
        <ProblemCard
          id={CARD.save}
          tone="error"
          title="Couldn’t save"
          details={requiredWhileOn ? undefined : saveFailure.message}
        >
          {requiredWhileOn
            ? "Chat control is On, so the provider, base URL and model are required. Turn it off first to remove them."
            : "Your edits are kept. Save again."}
        </ProblemCard>
      )}
      {test?.outcome === "failed" && (
        <ProblemCard
          id={CARD.test}
          tone="error"
          title="The test failed"
          details={[
            ["When", dayAndTime(test.testedAt)],
            ["Revision", String(test.revision)],
          ]}
        >
          {test.message}
        </ProblemCard>
      )}
      {testError && (
        <ProblemCard tone="error" title="Couldn’t run the test" details={testError}>
          Try again.
        </ProblemCard>
      )}
      {settings.needsAttention && runtimeProblem && (
        <ProblemCard
          tone="error"
          title="Chat replies are failing"
          details={[
            ["When", dayAndTime(runtimeProblem.occurredAt)],
            ["Revision", String(runtimeProblem.revision)],
            ["Error", runtimeProblem.message],
          ]}
        >
          The provider didn’t answer. This clears after the next reply.
        </ProblemCard>
      )}
    </>
  );
}
