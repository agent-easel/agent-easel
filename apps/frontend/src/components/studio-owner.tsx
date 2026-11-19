import { useId } from "react";
import type { FactoryProject } from "@t3-factory/contracts";
import { FolderGit2, RefreshCw, Workflow } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChoiceMenu, type MenuChoice } from "./choice-menu.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { TextLink } from "@/components/ui/text-link";
import { ProblemCard } from "./problem-card.tsx";
import { fieldLabelClass } from "./page.tsx";
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

type OwnerTargets = ReturnType<typeof ownerPicker>["targets"];

const globalChoice: MenuChoice = {
  id: "global",
  label: "Global",
  description: "Usable in every project",
  icon: <Workflow aria-hidden strokeWidth={1.5} className="size-4 text-muted-foreground" />,
};

/**
 * Each Project owner as a choice with its repository path; one that became unavailable stays
 * listed, disabled, with its reason and `reason` appended.
 */
function projectChoices(targets: OwnerTargets, reason: string, group?: string): MenuChoice[] {
  return targets.map(({ owner, disabled }) => {
    const why = owner.unavailable && `${owner.unavailable}${reason}`;
    return {
      id: owner.projectId!,
      label: owner.title,
      description: [owner.detail, why].filter(Boolean).join(" · "),
      icon: (
        <FolderGit2
          aria-hidden
          strokeWidth={1.5}
          className={cn("size-4", owner.unavailable ? "text-attention" : "text-muted-foreground")}
        />
      ),
      disabled: disabled !== null,
      ...(group && { group }),
    };
  });
}

/** Global, then the Project owners under their own heading. */
const ownerChoices = (targets: OwnerTargets, reason: string) => [
  globalChoice,
  ...projectChoices(targets.slice(1), reason, "Projects"),
];

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
  const id = useId();
  const { targets } = ownerPicker(filter.kind === "project" ? filter.projectId : null, projects);
  return (
    <ChoiceMenu
      id={id}
      label="Owner filter"
      trigger={{ prefix: "Owner:" }}
      value={filterValue(filter)}
      choices={[{ id: "all", label: "All" }, ...ownerChoices(targets, "")]}
      disabled={false}
      placeholder="All"
      className={cn("h-8 w-40 gap-1.5 bg-card pr-2 has-[>svg]:pr-2", className)}
      popupClassName="w-80"
      onChange={(value) =>
        onChange(
          value === "all" || value === "global"
            ? { kind: value }
            : { kind: "project", projectId: value },
        )
      }
    />
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
  quietStatus = false,
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
  const blocked = picker.blocked && `${picker.chosen.title}: ${picker.blocked}`;
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
          describedBy={blocked ? `${id}-status` : undefined}
          onChange={onChange}
        />
      )}
      <OwnerPickerStatus
        id={`${id}-status`}
        blocked={blocked}
        note={chosen === initial ? hint : ""}
        quiet={quietStatus}
      />
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

/**
 * The chosen owner's problem, or where its default came from. An empty note says nothing. A quiet
 * problem is shown beside the caller's action, so here it only describes the invalid field.
 */
function OwnerPickerStatus({
  id,
  blocked,
  note,
  quiet,
}: {
  id: string;
  blocked: string | null;
  note: string;
  quiet: boolean;
}) {
  if (blocked)
    return (
      <p
        id={id}
        role={quiet ? undefined : "alert"}
        className={quiet ? "sr-only" : "text-2xs tracking-label text-attention"}
      >
        {blocked}. Choose Global or an available Project.
      </p>
    );
  if (quiet || !note) return null;
  return <p className="text-2xs tracking-label text-subtle-foreground">{note}</p>;
}

/** Figma Run/SelectField for the owning Project, with each owner target as a choice. */
function OwningProjectMenu({
  labelId,
  chosen,
  targets,
  plural,
  disabled,
  describedBy,
  onChange,
}: {
  labelId: string;
  chosen: StudioOwner;
  targets: OwnerTargets;
  plural: string;
  disabled: boolean;
  describedBy: string | undefined;
  onChange: (owner: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span id={labelId} className={fieldLabelClass}>
        Owning Project
      </span>
      <ChoiceMenu
        id={`${labelId}-menu`}
        labelledBy={labelId}
        value={chosen.projectId ?? ""}
        choices={projectChoices(targets, ` — can’t own new ${plural}`)}
        disabled={disabled}
        placeholder="Choose a Project"
        trigger={{ icon: true, detail: chosen.detail ?? "" }}
        describedBy={describedBy}
        problemTone="error"
        onChange={onChange}
      />
    </div>
  );
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
  const changedFrom = chosen === from ? null : `changed from ${studioOwner(from, projects).title}`;
  const context = [picker.chosen.detail ?? "Usable in every project", changedFrom]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="grid gap-1.5">
      <span id={id} className={fieldLabelClass}>
        {label}
      </span>
      <ChoiceMenu
        id={`${id}-menu`}
        labelledBy={id}
        value={chosen ?? "global"}
        choices={ownerChoices(picker.targets, unavailableReason)}
        disabled={disabled}
        placeholder="Choose an owner"
        trigger={{ icon: true, detail: context }}
        describedBy={picker.blocked ? `${id}-status` : undefined}
        problemTone="error"
        onChange={(value) => onChange(value === "global" ? null : value)}
      />
      {picker.blocked && (
        <p id={`${id}-status`} role="alert" className="text-2xs tracking-label text-attention">
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
    <ProblemCard
      tone="info"
      icon={RefreshCw}
      title={
        to
          ? `This ${kind} is now ${to.projectId === null ? "Global" : `owned by ${ownerName(to)}`}`
          : `This ${kind}’s owner changed elsewhere`
      }
      action={
        change.status === "changed" && (
          <TextLink onClick={() => onAcknowledge(change.to)}>Acknowledge new owner</TextLink>
        )
      }
    >
      {change.status === "changed"
        ? "Your changes are kept. Acknowledge the new owner before saving."
        : "Your changes are kept. Waiting for Studio to show the new owner…"}
    </ProblemCard>
  );
}
