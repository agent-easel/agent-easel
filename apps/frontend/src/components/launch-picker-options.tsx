import type { FactoryProject, FlowDraft } from "@t3-factory/contracts";
import { Workflow } from "lucide-react";
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
  return (
    <DropdownMenuRadioItem
      value={project.id}
      data-project-id={project.id}
      indicatorPosition="right"
      disabled={busy}
      aria-label={`${project.title} · ${project.workspaceRoot} · ${projectAvailabilityLabels.available}`}
      className="items-start py-1.5 pl-2"
    >
      <span className="mt-px">
        <ProjectIcon inline icon={project.projectIcon} faviconUrl={project.faviconUrl} />
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
      </span>
    </DropdownMenuRadioItem>
  );
}

/** Run/FlowOption: a 32 px row with the Flow icon; the chosen Flow shows only the check. */
const flowRowClass = "h-8 items-center py-0 pl-2";

function FlowIcon({ muted }: { muted?: boolean }) {
  return (
    <Workflow
      aria-hidden
      strokeWidth={1.5}
      className={muted ? "text-muted-foreground opacity-50" : "text-muted-foreground"}
    />
  );
}

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
      className={flowRowClass}
    >
      <FlowIcon />
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
      className={`${flowRowClass} pr-2 data-[disabled]:opacity-100`}
    >
      <FlowIcon muted />
      <MenuName name={flow.name} peers={peers} className="text-subtle-foreground" />
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
      <DropdownMenuLabel className="px-2 text-xs normal-case">{title}</DropdownMenuLabel>
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
