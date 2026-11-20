import type { FactoryProject } from "@t3-factory/contracts";
import { DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { MenuName } from "./menu-name.tsx";
import { ProjectIcon } from "./project-icon.tsx";
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
