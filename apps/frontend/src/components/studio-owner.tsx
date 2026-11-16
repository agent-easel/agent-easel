import { useId } from "react";
import type { FactoryProject } from "@t3-factory/contracts";
import { ChevronDown, ChevronsUpDown, FolderGit2, Workflow } from "lucide-react";
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
import { fieldLabelClass, selectFieldClass } from "./page.tsx";
import {
  ownerPicker,
  studioOwner,
  type StudioOwner,
  type StudioOwnerFilter,
} from "../studio-definitions.ts";

/** The owner's name as one line: "Global", or the Project title and why it is unavailable. */
export function ownerName(owner: StudioOwner) {
  return owner.unavailable ? `${owner.title} · unavailable` : owner.title;
}

/** Figma Studio/OwnerBadge: Global, an owning Project, or an unavailable owning Project. */
export function OwnerBadge({ owner, prefix }: { owner: StudioOwner; prefix?: string }) {
  const Icon = owner.projectId === null ? Workflow : FolderGit2;
  const label = owner.projectId === null ? owner.title : `${prefix ?? ""}${ownerName(owner)}`;
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
 * Figma Studio/OwnerGroupHeader: one owner's group in a Studio list, with its repository path,
 * the availability reason of an unavailable Project and the group's count.
 */
export function OwnerGroupHeader({
  owner,
  count,
  consequence,
}: {
  owner: StudioOwner;
  count: string;
  /** What unavailability means for this list, such as "Flows here can't start." */
  consequence: string;
}) {
  const Icon = owner.projectId === null ? Workflow : FolderGit2;
  return (
    <h2 className="flex min-w-0 items-center gap-2 pt-2.5 pb-1.5 text-base leading-none font-semibold tracking-tight">
      <Icon
        aria-hidden
        className={cn(
          "size-3.25 shrink-0",
          owner.projectId === null
            ? "text-muted-foreground"
            : owner.unavailable
              ? "text-attention"
              : "text-brand-cyan",
        )}
        strokeWidth={1.5}
      />
      <span className="shrink-0">{owner.title}</span>
      <OwnerPath
        path={owner.detail ?? "Usable in every project"}
        className="text-2xs leading-none font-normal tracking-label text-subtle-foreground"
      />
      {owner.unavailable && (
        <span className="min-w-0 truncate text-2xs leading-none font-medium tracking-normal text-attention">
          {owner.unavailable}. {consequence}
        </span>
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

/** Figma Studio/OwnerFilter: All, Global or one Project; Studio's lists share it. */
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
  const { targets } = ownerPicker(null, projects);
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
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)]">
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
          <DropdownMenuRadioItem value="all" indicatorPosition="right">
            All owners
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="global" indicatorPosition="right">
            Global
          </DropdownMenuRadioItem>
          {targets.length > 1 && <DropdownMenuSeparator />}
          {targets.slice(1).map(({ owner }) => (
            <DropdownMenuRadioItem
              key={owner.projectId}
              value={owner.projectId!}
              indicatorPosition="right"
              aria-label={`${owner.title} · ${owner.detail}${owner.unavailable ? ` · ${owner.unavailable}` : ""}`}
              className="items-start"
            >
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
  "group flex w-full items-start gap-2.5 rounded-md border bg-background px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-accent";

/** What each owner kind means for a new Flow or Agent. */
const ownerKindText = {
  Flow: {
    global: "Usable in every project. Can place only Global Agents.",
    project: "Runs only in its owning Project. Can place Global Agents and that Project’s Agents.",
    plural: "Flows",
  },
  Agent: {
    global: "Usable in every project. Any Flow can place it.",
    project: "Only Flows of its owning Project can place it.",
    plural: "Agents",
  },
} as const;

type DefinitionKind = keyof typeof ownerKindText;

/**
 * The always-visible owner choice of New Flow and Add agent: Global, or a Project chosen from
 * the catalog. Unavailable Projects are disabled with their reason; an unavailable chosen owner
 * stays chosen with its reason rather than being replaced.
 */
export function OwnerPicker({
  chosen,
  projects,
  onChange,
  disabled,
  kind,
  initial,
  hint,
}: {
  chosen: string | null;
  projects: readonly FactoryProject[];
  onChange: (owner: string | null) => void;
  disabled: boolean;
  /** Whether a Flow or an Agent is created, for the option descriptions. */
  kind: DefinitionKind;
  /** The preselected owner; `hint` says where it came from while it is still chosen. */
  initial: string | null;
  hint: string;
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
        className="grid gap-1.5"
      >
        <OwnerKind value="global" title="Global" description={text.global} />
        <OwnerKind
          value="project"
          title="Project"
          description={text.project}
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
      <OwnerPickerStatus
        blocked={picker.blocked && `${picker.chosen.title}: ${picker.blocked}`}
        note={chosen === initial ? hint : `Only available Projects can own new ${text.plural}.`}
      />
    </div>
  );
}

/** One owner kind card with its radio dot. */
function OwnerKind({
  value,
  title,
  description,
  disabled,
}: {
  value: string;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup.Item value={value} disabled={disabled} className={ownerKindClass}>
      <OwnerRadioMark />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-2xs tracking-label text-subtle-foreground">{description}</span>
      </span>
    </RadioGroup.Item>
  );
}

/** The chosen owner's problem, or where its default came from. */
function OwnerPickerStatus({ blocked, note }: { blocked: string | null; note: string }) {
  if (blocked)
    return (
      <p role="alert" className="text-2xs tracking-label text-attention">
        {blocked}. Choose Global or an available Project.
      </p>
    );
  return <p className="text-2xs tracking-label text-subtle-foreground">{note}</p>;
}

/** Figma Run/SelectField for the owning Project, with every Project as a menu choice. */
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
            className={cn(selectFieldClass, "disabled:opacity-50")}
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
            {targets.map(({ owner, disabled: reason }) => (
              <DropdownMenuRadioItem
                key={owner.projectId}
                value={owner.projectId!}
                disabled={reason !== null}
                indicatorPosition="right"
                aria-label={[owner.title, owner.detail, reason].filter(Boolean).join(" · ")}
                className="items-start py-1.5"
              >
                <FolderGit2
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <OwnerOptionText owner={owner} reason={` — can’t own new ${plural}`} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
export function OwnerPath({ path, className }: { path: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-left", className)} title={path} dir="rtl">
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

/** Where New Flow's or Add agent's preselected owner came from. */
export function ownerHint(
  filter: StudioOwnerFilter,
  projects: readonly FactoryProject[],
  kind: "Flows" | "Agents",
  fromFlow?: { readonly name: string; readonly projectId: string | null },
) {
  const rule = `Only available Projects can own new ${kind}.`;
  if (fromFlow)
    return `Prefilled from the Flow “${fromFlow.name}” (${studioOwner(fromFlow.projectId, projects).title}), so it can place this Agent. ${rule}`;
  if (filter.kind === "all") return `Starts Global while the Owner filter shows All. ${rule}`;
  const title = filter.kind === "global" ? "Global" : studioOwner(filter.projectId, projects).title;
  return `Prefilled from the Owner filter (${title}). ${rule}`;
}
