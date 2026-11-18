import { ProjectOption } from "./launch-picker-options.tsx";
import { useMutationsAllowed } from "@/client-gate";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { FactoryProject, ProjectCatalog } from "@t3-factory/contracts";
import { ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PickerMenuContent,
  PickerMenuList,
  PickerMenuSearch,
  pickerShowsSearch,
} from "./picker-menu-search.tsx";
import { api } from "../api.ts";
import { useLiveLaunchChoices } from "../live/launch-choices.ts";
import { cn } from "../lib/utils.ts";
import { selectFieldClass, toolbarPillClass, toolbarStatusClass } from "./page.tsx";
import { ProjectIcon } from "./project-icon.tsx";

function projectListStatus(catalog: ProjectCatalog | null, matched: number, query: string) {
  if (catalog === null) return "Loading projects…";
  if (query && matched === 0) return "No matching projects";
  return undefined;
}

function ProjectChoices({
  catalog,
  busy,
  search,
  listRef,
  onSelect,
}: {
  catalog: ProjectCatalog | null;
  busy: boolean;
  search: string;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (value: string) => void;
}) {
  const mutationsAllowed = useMutationsAllowed();
  const selectionDisabled = busy || !mutationsAllowed;
  const query = search.trim().toLocaleLowerCase();
  const projects = (catalog?.projects ?? []).filter((project) =>
    `${project.title} ${project.workspaceRoot}`.toLocaleLowerCase().includes(query),
  );
  const titles = projects.map((project) => project.title);
  const status = projectListStatus(catalog, projects.length, query);
  const positioned = useRef(false);
  useLayoutEffect(() => {
    if (positioned.current || !catalog) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-state="checked"]')
      ?.scrollIntoView({ block: "nearest" });
    positioned.current = true;
  }, [catalog, listRef]);
  const selected = projects.some((project) => project.id === catalog?.selectedProjectId)
    ? (catalog?.selectedProjectId ?? "")
    : "";
  return (
    <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
      {projects.map((project) => (
        <ProjectOption key={project.id} project={project} busy={selectionDisabled} peers={titles} />
      ))}
      {status && (
        <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </DropdownMenuRadioGroup>
  );
}

function ProjectTriggerSummary({
  selected,
  placeholder,
}: {
  selected: FactoryProject | undefined;
  placeholder: string;
}) {
  const available = selected?.availability === "available";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
      <ProjectIcon
        inline
        icon={selected?.projectIcon}
        faviconUrl={available ? (selected?.faviconUrl ?? null) : null}
      />
      {selected ? (
        <span className="min-w-0 flex-1 truncate font-medium">{selected.title}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>
      )}
    </span>
  );
}

/**
 * The live catalog and its commands. A command's response is not applied here: the catalog
 * follows live delivery, which publishes every committed project change.
 */
export function useProjectCatalog() {
  const catalog = useLiveLaunchChoices().value?.catalog ?? null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    return await action()
      .then(() => {
        return true;
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Project operation failed.");
        return false;
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return { catalog, error, busy, act };
}

/**
 * The Project pill of a wrapping toolbar row: the trigger shows the title and holds the repository
 * path as its tooltip; status lines are full-width rows after the toolbar's controls.
 */
export function ProjectPicker({
  state,
  selectedId,
  onSelect,
  disabled = false,
  placeholder = "No project selected",
}: {
  state: ReturnType<typeof useProjectCatalog>;
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { catalog, error, act } = state;
  const busy = state.busy || disabled;
  const choices = catalog && {
    ...catalog,
    selectedProjectId: selectedId,
    projects: catalog.projects.filter((project) => project.availability === "available"),
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const projectCount = choices?.projects.length ?? 0;
  const showSearch = pickerShowsSearch(projectCount);

  const selected = catalog?.projects.find((project) => project.id === selectedId);
  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open && !busy);
          if (open) setSearch("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-disabled={busy}
            aria-busy={busy}
            aria-label={`Select project: ${selected?.title ?? placeholder}`}
            // The pill can truncate the title, so the tooltip carries it along with the path.
            title={selected && `${selected.title}\n${selected.workspaceRoot}`}
            className={cn(selectFieldClass, toolbarPillClass, "w-45")}
          >
            <ProjectTriggerSummary selected={selected} placeholder={placeholder} />
            <ChevronsUpDownIcon
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <PickerMenuContent
          className="overflow-y-hidden"
          searchRef={searchRef}
          listRef={listRef}
          searchEnabled={showSearch}
        >
          {showSearch && (
            <PickerMenuSearch
              ariaLabel="Search projects"
              placeholder="Search projects"
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              listRef={listRef}
              firstChoiceSelector="[data-project-id]:not([data-disabled])"
            />
          )}
          <PickerMenuList
            listRef={listRef}
            label="Projects"
            watch={`${search}:${projectCount}:${catalog === null}`}
          >
            <ProjectChoices
              catalog={choices}
              busy={busy}
              search={search}
              listRef={listRef}
              onSelect={(value) => {
                if (busy || !value) return;
                setMenuOpen(false);
                void act(() => api.selectProject({ id: value })).then((success) => {
                  if (!success) return;
                  onSelect(value);
                });
              }}
            />
          </PickerMenuList>
          <DropdownMenuSeparator className="m-0 shrink-0" />
          <ProjectRefresh
            busy={busy}
            onRefresh={() => {
              void act(api.recheckProjects);
            }}
          />
        </PickerMenuContent>
      </DropdownMenu>
      {error && (
        <Alert variant="destructive" className={toolbarStatusClass}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

function ProjectRefresh({ busy, onRefresh }: { busy: boolean; onRefresh: () => void }) {
  const mutationsAllowed = useMutationsAllowed();
  const disabled = busy || !mutationsAllowed;
  return (
    <div className="shrink-0 p-1">
      <DropdownMenuItem disabled={disabled} onSelect={onRefresh}>
        <RefreshCwIcon aria-hidden /> Refresh projects
      </DropdownMenuItem>
    </div>
  );
}
