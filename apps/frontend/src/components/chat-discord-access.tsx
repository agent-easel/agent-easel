import { ChevronsUpDown, Trash2 } from "lucide-react";
import type {
  DiscordSettings,
  FactoryProject,
  UpdateDiscordAccessInput,
} from "@t3-factory/contracts";
import { validateUpdateDiscordAccess } from "@t3-factory/domain-validation";
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
import { randomId } from "../lib/ids.ts";
import { SettingsGroup, SettingsProblemCard } from "./settings-page.tsx";
import {
  fieldAria,
  fieldBorder,
  FieldRow,
  useChatControlSection,
  type FieldState,
} from "./chat-control-form.tsx";

interface ChannelDraft {
  /** Stable while the owner edits the row's channel ID. */
  readonly key: string;
  readonly channelId: string;
  readonly projectIds: readonly string[];
}

export interface AccessDraft {
  /** Comma-separated user IDs as typed; one ID per line is accepted too. */
  readonly users: string;
  readonly channels: readonly ChannelDraft[];
}

/** Projects Factory no longer knows are dropped from the draft, so the next save removes them. */
const knownProjects = (projectIds: readonly string[], access: DiscordSettings["access"]) =>
  projectIds.filter((projectId) => !access.unresolvedProjectIds.includes(projectId));

const draftOf = ({ access }: DiscordSettings): AccessDraft => ({
  users: access.users.join(", "),
  channels: access.channels.map((channel) => ({
    key: randomId(),
    channelId: channel.channelId,
    projectIds: knownProjects(channel.projectIds, access),
  })),
});

/** The user IDs a draft lists, split on commas and line breaks. */
const userIds = (users: string) =>
  users
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

const saveInput = (draft: AccessDraft, settings: DiscordSettings): UpdateDiscordAccessInput => ({
  revision: settings.access.revision,
  users: userIds(draft.users),
  channels: draft.channels.map(({ channelId, projectIds }) => ({
    channelId: channelId.trim(),
    projectIds,
  })),
});

const sameAccess = (
  input: Pick<UpdateDiscordAccessInput, "users" | "channels">,
  saved: DiscordSettings["access"],
) =>
  JSON.stringify([input.users, input.channels]) ===
  JSON.stringify([
    saved.users,
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
  return { ...section, input, dirty, problem };
}

/** The draft IDs Discord does not know, by the names the latest lookup recorded. */
function unknownIds(draft: AccessDraft, access: DiscordSettings["access"]) {
  return {
    users: userIds(draft.users).filter((id) => access.userNames[id] === null),
    channels: draft.channels.filter(
      (channel) => access.channelNames[channel.channelId.trim()] === null,
    ),
  };
}

const PROBLEM = "discord-access-problem";
const UNKNOWN = "discord-access-unknown";

/**
 * Who may invoke Chat control and where: allowed users, then each allowed channel with the
 * Projects it grants. Names Discord reported show under the IDs once a check passed.
 */
export function AccessCard({
  settings,
  draft,
  problem,
  disabled,
  onChange,
}: {
  settings: DiscordSettings;
  draft: AccessDraft;
  problem: string;
  disabled: boolean;
  onChange: (draft: AccessDraft) => void;
}) {
  const projects = useProjects();
  const { userNames, channelNames } = settings.access;
  const unknown = unknownIds(draft, settings.access);
  const users = userIds(draft.users);
  const usersState: FieldState | undefined = unknown.users.length
    ? { tone: "attention", cardId: UNKNOWN }
    : undefined;
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
          secondary={
            users.some((id) => id in userNames) &&
            users.map((id, index) =>
              userNames[id] === null ? (
                <StatusBadge key={id} kind="attention">
                  Unknown user
                </StatusBadge>
              ) : (
                <span key={id}>
                  {userNames[id] ?? id}
                  {index < users.length - 1 && ","}
                </span>
              ),
            )
          }
        >
          <Input
            id="discord-access-users"
            value={draft.users}
            placeholder="Discord user IDs"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className={cn("flex-1 bg-muted font-mono text-label", fieldBorder(usersState))}
            {...fieldAria(usersState)}
            onChange={(event) => onChange({ ...draft, users: event.target.value })}
            onPaste={(event) => {
              // One ID per line is accepted and shown as the comma-separated list.
              const pasted = event.clipboardData.getData("text");
              if (!pasted.includes("\n")) return;
              event.preventDefault();
              onChange({ ...draft, users: userIds(`${draft.users}\n${pasted}`).join(", ") });
            }}
          />
        </FieldRow>
        {draft.channels.map((channel, index) => (
          <ChannelRow
            key={channel.key}
            index={index}
            channel={channel}
            name={channelNames[channel.channelId.trim()]}
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
        <FieldRow label={draft.channels.length === 0 ? "Channels" : ""}>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...draft,
                channels: [...draft.channels, { key: randomId(), channelId: "", projectIds: [] }],
              })
            }
          >
            Add channel
          </Button>
        </FieldRow>
      </SettingsGroup>
      {problem && (
        <SettingsProblemCard id={PROBLEM} tone="error" title="Access isn’t valid">
          {problem}
        </SettingsProblemCard>
      )}
      {(unknown.users.length > 0 || unknown.channels.length > 0) && (
        <SettingsProblemCard id={UNKNOWN} tone="warning" title={unknownTitle(unknown)}>
          Fix the IDs, then save.
        </SettingsProblemCard>
      )}
    </>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function unknownTitle(unknown: ReturnType<typeof unknownIds>) {
  const parts = [
    ...(unknown.users.length ? [count(unknown.users.length, "user")] : []),
    ...(unknown.channels.length ? [count(unknown.channels.length, "channel")] : []),
  ];
  return `Discord doesn’t know ${parts.join(" and ")}`;
}

function ChannelRow({
  index,
  channel,
  name,
  projects,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  channel: ChannelDraft;
  /** The name Discord reported; null when unknown, undefined before a lookup. */
  name: string | null | undefined;
  projects: readonly FactoryProject[] | undefined;
  disabled: boolean;
  onChange: (change: Partial<ChannelDraft>) => void;
  onRemove: () => void;
}) {
  const id = `discord-access-channel-${channel.key}`;
  const state: FieldState | undefined =
    name === null ? { tone: "attention", cardId: UNKNOWN } : undefined;
  return (
    <FieldRow
      label={index === 0 ? "Channels" : ""}
      secondary={
        name === null ? (
          <StatusBadge kind="attention">Unknown channel</StatusBadge>
        ) : (
          name && `#${name}`
        )
      }
    >
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
          fieldBorder(state),
        )}
        {...fieldAria(state)}
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
          <p className="px-3 py-2 text-sm text-muted-foreground">Reading Factory’s Projects…</p>
        )}
        {projects?.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Factory has no Projects yet.</p>
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
