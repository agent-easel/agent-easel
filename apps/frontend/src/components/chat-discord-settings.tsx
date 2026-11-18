import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Unplug } from "lucide-react";
import type {
  DiscordCheckOutcome,
  DiscordSettings,
  DiscordTokenChange,
  UpdateDiscordConnectionInput,
} from "@t3-factory/contracts";
import { validateDiscordPublicKey } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "../api.ts";
import { chatControlBlocker, type ChatControlBlocker } from "../chat-control-switch.ts";
import { useRefreshSchedule } from "../refresh-schedule.ts";
import { reportDiscordSettings } from "../chat-control-attention.ts";
import { useSettingsOptions } from "../settings-navigation.ts";
import {
  AccessCard,
  firstGrants,
  useAccessSection,
  type AccessTestAction,
} from "./chat-discord-access.tsx";
import { DeliveryCard } from "./chat-discord-delivery.tsx";
import { CopyButton } from "./copy-button.tsx";
import { dayAndTime } from "./execution-state.tsx";
import { useSettingsDraftGuard } from "./settings-draft-guard.tsx";
import { SettingsGroup, SettingsProblemCard, SettingsRow } from "./settings-page.tsx";
import {
  ChatControlPage,
  chatControlError,
  fieldAria,
  FieldRow,
  SaveActions,
  SecretField,
  technicalDetails,
  useChatControlSection,
  type FieldState,
  type SecretChoice,
} from "./chat-control-form.tsx";

/** The setup steps live in the documentation; the page links them until the first passing check. */
const SETUP_GUIDE_URL =
  "https://github.com/alimek/t3-factory/blob/main/docs/chat-control.md#setting-up-the-application";

interface ConnectionDraft {
  readonly publicKey: string;
  readonly tokenChoice: SecretChoice;
  /** A new token; held only in memory and never prefilled. */
  readonly tokenValue: string;
}

const draftOf = ({ configuration }: DiscordSettings): ConnectionDraft => ({
  publicKey: configuration.publicKey ?? "",
  tokenChoice: "keep",
  tokenValue: "",
});

// The backend stores the Public key in lowercase; compare drafts the same way.
const publicKeyOf = (draft: ConnectionDraft) => draft.publicKey.trim().toLowerCase() || null;

/** Whether the draft saves a new token in place of the one Factory operated with. */
const replacesToken = (draft: ConnectionDraft, settings: DiscordSettings) =>
  settings.application !== null &&
  (settings.configuration.tokenConfigured
    ? draft.tokenChoice === "replace" && draft.tokenValue.trim() !== ""
    : draft.tokenValue.trim() !== "");

/** The token change this draft asks for, or null while a replacement has no value yet. */
function tokenChange(draft: ConnectionDraft, settings: DiscordSettings): DiscordTokenChange | null {
  const value = draft.tokenValue.trim();
  if (!settings.configuration.tokenConfigured)
    return value ? { kind: "replace", value } : { kind: "keep" };
  if (draft.tokenChoice === "replace") return value ? { kind: "replace", value } : null;
  return { kind: draft.tokenChoice };
}

function isDirty(draft: ConnectionDraft, { configuration }: DiscordSettings) {
  return (
    publicKeyOf(draft) !== configuration.publicKey ||
    draft.tokenValue.trim() !== "" ||
    draft.tokenChoice === "remove"
  );
}

/** Whether the host already holds exactly this save, so a lost acknowledgement was a success. */
const committed = (input: UpdateDiscordConnectionInput, current: DiscordSettings) =>
  current.configuration.revision === input.revision + 1 &&
  current.configuration.publicKey === input.publicKey;

// While On, the running connection's state changes without any action on this page.
const STATUS_REFRESH_MS = 5_000;

/** Which section a one-Save attempt stopped at; the next Save sends only what is still unsaved. */
type SaveStop = "bot" | "access" | "access-after-bot" | null;

/** Whether the Language model's provider, base URL and model are saved, as the switch needs. */
function useModelComplete() {
  const [complete, setComplete] = useState(true);
  useEffect(() => {
    // The host refuses On without a complete model anyway, so an unread model gates nothing.
    api.getChatModelSettings().then(
      ({ configuration }) =>
        setComplete(
          Boolean(configuration.providerKind && configuration.baseUrl && configuration.model),
        ),
      () => undefined,
    );
  }, []);
  return complete;
}

/** One host action at a time with its failure message; the answer goes to `onAnswer`. */
function useHostAction<Input>(
  run: (input: Input) => Promise<DiscordSettings>,
  onAnswer: (settings: DiscordSettings) => void,
  fallback: (input: Input) => string,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (input: Input) => {
    setBusy(true);
    setError("");
    return await run(input)
      .then(onAnswer)
      .catch((cause: unknown) => {
        setError(chatControlError(cause, fallback(input)));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, error, act };
}

/** The bot draft's state: unsaved edits, its token change and whether it may be saved. */
function botDraftCheck(settings: DiscordSettings | null, draft: ConnectionDraft | null) {
  if (!settings || !draft) return { dirty: false, token: null, publicKeyProblem: "", ready: false };
  const validated = draft.publicKey.trim() ? validateDiscordPublicKey(draft.publicKey) : null;
  const publicKeyProblem = validated && !validated.ok ? validated.error.message : "";
  const token = tokenChange(draft, settings);
  return {
    dirty: isDirty(draft, settings),
    token,
    publicKeyProblem,
    ready: token !== null && !publicKeyProblem,
  };
}

/**
 * The one Save: Bot first, then Access, each with its own revision. A failed Bot save leaves
 * Access unsent and every edit kept; after a failed Access save the next Save sends only Access.
 */
function useOneSave(
  bot: ReturnType<
    typeof useChatControlSection<DiscordSettings, ConnectionDraft, UpdateDiscordConnectionInput>
  >,
  access: ReturnType<typeof useAccessSection>,
  supersede: () => void,
) {
  const [stopped, setStopped] = useState<SaveStop>(null);
  const [granted, setGranted] = useState<readonly string[]>([]);
  const botCheck = botDraftCheck(bot.settings, bot.draft);
  const save = async () => {
    setGranted([]);
    setStopped(null);
    const botSaved = botCheck.dirty;
    if (botCheck.dirty && botCheck.token && bot.settings && bot.draft) {
      const saved = await bot.save({
        revision: bot.settings.configuration.revision,
        publicKey: publicKeyOf(bot.draft),
        token: botCheck.token,
      });
      supersede();
      if (!saved) return setStopped("bot");
    }
    if (access.dirty && access.input && access.settings) {
      const firstGrant = firstGrants(access.input, access.settings.access);
      if (!(await access.save(access.input)))
        return setStopped(botSaved ? "access-after-bot" : "access");
      setGranted(firstGrant);
    }
  };
  const dirty = botCheck.dirty || access.dirty;
  return {
    botCheck,
    dirty,
    saving: bot.saving || access.saving,
    canSave: dirty && (!botCheck.dirty || botCheck.ready) && (!access.dirty || !access.problem),
    save,
    stopped,
    granted,
    discard: () => {
      bot.discard();
      access.discard();
      setStopped(null);
    },
  };
}

/**
 * The page's saved settings and drafts, with its one Save, check, On/Off and Discard actions.
 * While Chat control is On the settings are read again periodically, which updates the connection
 * state without touching any draft.
 */
function useDiscordPage() {
  const bot = useChatControlSection({
    read: api.getDiscordSettings,
    update: api.updateDiscordConnection,
    draftOf,
    committed,
    name: "the bot",
  });
  const access = useAccessSection();
  const modelComplete = useModelComplete();
  const { settings, setSettings } = bot;
  useEffect(() => {
    if (settings) reportDiscordSettings(settings);
  }, [settings]);
  const { failure, supersede } = useRefreshSchedule({
    read: api.getDiscordSettings,
    apply: setSettings,
    intervalMs: STATUS_REFRESH_MS,
    watching: settings?.chatControlEnabled ?? false,
  });
  /** An action's answer is newer than any background read still in flight. */
  const answer = (next: DiscordSettings) => {
    supersede();
    setSettings(next);
  };
  const oneSave = useOneSave(bot, access, supersede);
  const check = useHostAction(
    (revision: number) => api.checkDiscordConnection({ revision }),
    (next) => {
      answer(next);
      // Names the check looked up belong to the Access section too.
      access.setSettings(next);
    },
    () => "Factory could not run the check.",
  );
  const accessTest = useHostAction(
    () => api.sendDiscordAccessTest(),
    (next) => {
      answer(next);
      access.setSettings(next);
    },
    () => "Factory could not send the access test.",
  );
  const turn = useHostAction(
    (on: boolean) => api.setChatControlEnabled({ enabled: on }),
    answer,
    (on) => `Factory could not turn Chat control ${on ? "On" : "Off"}.`,
  );
  return {
    ...oneSave,
    bot,
    access,
    settings,
    draft: bot.draft,
    botDirty: oneSave.botCheck.dirty,
    publicKeyProblem: oneSave.botCheck.publicKeyProblem,
    modelComplete,
    setSettings: answer,
    // A lost read changed nothing on the host, unlike the lost answer chatControlError describes.
    refreshError: !failure
      ? ""
      : failure.cause instanceof ApiError
        ? chatControlError(failure.cause, "")
        : "Factory could not refresh the connection state. It retries automatically.",
    checking: check.busy,
    checkError: check.error,
    check: check.act,
    accessTest,
    switching: turn.busy,
    switchError: turn.error,
    turn: turn.act,
  };
}

type DiscordPage = ReturnType<typeof useDiscordPage>;

const BADGES: Record<DiscordSettings["connectionStatus"], ReactNode> = {
  incomplete: <StatusBadge kind="neutral">Off</StatusBadge>,
  off: <StatusBadge kind="neutral">Off</StatusBadge>,
  checking: <StatusBadge kind="checking">Checking</StatusBadge>,
  connecting: <StatusBadge kind="checking">Connecting</StatusBadge>,
  connected: <StatusBadge kind="success">Connected</StatusBadge>,
  reconnecting: (
    <StatusBadge kind="attention" icon={Unplug}>
      Reconnecting
    </StatusBadge>
  ),
  rejected: <StatusBadge kind="error">Rejected</StatusBadge>,
};

/** The latest check of the saved revision, the only one that describes the saved connection. */
const currentCheck = ({ latestCheck, configuration }: DiscordSettings) =>
  latestCheck?.revision === configuration.revision ? latestCheck : null;

/** Until the first passing check the header links the setup steps. */
const needsSetupGuide = (settings: DiscordSettings) =>
  settings.application === null && settings.latestCheck?.outcome !== "verified";

const CARD = {
  token: "discord-token-problem",
  publicKey: "discord-public-key-problem",
} as const;

/**
 * Settings → Chat control → Discord, host only: the Chat control switch, delivery problems while
 * On, then the bot and Access, saved together by one Save in that order.
 */
export function ChatDiscordSettings() {
  const page = useDiscordPage();
  const { settings, draft, access } = page;
  const decision = useSettingsDraftGuard("chat-discord", [
    ...(page.botDirty ? ["Bot"] : []),
    ...(access.dirty ? ["Access"] : []),
  ]);
  return (
    <ChatControlPage
      title="Discord"
      badge={settings && BADGES[settings.connectionStatus]}
      actions={settings && <HeaderActions page={page} settings={settings} />}
      loadError={page.bot.loadError || access.loadError}
      onRetry={() => {
        page.bot.reload();
        access.reload();
      }}
      decision={decision}
    >
      {settings && draft && access.settings && access.draft ? (
        <>
          <ChatControlRow page={page} settings={settings} />
          <DeliveryCard settings={settings} onSettings={page.setSettings} />
          <BotCard page={page} settings={settings} draft={draft} />
          <AccessCard
            settings={access.settings}
            draft={access.draft}
            problem={access.problem}
            disabled={page.saving}
            test={settings.access.test}
            sendTest={accessTestAction(page, settings)}
            onChange={access.setDraft}
          />
          <AccessProblems page={page} settings={settings} />
        </>
      ) : null}
    </ChatControlPage>
  );
}

/**
 * The access test action once Access was first saved. It always tests the saved Access, so it
 * waits for unsaved Users or Channels edits, and it needs Chat control On.
 */
function accessTestAction(
  page: DiscordPage,
  settings: DiscordSettings,
): AccessTestAction | undefined {
  // The Access save answers the Access section first; the page's settings catch up on the next read.
  if ((page.access.settings ?? settings).access.savedAt === null) return undefined;
  return {
    label: page.accessTest.busy
      ? "Sending…"
      : settings.access.test
        ? "Send again"
        : "Send access test",
    reason: !settings.chatControlEnabled
      ? "Turn on Chat control to send"
      : page.access.dirty
        ? "Save first"
        : "",
    busy: page.accessTest.busy,
    onSend: () => void page.accessTest.act(undefined),
  };
}

/** Setup guide until the first passing check, Discard, the connection action, then Save. */
function HeaderActions({ page, settings }: { page: DiscordPage; settings: DiscordSettings }) {
  const { connectionStatus, commandSetup, chatControlEnabled, configuration } = settings;
  const commandFailed = commandSetup?.outcome === "failed";
  const retryable =
    connectionStatus === "rejected" || connectionStatus === "reconnecting" || commandFailed;
  const busy = page.checking || connectionStatus === "checking";
  return (
    <>
      {needsSetupGuide(settings) && (
        <Button variant="link" asChild>
          <a href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
            Setup guide
            <ArrowUpRight aria-hidden strokeWidth={1.5} />
          </a>
        </Button>
      )}
      <SaveActions
        dirty={page.dirty}
        saving={page.saving}
        onSave={page.canSave ? () => void page.save() : undefined}
        onDiscard={page.discard}
      >
        {!chatControlEnabled ? (
          <Button
            type="button"
            variant="outline"
            disabled={page.botDirty || connectionStatus === "incomplete" || busy}
            onClick={() => void page.check(configuration.revision)}
          >
            {busy ? "Checking…" : "Check connection"}
          </Button>
        ) : (
          retryable && (
            <Button
              type="button"
              variant={connectionStatus === "rejected" || commandFailed ? "default" : "outline"}
              disabled={page.botDirty || page.checking}
              onClick={() => void page.check(configuration.revision)}
            >
              {page.checking ? "Retrying…" : "Retry connection"}
            </Button>
          )
        )}
      </SaveActions>
    </>
  );
}

/** The one persisted On/Off switch; while it cannot turn On, the reason sits beside it. */
function ChatControlRow({ page, settings }: { page: DiscordPage; settings: DiscordSettings }) {
  const blocker = chatControlBlocker(settings, page.modelComplete);
  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-muted">
        <SettingsRow
          title="Chat control"
          control={(text) => (
            <>
              {blocker && (
                <span id={`${text.title}-reason`} className="text-sm text-muted-foreground">
                  <BlockerReason blocker={blocker} />
                </span>
              )}
              <Switch
                aria-labelledby={text.title}
                aria-describedby={blocker ? `${text.title}-reason` : undefined}
                checked={settings.chatControlEnabled}
                disabled={page.switching || blocker !== null}
                onCheckedChange={(on) => void page.turn(on)}
              />
            </>
          )}
        />
      </div>
      {page.switchError && (
        <SettingsProblemCard
          tone="error"
          title={`Couldn’t turn Chat control ${settings.chatControlEnabled ? "off" : "on"}`}
          details={page.switchError}
        >
          Fix what the details name, then try again.
        </SettingsProblemCard>
      )}
      {page.refreshError && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t refresh the connection state"
          details={page.refreshError}
        >
          Factory retries automatically.
        </SettingsProblemCard>
      )}
    </>
  );
}

function BlockerReason({ blocker }: { blocker: ChatControlBlocker }) {
  const modelOptions = useSettingsOptions({ tab: "chat-model", from: "chat-discord" });
  if (blocker.kind === "rejected") return "Replace the rejected token first";
  if (blocker.kind === "intent") return "Turn on Message Content Intent first";
  const model = blocker.model && (
    <Link {...modelOptions} className="text-link underline underline-offset-2">
      a language model
    </Link>
  );
  return (
    <>
      Save {blocker.bot}
      {blocker.bot && model && " and "}
      {model} first
    </>
  );
}

const CHECK_PROBLEMS: Record<
  Exclude<DiscordCheckOutcome, "verified">,
  { title: string; next: string; tag?: string }
> = {
  "token-rejected": {
    title: "Discord rejected the bot token",
    next: "Reset it on the Bot page of the Developer Portal, then replace it here.",
    tag: "Rejected",
  },
  "intent-disallowed": {
    title: "Message Content Intent is off",
    next: "Turn it on on the application’s Bot page, then check the connection again.",
    tag: "Intent off",
  },
  "timed-out": {
    title: "Discord didn’t answer in time",
    next: "Check the connection again in a moment.",
  },
  unreachable: {
    title: "Factory can’t reach Discord",
    next: "Check this computer’s network, then check the connection again.",
  },
  failed: {
    title: "The connection check failed",
    next: "Check the connection again; the details name what Discord answered.",
  },
};

/** The token's failure from the latest check while Off, or from the running connection while On. */
function tokenFailure(settings: DiscordSettings) {
  const outcome = settings.chatControlEnabled
    ? settings.connectionStatus === "rejected"
      ? settings.connectionProblem?.outcome
      : undefined
    : currentCheck(settings)?.outcome;
  return outcome && outcome !== "verified" ? CHECK_PROBLEMS[outcome] : undefined;
}

function BotCard({
  page,
  settings,
  draft,
}: {
  page: DiscordPage;
  settings: DiscordSettings;
  draft: ConnectionDraft;
}) {
  const { configuration } = settings;
  const disabled = page.saving;
  const onChange = page.bot.setDraft;
  const failure = tokenFailure(settings);
  const tokenState: FieldState | undefined = failure?.tag
    ? { tone: "error", cardId: CARD.token }
    : undefined;
  const publicKeyState: FieldState | undefined = page.publicKeyProblem
    ? { tone: "error", cardId: CARD.publicKey }
    : undefined;
  const verified =
    currentCheck(settings)?.outcome === "verified" || settings.connectionStatus === "connected";
  return (
    <>
      <SettingsGroup label="Bot">
        <FieldRow
          label="Public key"
          htmlFor="discord-public-key"
          tag={page.publicKeyProblem && <StatusBadge kind="error">Invalid</StatusBadge>}
        >
          <Input
            id="discord-public-key"
            value={draft.publicKey}
            placeholder="From General Information"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className="flex-1 bg-muted font-mono text-label"
            {...fieldAria(publicKeyState)}
            onChange={(event) => onChange({ ...draft, publicKey: event.target.value })}
          />
          {configuration.publicKey && (
            <CopyButton text={configuration.publicKey} label="Copy Public key" />
          )}
        </FieldRow>
        <FieldRow label="Bot token" htmlFor="discord-token">
          <SecretField
            tag={failure?.tag && <StatusBadge kind="error">{failure.tag}</StatusBadge>}
            id="discord-token"
            label="bot token"
            stored={configuration.tokenConfigured}
            choice={draft.tokenChoice}
            value={draft.tokenValue}
            placeholder="From the Bot page"
            state={tokenState}
            disabled={disabled}
            onChoice={(choice) => onChange({ ...draft, tokenChoice: choice, tokenValue: "" })}
            onValue={(value) => onChange({ ...draft, tokenValue: value })}
          />
        </FieldRow>
        {configuration.tokenConfigured && (
          <FieldRow
            label="Bot"
            tag={verified && <StatusBadge kind="success">Gateway verified</StatusBadge>}
          >
            <span className="text-foreground">
              {settings.botName ?? currentCheck(settings)?.botName ?? "—"}
            </span>
          </FieldRow>
        )}
      </SettingsGroup>
      <BotProblems page={page} settings={settings} draft={draft} />
    </>
  );
}

/** One card per problem with the bot or its connection. */
function BotProblems({
  page,
  settings,
  draft,
}: {
  page: DiscordPage;
  settings: DiscordSettings;
  draft: ConnectionDraft;
}) {
  return (
    <>
      {page.publicKeyProblem && (
        <SettingsProblemCard id={CARD.publicKey} tone="error" title="Public key isn’t valid">
          {page.publicKeyProblem}
        </SettingsProblemCard>
      )}
      {replacesToken(draft, settings) && (
        <SettingsProblemCard
          tone="warning"
          title={`A token from another bot replaces ${settings.botName ?? "the current bot"}`}
        >
          Its conversations are cleared and its waiting reviews stop working. A new token of the
          same bot keeps everything.
        </SettingsProblemCard>
      )}
      {page.stopped === "bot" && page.bot.saveFailure && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t save the bot"
          details={page.bot.saveFailure.message}
        >
          {page.access.dirty
            ? "Access changes weren’t saved. Previous grants are still active."
            : "Your edits are kept. Save again."}
        </SettingsProblemCard>
      )}
      {settings.chatControlEnabled ? (
        <RunningConnectionProblems settings={settings} />
      ) : (
        <CheckProblem settings={settings} />
      )}
      {page.checkError && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t check the connection"
          details={page.checkError}
        >
          Try again.
        </SettingsProblemCard>
      )}
    </>
  );
}

/** While Off: the latest check of the saved revision, when it failed. */
function CheckProblem({ settings }: { settings: DiscordSettings }) {
  const check = currentCheck(settings);
  const failure = tokenFailure(settings);
  if (!check || !failure) return null;
  return (
    <SettingsProblemCard
      id={CARD.token}
      tone="error"
      title={failure.title}
      details={technicalDetails([
        ["When", dayAndTime(check.checkedAt)],
        ["Revision", String(check.revision)],
        ["Error", check.message],
      ])}
    >
      {failure.next}
    </SettingsProblemCard>
  );
}

/** While On: the running connection reconnecting or rejected, and a failed command setup. */
function RunningConnectionProblems({ settings }: { settings: DiscordSettings }) {
  const { connectionStatus, connectionProblem, commandSetup } = settings;
  const failure = tokenFailure(settings);
  const details = connectionProblem
    ? technicalDetails([
        ["When", dayAndTime(connectionProblem.occurredAt)],
        ["Revision", String(settings.configuration.revision)],
        ["Error", connectionProblem.message],
      ])
    : undefined;
  return (
    <>
      {connectionStatus === "reconnecting" && (
        <SettingsProblemCard tone="warning" title="Factory can’t reach Discord" details={details}>
          It keeps trying with increasing waits.
        </SettingsProblemCard>
      )}
      {connectionStatus === "rejected" && (
        <SettingsProblemCard
          id={CARD.token}
          tone="error"
          title={failure?.title ?? "Discord ended the connection"}
          details={details}
        >
          {failure?.tag ? failure.next : "Fix the cause, then retry the connection."}
        </SettingsProblemCard>
      )}
      {commandSetup?.outcome === "failed" && (
        <SettingsProblemCard
          tone="error"
          title="/factory reset isn’t registered"
          details={technicalDetails([
            ["When", dayAndTime(commandSetup.occurredAt)],
            ["Error", commandSetup.message],
          ])}
        >
          Retry the connection to register it again.
        </SettingsProblemCard>
      )}
    </>
  );
}

/** Access save results and the empty-Access notice while On. */
function AccessProblems({ page, settings }: { page: DiscordPage; settings: DiscordSettings }) {
  const { access } = page;
  const saved = access.settings?.access ?? settings.access;
  const nobody =
    saved.users.length === 0 || !saved.channels.some((channel) => channel.projectIds.length > 0);
  const channelNames = page.granted.map((id) => {
    const name = saved.channelNames[id];
    return name ? `#${name}` : id;
  });
  return (
    <>
      {(page.stopped === "access" || page.stopped === "access-after-bot") && access.saveFailure && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t save Access"
          details={access.saveFailure.message}
        >
          {page.stopped === "access-after-bot"
            ? "The bot is saved. Save again to retry Access."
            : "Your edits are kept. Save again."}
        </SettingsProblemCard>
      )}
      {page.accessTest.error && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t send the access test"
          details={page.accessTest.error}
        >
          Try again.
        </SettingsProblemCard>
      )}
      {channelNames.length > 0 && (
        <SettingsProblemCard
          tone="info"
          title={`Everyone who can read ${channelNames.join(", ")} sees the bot’s replies`}
        />
      )}
      {settings.chatControlEnabled && !access.dirty && nobody && (
        <SettingsProblemCard tone="info" title="Nobody can use Chat control yet">
          Allow a user and a channel that grants a Project.
        </SettingsProblemCard>
      )}
    </>
  );
}
