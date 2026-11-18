import type { FactoryProject, FlowDraft } from "@t3-factory/contracts";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { MenuName } from "./menu-name.tsx";
import { ProjectIcon } from "./project-icon.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { projectAvailabilityLabels } from "../use-projects.ts";

export function ProjectOption({
  project,
  busy,
  peers,
}: {
  project: FactoryProject;
  busy: boolean;
  peers: readonly string[];
}) {
  const available = project.availability === "available";
  const availability = projectAvailabilityLabels[project.availability];
  return (
    <DropdownMenuRadioItem
      value={project.id}
      data-project-id={project.id}
      indicatorPosition="right"
      disabled={busy}
      aria-label={`${project.title} · ${project.workspaceRoot} · ${availability}`}
      className="my-0.5 items-start rounded-md py-2 data-[state=checked]:bg-brand-soft data-[state=checked]:ring-1 data-[state=checked]:ring-brand-soft-border data-[state=checked]:ring-inset data-[state=checked]:focus:bg-brand-soft data-[state=checked]:focus-visible:ring-2 data-[state=checked]:focus-visible:ring-ring"
    >
      <span className="mt-px">
        <ProjectIcon
          inline
          icon={project.projectIcon}
          faviconUrl={project.availability === "available" ? project.faviconUrl : null}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0">
          <MenuName name={project.title} peers={peers} className="font-medium" />
        </span>
        <span
          className="mt-0.5 block truncate text-left text-2xs tracking-label text-subtle-foreground"
          title={project.workspaceRoot}
          dir="rtl"
        >
          <bdi dir="ltr">{project.workspaceRoot}</bdi>
        </span>
        {!available && (
          <span className="mt-1 block text-xs text-attention">
            {availability} · New Runs blocked
          </span>
        )}
      </span>
    </DropdownMenuRadioItem>
  );
}

const flowRadioItemClass =
  "my-0.5 rounded-md py-2 data-[state=checked]:bg-brand-soft data-[state=checked]:ring-1 data-[state=checked]:ring-brand-soft-border data-[state=checked]:ring-inset data-[state=checked]:focus:bg-brand-soft data-[state=checked]:focus-visible:ring-2 data-[state=checked]:focus-visible:ring-ring";

function FlowChoice({
  flow,
  busy,
  peers,
}: {
  flow: FlowDraft;
  busy: boolean;
  peers: readonly string[];
}) {
  return (
    <DropdownMenuRadioItem
      value={flow.id}
      data-flow-id={flow.id}
      indicatorPosition="right"
      disabled={busy}
      aria-label={flow.name}
      className={flowRadioItemClass}
    >
      <MenuName name={flow.name} peers={peers} />
    </DropdownMenuRadioItem>
  );
}

/** A not-ready Flow stays visible and cannot be chosen, hovered, or checked. */
function FlowUnavailable({ flow, peers }: { flow: FlowDraft; peers: readonly string[] }) {
  return (
    <DropdownMenuItem
      disabled
      data-flow-id={flow.id}
      aria-label={`${flow.name} · Not ready`}
      className="my-0.5 rounded-md py-2 data-[disabled]:opacity-100"
    >
      <MenuName name={flow.name} peers={peers} className="text-muted-foreground" />
      <StatusBadge kind="error">Not ready</StatusBadge>
    </DropdownMenuItem>
  );
}

/** One heading and its Flows, ready first, or nothing when none match. */
export function FlowGroup({
  title,
  flows,
  busy,
  peers,
}: {
  title: string;
  flows: readonly FlowDraft[];
  busy: boolean;
  peers: readonly string[];
}) {
  if (flows.length === 0) return null;
  return (
    <>
      <DropdownMenuLabel className="normal-case">{title}</DropdownMenuLabel>
      {flows.map((flow) =>
        flow.readiness.ready ? (
          <FlowChoice key={flow.id} flow={flow} busy={busy} peers={peers} />
        ) : (
          <FlowUnavailable key={flow.id} flow={flow} peers={peers} />
        ),
      )}
    </>
  );
}
