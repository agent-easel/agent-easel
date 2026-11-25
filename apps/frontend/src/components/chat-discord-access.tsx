import { Bot, ChevronsUpDown, Trash2 } from "lucide-react";
import type {
  DiscordAccessTest,
  DiscordSettings,
  FactoryProject,
  UpdateDiscordAccessInput,
} from "@agent-easel/contracts";
import { validateUpdateDiscordAccess } from "@agent-easel/domain-validation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { selectFieldClass } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import { useProjects } from "../use-projects.ts";
import { timeAgo } from "../time-format.ts";
import { randomId } from "../lib/ids.ts";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsGroup } from "./settings-page.tsx";
import { FieldRow, useChatControlSection } from "./chat-control-form.tsx";
import { fieldAria, fieldBorder, type FieldState } from "./field-state.ts";

interface ChannelDraft {
  /** Stable while the owner edits the row's channel ID. */
  readonly key: string;
  readonly channelId: string;
  readonly projectIds: readonly string[];
}

export interface AccessDraft {
  /** Comma-separated user IDs as typed; one ID per line is accepted too. */
  readonly users: string;
  readonly bots: string;
  readonly channels: readonly ChannelDraft[];
}

/** Projects Factory no longer knows are dropped from the draft, so the next save removes them. */
const knownProjects = (projectIds: readonly string[], access: DiscordSettings["access"]) =>
  projectIds.filter((projectId) => !access.unresolvedProjectIds.includes(projectId));

const draftOf = ({ access }: DiscordSettings): AccessDraft => ({
  users: access.users.join(", "),
  bots: access.bots.join(", "),
  channels: access.channels.map((channel) => ({
    key: randomId(),
    channelId: channel.channelId,
    projectIds: knownProjects(channel.projectIds, access),
  })),
});

const userIds = (ids: string) =>
  ids
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

const saveInput = (draft: AccessDraft, settings: DiscordSettings): UpdateDiscordAccessInput => ({
  revision: settings.access.revision,
  users: userIds(draft.users),
  bots: userIds(draft.bots),
  channels: draft.channels.map(({ channelId, projectIds }) => ({
    channelId: channelId.trim(),
    projectIds,
  })),
});

const sameAccess = (
  input: Pick<UpdateDiscordAccessInput, "users" | "bots" | "channels">,
  saved: DiscordSettings["access"],
) =>
  JSON.stringify([input.users, input.bots, input.channels]) ===
  JSON.stringify([
    saved.users,
    saved.bots,
    saved.channels.map((channel) => ({
      channelId: channel.channelId,
      projectIds: knownProjects(channel.projectIds, saved),
    })),
  ]);

/** Whether the host already holds exactly this save, so a lost acknowledgement was a success. */
const committed = (input: UpdateDiscordAccessInput, current: DiscordSettings) =>
  current.access.revision === input.revision + 1 && sameAccess(input, current.access);

/** Channels this save grants their first Project: everyone who can read them sees the replies. */
export const firstGrants = (input: UpdateDiscordAccessInput, saved: DiscordSettings["access"]) =>
  input.channels
    .filter(
      (channel) =>
        channel.projectIds.length > 0 &&
        !saved.channels.some(
          (before) => before.channelId === channel.channelId && before.projectIds.length > 0,
        ),
    )
    .map((channel) => channel.channelId);

/** Where a draft breaks the Access rules, if anywhere; repeated IDs are refused, not merged. */
function draftProblem(input: UpdateDiscordAccessInput) {
  const validated = validateUpdateDiscordAccess(input);
  return validated.ok ? "" : validated.error.message;
}

function wrongListMessages(draft: AccessDraft, access: DiscordSettings["access"]) {
  const who = (id: string) => access.userNames[id] ?? id;
  return [
    ...userIds(draft.users)
      .filter((id) => access.accountKinds[id] === "bot")
      .map((id) => `${who(id)} is a bot. Move its ID to Bots, then save.`),
    ...userIds(draft.bots)
      .filter((id) => access.accountKinds[id] === "human")
      .map((id) => `${who(id)} is not a bot. Move its ID to Users, then save.`),
  ];
}

/** The Access section's saved state and draft; the page saves it after the bot. */
export function useAccessSection() {
  const section = useChatControlSection({
    read: api.getDiscordSettings,
    update: api.updateDiscordAccess,
    draftOf,
    committed,
    name: "Access",
  });
  const { settings, draft } = section;
  const input = settings && draft ? saveInput(draft, settings) : null;
  const dirty = settings !== null && input !== null && !sameAccess(input, settings.access);
  const problem = dirty && input ? draftProblem(input) : "";
  const wrongList = settings && draft ? wrongListMessages(draft, settings.access) : [];
  return { ...section, input, dirty, problem, wrongList };
}

/**
 * The draft IDs Discord does not know, by the names the latest lookup recorded. A channel the
 * access test found gone has its own card instead.
 */
function unknownIds(
  draft: AccessDraft,
  access: DiscordSettings["access"],
  test: DiscordAccessTest | null,
) {
  return {
    users: userIds(draft.users).filter((id) => access.userNames[id] === null),
    bots: userIds(draft.bots).filter((id) => access.userNames[id] === null),
    channels: draft.channels.filter(
      (channel) =>
        access.channelNames[channel.channelId.trim()] === null &&
        test?.channels[channel.channelId.trim()] !== "unknown-channel",
    ),
  };
}

const PROBLEM = "discord-access-problem";
const UNKNOWN = "discord-access-unknown";
const WRONG_LIST = "discord-access-wrong-list";
const GONE = "discord-access-gone";

/** Sending the access test from the "Add channel" row; absent before the first Access save. */
export interface AccessTestAction {
  readonly label: string;
  /** Why it cannot be sent now; empty when it can. */
  readonly reason: string;
  readonly busy: boolean;
  readonly onSend: () => void;
}

/** The draft's channels the latest access test could not post in: refused, or gone. */
function testProblems(draft: AccessDraft, test: DiscordAccessTest | null) {
  const outcome = (channel: ChannelDraft) => test?.channels[channel.channelId.trim()];
  return {
    cantPost: draft.channels.filter((channel) => outcome(channel) === "cant-post"),
    gone: draft.channels.filter((channel) => outcome(channel) === "unknown-channel"),
  };
}

/** "#name" for a channel Discord named, otherwise its ID. */
const channelLabel = (channelId: string, access: DiscordSettings["access"]) => {
  const name = access.channelNames[channelId];
  return name ? `#${name}` : channelId;
};

/** The latest access test's state of one allowed user, if the test asked or heard from them. */
function TestBadge({ reachedAt }: { reachedAt: string | null | undefined }) {
  if (reachedAt === undefined) return null;
  return reachedAt === null ? (
    <StatusBadge kind="checking">Waiting</StatusBadge>
  ) : (
    <StatusBadge kind="success">Reached · {timeAgo(reachedAt)}</StatusBadge>
  );
}

function IdListInput({
  id,
  value,
  placeholder,
  disabled,
  state,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  state: FieldState | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      className={cn("flex-1 bg-muted font-mono text-label", fieldBorder(state?.tone))}
      {...fieldAria(state?.cardId)}
      onChange={(event) => onChange(event.target.value)}
      onPaste={(event) => {
        // One ID per line is accepted and shown as the comma-separated list.
        const pasted = event.clipboardData.getData("text");
        if (!pasted.includes("\n")) return;
        event.preventDefault();
        onChange(userIds(`${value}\n${pasted}`).join(", "));
      }}
    />
  );
}

/**
 * Who may invoke Chat control and where: allowed users, then each allowed channel with the
 * Projects it grants. Names Discord reported show under the IDs once a check passed.
 */
export function AccessCard({
  settings,
  draft,
  problem,
  wrongList,
  disabled,
  test,
  sendTest,
  onChange,
}: {
  settings: DiscordSettings;
  draft: AccessDraft;
  problem: string;
  wrongList: readonly string[];
  disabled: boolean;
  /** The latest access test, as the page's most recent read shows it. */
  test: DiscordAccessTest | null;
  sendTest: AccessTestAction | undefined;
  onChange: (draft: AccessDraft) => void;
}) {
  const projects = useProjects();
  const { userNames, accountKinds, channelNames } = settings.access;
  const unknown = unknownIds(draft, settings.access, test);
  const users = userIds(draft.users);
  const bots = userIds(draft.bots);
  const listState = (
    ids: readonly string[],
    wrongKind: "bot" | "human",
    unknownInList: readonly string[],
  ): FieldState | undefined =>
    ids.some((id) => accountKinds[id] === wrongKind)
      ? { tone: "error", cardId: WRONG_LIST }
      : unknownInList.length
        ? { tone: "attention", cardId: UNKNOWN }
        : undefined;
  const usersState = listState(users, "bot", unknown.users);
  const botsState = listState(bots, "human", unknown.bots);
  const setChannel = (key: string, change: Partial<ChannelDraft>) =>
    onChange({
      ...draft,
      channels: draft.channels.map((channel) =>
        channel.key === key ? { ...channel, ...change } : channel,
      ),
    });
  return (
    <>
      <SettingsGroup label="Access">
        <FieldRow
          label="Users"
          htmlFor="discord-access-users"
          secondary={userNamesLine(users, userNames, accountKinds, test)}
        >
          <IdListInput
            id="discord-access-users"
            value={draft.users}
            placeholder="Discord user IDs"
            disabled={disabled}
            state={usersState}
            onChange={(users) => onChange({ ...draft, users })}
          />
        </FieldRow>
        {draft.channels.map((channel, index) => (
          <ChannelRow
            key={channel.key}
            index={index}
            channel={channel}
            name={channelNames[channel.channelId.trim()]}
            post={test?.channels[channel.channelId.trim()]}
            projects={projects}
            disabled={disabled}
            onChange={(change) => setChannel(channel.key, change)}
            onRemove={() =>
              onChange({
                ...draft,
                channels: draft.channels.filter((row) => row.key !== channel.key),
              })
            }
          />
        ))}
        <AddChannelRow
          first={draft.channels.length === 0}
          disabled={disabled}
          sendTest={sendTest}
          onAdd={() =>
            onChange({
              ...draft,
              channels: [...draft.channels, { key: randomId(), channelId: "", projectIds: [] }],
            })
          }
        />
      </SettingsGroup>
      <SettingsGroup
        label="Bots"
        description="Bots may talk to AgentEasel and start Runs in allowed channels. Every Start still needs the confirmation phrase. Bots can’t answer Human blocks or archive."
      >
        <FieldRow
          label="Bot IDs"
          htmlFor="discord-access-bots"
          secondary={botNamesLine(bots, userNames, accountKinds)}
        >
          <IdListInput
            id="discord-access-bots"
            value={draft.bots}
            placeholder="Discord bot IDs"
            disabled={disabled}
            state={botsState}
            onChange={(bots) => onChange({ ...draft, bots })}
          />
        </FieldRow>
      </SettingsGroup>
      {problem && (
        <ProblemCard id={PROBLEM} tone="error" title="Access isn’t valid">
          {problem}
        </ProblemCard>
      )}
      {wrongList.length > 0 && (
        <ProblemCard
          id={WRONG_LIST}
          tone="attention"
          title={`${count(wrongList.length, "ID")} ${wrongList.length === 1 ? "is" : "are"} in the wrong list`}
        >
          {wrongList.join(" ")}
        </ProblemCard>
      )}
      {(unknown.users.length > 0 || unknown.bots.length > 0 || unknown.channels.length > 0) && (
        <ProblemCard id={UNKNOWN} tone="attention" title={unknownTitle(unknown)}>
          Fix the IDs, then save.
        </ProblemCard>
      )}
      <AccessTestProblems settings={settings} draft={draft} test={test} />
    </>
  );
}

/**
 * Allowed users by name; while an access test covers them, one per line with its state. Null
 * before Discord named any of them.
 */
function userNamesLine(
  users: readonly string[],
  userNames: DiscordSettings["access"]["userNames"],
  accountKinds: DiscordSettings["access"]["accountKinds"],
  test: DiscordAccessTest | null,
) {
  const name = (id: string) =>
    userNames[id] === null ? (
      <StatusBadge kind="attention">Unknown user</StatusBadge>
    ) : accountKinds[id] === "bot" ? (
      <StatusBadge kind="error">{userNames[id] ?? id} is a bot</StatusBadge>
    ) : (
      (userNames[id] ?? id)
    );
  const plain = (id: string) => userNames[id] !== null && accountKinds[id] !== "bot";
  if (test && users.some((id) => id in test.users))
    return users.map((id) => (
      <span key={id} className="flex basis-full items-center gap-2">
        {name(id)}
        <TestBadge reachedAt={test.users[id]} />
      </span>
    ));
  if (!users.some((id) => id in userNames)) return null;
  return users.map((id, index) => (
    <span key={id}>
      {name(id)}
      {plain(id) && index < users.length - 1 && ","}
    </span>
  ));
}

function botNamesLine(
  bots: readonly string[],
  userNames: DiscordSettings["access"]["userNames"],
  accountKinds: DiscordSettings["access"]["accountKinds"],
) {
  if (!bots.some((id) => id in userNames)) return null;
  return bots.map((id) => {
    const name = userNames[id];
    if (name === null)
      return (
        <StatusBadge key={id} kind="attention">
          Unknown user
        </StatusBadge>
      );
    if (accountKinds[id] === "human")
      return (
        <StatusBadge key={id} kind="error">
          {name ?? id} is not a bot
        </StatusBadge>
      );
    return (
      <span key={id} className="flex items-center gap-1.5">
        {name ?? id}
        {accountKinds[id] === "bot" && (
          <StatusBadge kind="neutral" icon={Bot}>
            Bot
          </StatusBadge>
        )}
      </span>
    );
  });
}

/** The row under the channels: Add channel and, once Access was saved, the access test. */
function AddChannelRow({
  first,
  disabled,
  sendTest,
  onAdd,
}: {
  first: boolean;
  disabled: boolean;
  sendTest: AccessTestAction | undefined;
  onAdd: () => void;
}) {
  const reasonId = "discord-access-test-reason";
  return (
    <FieldRow
      label={first ? "Channels" : ""}
      secondary={
        sendTest?.reason && (
          <span id={reasonId} className="ml-auto">
            {sendTest.reason}
          </span>
        )
      }
    >
      <Button type="button" variant="outline" disabled={disabled} onClick={onAdd}>
        Add channel
      </Button>
      {sendTest && (
        <Button
          type="button"
          variant="outline"
          className="ml-auto"
          disabled={sendTest.busy || sendTest.reason !== ""}
          aria-describedby={sendTest.reason ? reasonId : undefined}
          onClick={sendTest.onSend}
        >
          {sendTest.label}
        </Button>
      )}
    </FieldRow>
  );
}

/** One card for the channels the access test couldn't post in and one for those that are gone. */
function AccessTestProblems({
  settings,
  draft,
  test,
}: {
  settings: DiscordSettings;
  draft: AccessDraft;
  test: DiscordAccessTest | null;
}) {
  const { cantPost, gone } = testProblems(draft, test);
  const labels = (channels: readonly ChannelDraft[]) =>
    channels.map((channel) => channelLabel(channel.channelId.trim(), settings.access)).join(", ");
  return (
    <>
      {cantPost.length > 0 && (
        <ProblemCard
          tone="attention"
          title={`${settings.botName ?? "The bot"} can’t post in ${labels(cantPost)}`}
        >
          Allow it to send messages there, then send again.
        </ProblemCard>
      )}
      {gone.length > 0 && (
        <ProblemCard
          id={GONE}
          tone="attention"
          title={`${labels(gone)} no longer exist${gone.length === 1 ? "s" : ""}`}
        >
          Remove {gone.length === 1 ? "it" : "them"}, then send again.
        </ProblemCard>
      )}
    </>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function unknownTitle(unknown: ReturnType<typeof unknownIds>) {
  const parts = [
    ...(unknown.users.length ? [count(unknown.users.length, "user")] : []),
    ...(unknown.bots.length ? [count(unknown.bots.length, "bot")] : []),
    ...(unknown.channels.length ? [count(unknown.channels.length, "channel")] : []),
  ];
  return `Discord doesn’t know ${parts.join(" and ")}`;
}

type TestPost = DiscordAccessTest["channels"][string];

/** A channel ID Discord doesn't know, by the access test's post or its name lookup. */
function channelState(
  name: string | null | undefined,
  post: TestPost | undefined,
): FieldState | undefined {
  if (post === "unknown-channel") return { tone: "attention", cardId: GONE };
  if (name === null) return { tone: "attention", cardId: UNKNOWN };
  return undefined;
}

/** The channel's name with the access test's problem there; null when there is neither. */
function channelName(name: string | null | undefined, post: TestPost | undefined) {
  if (name === null || post === "unknown-channel")
    return <StatusBadge kind="attention">Unknown channel</StatusBadge>;
  if (!name && post !== "cant-post") return null;
  return (
    <>
      {name && `#${name}`}
      {post === "cant-post" && <StatusBadge kind="attention">Can’t post</StatusBadge>}
    </>
  );
}

function ChannelRow({
  index,
  channel,
  name,
  post,
  projects,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  channel: ChannelDraft;
  /** The name Discord reported; null when unknown, undefined before a lookup. */
  name: string | null | undefined;
  /** What the latest access test's post here did, if it was sent here. */
  post: TestPost | undefined;
  projects: readonly FactoryProject[] | undefined;
  disabled: boolean;
  onChange: (change: Partial<ChannelDraft>) => void;
  onRemove: () => void;
}) {
  const id = `discord-access-channel-${channel.key}`;
  const state = channelState(name, post);
  return (
    <FieldRow label={index === 0 ? "Channels" : ""} secondary={channelName(name, post)}>
      <Input
        id={id}
        aria-label={`Channel ${index + 1} ID`}
        value={channel.channelId}
        placeholder="Channel ID"
        autoComplete="off"
        spellCheck={false}
        inputMode="numeric"
        disabled={disabled}
        className={cn(
          "w-auto min-w-0 flex-1 basis-40 bg-muted font-mono text-label",
          fieldBorder(state?.tone),
        )}
        {...fieldAria(state?.cardId)}
        onChange={(event) => onChange({ channelId: event.target.value })}
      />
      <ProjectsSelect
        label={`Channel ${index + 1} Projects`}
        selected={channel.projectIds}
        projects={projects}
        disabled={disabled}
        onChange={(projectIds) => onChange({ projectIds })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove channel ${index + 1}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden strokeWidth={1.5} />
      </Button>
    </FieldRow>
  );
}

/** The Projects a channel grants; more than one reads "N Projects" while closed. */
function ProjectsSelect({
  label,
  selected,
  projects,
  disabled,
  onChange,
}: {
  label: string;
  selected: readonly string[];
  projects: readonly FactoryProject[] | undefined;
  disabled: boolean;
  onChange: (projectIds: readonly string[]) => void;
}) {
  const titles = selected.map((id) => projects?.find((project) => project.id === id)?.title ?? id);
  const shown =
    selected.length === 0
      ? "Choose Projects"
      : selected.length === 1
        ? titles[0]!
        : `${selected.length} Projects`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          aria-label={`${label}: ${selected.length ? titles.join(", ") : "none"}`}
          className={cn(selectFieldClass, "h-8 w-32 shrink-0 disabled:opacity-50")}
        >
          <span
            className={cn("min-w-0 truncate", selected.length === 0 && "text-muted-foreground")}
          >
            {shown}
          </span>
          <span className="flex-1" />
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-(--radix-dropdown-menu-trigger-width)">
        {projects === undefined && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Reading AgentEasel’s Projects…</p>
        )}
        {projects?.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">AgentEasel has no Projects yet.</p>
        )}
        {projects?.map((project) => (
          <DropdownMenuCheckboxItem
            key={project.id}
            checked={selected.includes(project.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...selected, project.id] : selected.filter((id) => id !== project.id),
              )
            }
          >
            {project.title}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
