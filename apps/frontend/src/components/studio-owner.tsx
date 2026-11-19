import { useId } from "react";
import type { FactoryProject } from "@t3-factory/contracts";
import { ChevronDown, ChevronsUpDown, FolderGit2, RefreshCw, Workflow } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge.tsx";
import { NoticeButton } from "./notice.tsx";
import { SettingsProblemCard } from "./settings-page.tsx";
import { fieldLabelClass, selectFieldClass } from "./page.tsx";
import type { OwnerChange } from "../revisioned-draft.ts";
import {
  ownerPicker,
  studioOwner,
  type StudioOwner,
  type StudioOwnerFilter,
} from "../studio-definitions.ts";

/** The owner's name: "Global", or the Project title. */
export function ownerName(owner: StudioOwner) {
  return owner.title;
}

/** Figma Studio/OwnerBadge: Global, an owning Project, or an unavailable owning Project. */
export function OwnerBadge({ owner }: { owner: StudioOwner }) {
  const Icon = owner.projectId === null ? Workflow : FolderGit2;
  const label = owner.projectId === null ? owner.title : ownerName(owner);
  return (
    <Badge
      variant={owner.projectId === null ? "secondary" : owner.unavailable ? "attention" : "project"}
      title={owner.unavailable ?? owner.detail ?? undefined}
      className="max-w-56"
    >
      <Icon aria-hidden strokeWidth={1.5} />
      <span className="truncate">{label}</span>
    </Badge>
  );
}

/**
 * One owner's group: icon, name, repository path and count. A Project gone from T3 keeps its name
 * and a Not in T3 tag, and no path.
 */
export function OwnerGroupHeader({ owner, count }: { owner: StudioOwner; count: string }) {
  const Icon = owner.projectId === null ? Workflow : FolderGit2;
  return (
    <h2 className="flex min-w-0 items-center gap-2 pt-2.5 pb-1.5 text-base leading-none font-semibold">
      <Icon
        aria-hidden
        className={cn(
          "size-3.25 shrink-0",
          owner.gone || owner.projectId === null ? "text-muted-foreground" : "text-brand-cyan",
        )}
        strokeWidth={1.5}
      />
      <span className="shrink-0">{owner.title}</span>
      {owner.gone ? (
        <StatusBadge kind="neutral">Not in T3</StatusBadge>
      ) : (
        owner.detail && (
          <OwnerPath
            path={owner.detail}
            className="text-2xs leading-none font-normal tracking-label text-subtle-foreground"
          />
        )
      )}
      <span className="ml-auto shrink-0 text-2xs leading-none font-normal tracking-label text-subtle-foreground">
        {count}
      </span>
    </h2>
  );
}

const filterValue = (filter: StudioOwnerFilter) =>
  filter.kind === "project" ? filter.projectId : filter.kind;

/** The filter's short value on its trigger. */
function filterLabel(filter: StudioOwnerFilter, projects: readonly FactoryProject[]) {
  if (filter.kind === "all") return "All";
  if (filter.kind === "global") return "Global";
  return studioOwner(filter.projectId, projects).title;
}

/**
 * Figma Studio/OwnerFilter: All, Global or one available Project; Studio's lists share it. A chosen
 * Project that became unavailable stays listed with its reason.
 */
export function OwnerFilter({
  filter,
  projects,
  onChange,
  className,
}: {
  filter: StudioOwnerFilter;
  projects: readonly FactoryProject[];
  onChange: (filter: StudioOwnerFilter) => void;
  className?: string;
}) {
  const label = filterLabel(filter, projects);
  const { targets } = ownerPicker(filter.kind === "project" ? filter.projectId : null, projects);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={`Owner filter: ${label}`}
          className={cn(
            "h-8 w-40 justify-start gap-1.5 bg-card pr-2 pl-3 font-normal has-[>svg]:pr-2 has-[>svg]:pl-3",
            className,
          )}
        >
          <span className="text-subtle-foreground">Owner:</span>
          <span className="min-w-0 truncate font-medium">{label}</span>
          <ChevronDown aria-hidden className="ml-auto size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-1rem)]">
        <DropdownMenuRadioGroup
          value={filterValue(filter)}
          onValueChange={(value) =>
            onChange(
              value === "all" || value === "global"
                ? { kind: value }
                : { kind: "project", projectId: value },
            )
          }
        >
          <DropdownMenuRadioItem value="all" indicatorPosition="right" className="pl-2">
            All owners
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="global" indicatorPosition="right" className="pl-2">
            <Workflow aria-hidden strokeWidth={1.5} className="text-muted-foreground" />
            Global
          </DropdownMenuRadioItem>
          {targets.length > 1 && <DropdownMenuSeparator />}
          {targets.slice(1).map(({ owner, disabled }) => (
            <DropdownMenuRadioItem
              key={owner.projectId}
              value={owner.projectId!}
              disabled={disabled !== null}
              indicatorPosition="right"
              aria-label={`${owner.title} · ${owner.detail}${owner.unavailable ? ` · ${owner.unavailable}` : ""}`}
              className="items-start pl-2"
            >
              <FolderGit2 aria-hidden strokeWidth={1.5} className="mt-0.5 text-muted-foreground" />
              <OwnerOptionText owner={owner} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A Project owner's title, repository path and, when unavailable, its reason. */
function OwnerOptionText({ owner, reason }: { owner: StudioOwner; reason?: string }) {
  return (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="truncate font-medium">{owner.title}</span>
      <OwnerPath
        path={owner.detail ?? ""}
        className="text-2xs tracking-label text-subtle-foreground"
      />
      {owner.unavailable && (
        <span className="truncate text-2xs tracking-label text-attention">
          {owner.unavailable}
          {reason ?? ""}
        </span>
      )}
    </span>
  );
}

const ownerKindClass =
  "group flex w-full items-center gap-2.5 rounded-md border bg-background px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-accent";

/** What a caller may pass as `kind`, for the owning-Project menu's wording. */
const ownerKindText = {
  Flow: { plural: "Flows" },
  Agent: { plural: "Agents" },
} as const;

type DefinitionKind = keyof typeof ownerKindText;

/**
 * The always-visible owner choice of New Flow and New Agent: Global, or a Project chosen from
 * the available Projects. An unavailable chosen owner stays chosen, disabled with its reason,
 * rather than being replaced.
 */
export function OwnerPicker({
  chosen,
  projects,
  onChange,
  disabled,
  kind,
  initial,
  hint,
  quietStatus,
}: {
  chosen: string | null;
  projects: readonly FactoryProject[];
  onChange: (owner: string | null) => void;
  disabled: boolean;
  /** Whether a Flow or an Agent is created, for the owning-Project menu. */
  kind: DefinitionKind;
  /** The preselected owner; `hint` says where it came from while it is still chosen. */
  initial: string | null;
  hint: string;
  /** The caller shows a blocked owner beside its own action, so the picker stays quiet. */
  quietStatus?: boolean;
}) {
  const id = useId();
  const picker = ownerPicker(chosen, projects);
  const projectTargets = picker.targets.slice(1);
  const firstAvailable = projectTargets.find((target) => !target.disabled)?.owner.projectId;
  const text = ownerKindText[kind];
  return (
    <div className="grid gap-1.5">
      <span id={`${id}-owner`} className={fieldLabelClass}>
        Owner
      </span>
      <RadioGroup.Root
        aria-labelledby={`${id}-owner`}
        value={chosen === null ? "global" : "project"}
        disabled={disabled}
        onValueChange={(value) => onChange(value === "global" ? null : (firstAvailable ?? null))}
        className="grid grid-cols-2 gap-2"
      >
        <OwnerKind value="global" title="Global" />
        <OwnerKind
          value="project"
          title="Project"
          disabled={disabled || (chosen === null && !firstAvailable)}
        />
      </RadioGroup.Root>
      {chosen !== null && (
        <OwningProjectMenu
          labelId={`${id}-project`}
          chosen={picker.chosen}
          targets={projectTargets}
          plural={text.plural}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {!quietStatus && (
        <OwnerPickerStatus
          blocked={picker.blocked && `${picker.chosen.title}: ${picker.blocked}`}
          note={chosen === initial ? hint : ""}
        />
      )}
    </div>
  );
}

/** One owner kind card with its radio dot. */
function OwnerKind({
  value,
  title,
  disabled,
}: {
  value: string;
  title: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup.Item value={value} disabled={disabled} className={ownerKindClass}>
      <OwnerRadioMark />
      <span className="text-sm font-medium">{title}</span>
    </RadioGroup.Item>
  );
}

/** The chosen owner's problem, or where its default came from. An empty note says nothing. */
function OwnerPickerStatus({ blocked, note }: { blocked: string | null; note: string }) {
  if (blocked)
    return (
      <p role="alert" className="text-2xs tracking-label text-attention">
        {blocked}. Choose Global or an available Project.
      </p>
    );
  if (!note) return null;
  return <p className="text-2xs tracking-label text-subtle-foreground">{note}</p>;
}

/** Figma Run/SelectField for the owning Project, with each owner target as a menu choice. */
function OwningProjectMenu({
  labelId,
  chosen,
  targets,
  plural,
  disabled,
  onChange,
}: {
  labelId: string;
  chosen: StudioOwner;
  targets: ReturnType<typeof ownerPicker>["targets"];
  plural: string;
  disabled: boolean;
  onChange: (owner: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span id={labelId} className={fieldLabelClass}>
        Owning Project
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="outline"
            aria-labelledby={labelId}
            aria-describedby={`${labelId}-value`}
            aria-invalid={chosen.unavailable ? true : undefined}
            className={cn(
              selectFieldClass,
              "disabled:opacity-50 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/50",
            )}
          >
            <FolderGit2
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                chosen.unavailable ? "text-attention" : "text-muted-foreground",
              )}
              strokeWidth={1.5}
            />
            <span id={`${labelId}-value`} className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-medium">{chosen.title}</span>
              <OwnerPath
                path={chosen.detail ?? ""}
                className="flex-1 text-2xs tracking-label text-subtle-foreground"
              />
            </span>
            <ChevronsUpDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1rem)]"
        >
          <DropdownMenuRadioGroup value={chosen.projectId ?? ""} onValueChange={onChange}>
            <ProjectTargetItems targets={targets} reason={` — can’t own new ${plural}`} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Each Project as an owner menu choice; an unavailable one is disabled with its reason. */
function ProjectTargetItems({
  targets,
  reason,
}: {
  targets: ReturnType<typeof ownerPicker>["targets"];
  /** Appended to an unavailable Project's reason. */
  reason: string;
}) {
  return targets.map(({ owner, disabled }) => (
    <DropdownMenuRadioItem
      key={owner.projectId}
      value={owner.projectId!}
      disabled={disabled !== null}
      indicatorPosition="right"
      aria-label={[owner.title, owner.detail, disabled].filter(Boolean).join(" · ")}
      className="items-start py-1.5"
    >
      <FolderGit2
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.5}
      />
      <OwnerOptionText owner={owner} reason={reason} />
    </DropdownMenuRadioItem>
  ));
}

/** The radio dot of an owner kind card; checked shows the primary ring and fill. */
function OwnerRadioMark() {
  return (
    <span
      aria-hidden
      className="mt-px grid size-3.5 shrink-0 place-items-center rounded-full border border-border-strong group-data-[state=checked]:border-primary"
    >
      <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
    </span>
  );
}

/** A repository path truncated from its start, so the distinguishing end stays visible. */
function OwnerPath({ path, className }: { path: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-left", className)} title={path} dir="rtl">
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

/**
 * Figma Run/SelectField for the owner a copy or move goes to: Global or one available Project. An
 * unavailable chosen owner stays shown, disabled with its reason, and
 * a choice other than `from` names where it changed from.
 */
export function OwnerTargetMenu({
  label,
  chosen,
  from,
  projects,
  disabled,
  onChange,
  unavailableReason,
}: {
  label: string;
  chosen: string | null;
  /** The starting owner, such as the source's or the current one. */
  from: string | null;
  projects: readonly FactoryProject[];
  disabled: boolean;
  onChange: (owner: string | null) => void;
  /** Appended to an unavailable Project's reason in the menu, such as " — can’t own copies". */
  unavailableReason: string;
}) {
  const id = useId();
  const picker = ownerPicker(chosen, projects);
  const Icon = chosen === null ? Workflow : FolderGit2;
  const changedFrom = chosen === from ? null : `changed from ${studioOwner(from, projects).title}`;
  const context = [picker.chosen.detail ?? "Usable in every project", changedFrom]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="grid gap-1.5">
      <span id={id} className={fieldLabelClass}>
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="outline"
            aria-labelledby={id}
            aria-describedby={`${id}-value`}
            aria-invalid={picker.blocked ? true : undefined}
            className={cn(selectFieldClass, "disabled:opacity-50")}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                picker.blocked ? "text-attention" : "text-muted-foreground",
              )}
              strokeWidth={1.5}
            />
            <span id={`${id}-value`} className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-medium">{picker.chosen.title}</span>
              <OwnerPath
                path={context}
                className="flex-1 text-2xs tracking-label text-subtle-foreground"
              />
            </span>
            <ChevronsUpDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1rem)]"
        >
          <DropdownMenuRadioGroup
            value={chosen ?? "global"}
            onValueChange={(value) => onChange(value === "global" ? null : value)}
          >
            <DropdownMenuRadioItem
              value="global"
              indicatorPosition="right"
              aria-label="Global · usable in every project"
              className="items-start py-1.5"
            >
              <Workflow
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">Global</span>
                <span className="text-2xs tracking-label text-subtle-foreground">
                  Usable in every project
                </span>
              </span>
            </DropdownMenuRadioItem>
            {picker.targets.length > 1 && <DropdownMenuSeparator />}
            <ProjectTargetItems targets={picker.targets.slice(1)} reason={unavailableReason} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {picker.blocked && (
        <p role="alert" className="text-2xs tracking-label text-attention">
          {picker.chosen.title}: {picker.blocked}. Choose Global or an available Project.
        </p>
      )}
    </div>
  );
}

/**
 * Figma SA06m: another client changed the definition's owning Project while it had unsaved
 * changes; the edits stay, and saving waits until the new owner is acknowledged.
 */
export function OwnerChangeNotice({
  kind,
  change,
  projects,
  onAcknowledge,
}: {
  kind: "Flow" | "Agent";
  change: OwnerChange;
  projects: readonly FactoryProject[];
  onAcknowledge: (owner: string | null) => void;
}) {
  if (change.status === "none") return null;
  const to = change.status === "changed" ? studioOwner(change.to, projects) : null;
  return (
    <SettingsProblemCard
      tone="info"
      icon={RefreshCw}
      title={
        to
          ? `This ${kind} is now ${to.projectId === null ? "Global" : `owned by ${ownerName(to)}`}`
          : `This ${kind}’s owner changed elsewhere`
      }
      action={
        change.status === "changed" && (
          <NoticeButton onClick={() => onAcknowledge(change.to)}>
            Acknowledge new owner
          </NoticeButton>
        )
      }
    >
      {change.status === "changed"
        ? "Your changes are kept. Acknowledge the new owner before saving."
        : "Your changes are kept. Waiting for Studio to show the new owner…"}
    </SettingsProblemCard>
  );
}
