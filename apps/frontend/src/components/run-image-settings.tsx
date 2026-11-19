import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  ImageOff,
  Trash2,
} from "lucide-react";
import {
  type EligibleRunImage,
  type FactoryProject,
  type RunImageReference,
  type RunImageDeletion,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { ChoiceMenu } from "@/components/choice-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RUN_IMAGE_DELETION_LIMIT } from "@t3-factory/domain-validation";
import { api } from "../api.ts";
import { MutationGate } from "../client-gate.tsx";
import { revalidateRunImages, useRunImageSource } from "../run-images.ts";
import { useProjects } from "../use-projects.ts";
import { StatusBadge } from "./status-badge.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsGroup, SettingsPage } from "./settings-page.tsx";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const lifecycleLabel = { settled: "Settled", archived: "Archived" } as const;
const imageType = (image: EligibleRunImage) => image.mimeType.slice("image/".length).toUpperCase();
const runLabel = (run: RunImageReference) =>
  run.number === null ? run.title : `#${run.number} ${run.title}`;
const unique = (values: readonly string[]) => [...new Set(values)];

/** "#42 Add sign-in · Archived", or "2 Runs · #29, #33 · Settled" for a shared image. */
function runsSummary(runs: readonly RunImageReference[]) {
  const states = unique(runs.map((run) => lifecycleLabel[run.lifecycle])).join(", ");
  const numbers = runs.map((run) => (run.number === null ? run.title : `#${run.number}`));
  return [runs.length > 1 && count(runs.length, "Run"), numbers.join(", "), states]
    .filter(Boolean)
    .join(" · ");
}

const storageSize = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1_000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

const projectsOf = (image: EligibleRunImage) =>
  unique(image.runs.map((run) => run.project.title)).join(", ");

/**
 * Figma Settings/Section · Run images: stored images whose every Run is Settled or Archived, as
 * the server lists them for the chosen project, with an in-section preview.
 */
export function RunImageSettings() {
  const projects = useProjects() ?? [];
  const [projectId, setProjectId] = useState("");
  const [listed, setListed] = useState(0);
  const listing = useEligibleImages(projectId, listed);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const deletion = useImageDeletion(() => setListed((n) => n + 1));
  const { images } = listing;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const visible = images ? withKeptImages(images, deletion.kept, projectId) : [];
  const index = visible.findIndex((image) => image.sha256 === previewed);
  const removable =
    images?.filter((image) => !deletion.kept.some((kept) => kept.sha256 === image.sha256)) ?? [];
  const deleteAction = (image: EligibleRunImage) =>
    removable.includes(image) ? () => deletion.ask({ scope: "one", images: [image] }) : undefined;
  const confirmation = deletion.pending && (
    <DeleteConfirmation
      deletion={deletion.pending}
      project={project}
      busy={deletion.busy}
      onCancel={deletion.cancel}
      onConfirm={() => void deletion.confirm()}
    />
  );
  const notices = (
    <RunImageProblems
      listError={listing.error}
      deleteError={deletion.error}
      kept={deletion.kept.length}
      skipped={deletion.skipped}
    />
  );
  const image = visible[index];
  const page = image ? (
    <RunImagePreview
      image={image}
      index={index}
      total={visible.length}
      onIndexChange={(next) => setPreviewed(visible[next]!.sha256)}
      onBack={() => setPreviewed(null)}
      onDelete={deleteAction(image)}
      notices={notices}
    />
  ) : (
    <SettingsPage
      title="Run images"
      badge={!images && !listing.error && <StatusBadge kind="checking">Checking</StatusBadge>}
      action={
        <RunImageActions
          projects={projects}
          projectId={projectId}
          failed={Boolean(listing.error)}
          onProjectChange={(next) => {
            setPreviewed(null);
            setProjectId(next);
          }}
          onRetry={listing.retry}
          removable={removable.length}
          onDelete={() => deletion.ask({ scope: "all", images: removable })}
        />
      }
    >
      {notices}
      {images && (
        <RunImageList
          images={visible}
          project={project}
          onOpen={setPreviewed}
          deleteAction={deleteAction}
        />
      )}
    </SettingsPage>
  );
  return (
    <>
      {page}
      {confirmation}
    </>
  );
}

function RunImageProblems({
  listError,
  deleteError,
  kept,
  skipped,
}: {
  listError: string;
  deleteError: string;
  kept: number;
  skipped: number;
}) {
  const other = skipped - kept;
  return (
    <>
      {listError && (
        <ProblemCard tone="error" title="Couldn’t list Run images" details={listError}>
          No images were changed.
        </ProblemCard>
      )}
      {deleteError && (
        <ProblemCard tone="error" title="Couldn’t delete the images" details={deleteError}>
          Try again in a moment.
        </ProblemCard>
      )}
      {skipped > 0 && (
        <ProblemCard tone="neutral" title={deletionResultTitle(kept, skipped)}>
          {kept > 0 &&
            `Active Runs still use ${kept === 1 ? "the retained image" : `${kept} retained images`}.`}
          {kept > 0 && other > 0 && " "}
          {other > 0 &&
            `${count(other, "file")} ${other === 1 ? "was" : "were"} unavailable for deletion.`}
        </ProblemCard>
      )}
    </>
  );
}

function deletionResultTitle(kept: number, skipped: number) {
  const countText = `${count(skipped, "image")} ${skipped === 1 ? "was" : "were"}`;
  return `${countText} ${kept === skipped ? "kept" : "skipped"}`;
}

function RunImageActions({
  projects,
  projectId,
  failed,
  onProjectChange,
  onRetry,
  removable,
  onDelete,
}: {
  projects: readonly FactoryProject[];
  projectId: string;
  failed: boolean;
  onProjectChange: (projectId: string) => void;
  onRetry: () => void;
  removable: number;
  onDelete: () => void;
}) {
  return (
    <>
      <ChoiceMenu
        id="run-images-project"
        label="Project"
        value={projectId}
        choices={[
          { id: "", label: "All projects" },
          ...projects.map((item) => ({ id: item.id, label: item.title })),
        ]}
        disabled={false}
        placeholder="All projects"
        className="h-8 w-48"
        onChange={onProjectChange}
      />
      {failed && <Button onClick={onRetry}>Try again</Button>}
      {removable > 0 && (
        <MutationGate>
          <Button variant="destructive" onClick={onDelete}>
            Delete {count(removable, "image")}…
          </Button>
        </MutationGate>
      )}
    </>
  );
}

function withKeptImages(
  images: readonly EligibleRunImage[],
  kept: readonly EligibleRunImage[],
  projectId: string,
) {
  const listed = new Set(images.map((image) => image.sha256));
  return [
    ...images,
    ...kept.filter(
      (image) =>
        !listed.has(image.sha256) &&
        (!projectId || image.runs.some((run) => run.project.id === projectId)),
    ),
  ];
}

/** One answer to a listing request: the request it answers and its images or failure. */
type ListingAnswer = { images: readonly EligibleRunImage[] } | { error: string };
type Listing = { request: number } & ListingAnswer;

/**
 * The server's eligible list for the project filter, read again whenever `listed` changes or
 * `retry` is called. Choosing a filter or retrying starts a new request, and only that request's
 * answer is shown: `images` is null and `error` empty until it arrives, so an earlier answer for
 * the same filter never stands in for it. Relisting after a deletion keeps the shown list until
 * the new one arrives.
 */
function useEligibleImages(projectId: string, listed: number) {
  const [request, setRequest] = useState({ projectId, number: 0 });
  if (request.projectId !== projectId) setRequest({ projectId, number: request.number + 1 });
  const [listing, setListing] = useState<Listing>();
  useEffect(() => {
    let active = true;
    const answer = (result: ListingAnswer) =>
      active && setListing({ request: request.number, ...result });
    api.listEligibleRunImages(request.projectId).then(
      (images) => answer({ images }),
      (cause: unknown) =>
        answer({
          error: cause instanceof Error ? cause.message : "Run images could not be listed.",
        }),
    );
    return () => {
      active = false;
    };
  }, [request, listed]);
  const current = listing?.request === request.number ? listing : undefined;
  return {
    images: current && "images" in current ? current.images : null,
    error: current && "error" in current ? current.error : "",
    retry: () => setRequest((previous) => ({ ...previous, number: previous.number + 1 })),
  };
}

/** The pending confirmation, the deletion it confirms and its outcome; `deleted` relists. */
function useImageDeletion(deleted: () => void) {
  const [pending, setPending] = useState<Deletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kept, setKept] = useState<readonly EligibleRunImage[]>([]);
  const [skipped, setSkipped] = useState(0);
  const ask = (next: Deletion) => {
    setError("");
    setPending(next);
  };
  const confirm = async () => {
    if (!pending) return;
    const digests = pending.images.map((image) => image.sha256);
    setBusy(true);
    const record = (result: RunImageDeletion) => {
      setSkipped((previous) => previous + result.skipped.length);
      setKept((previous) => [
        ...previous,
        ...pending.images.filter((image) => result.keptForActiveRuns?.includes(image.sha256)),
      ]);
    };
    return await deleteImages(digests, record)
      .then(() => setPending(null))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Run images could not be deleted.");
        setPending(null);
      })
      .finally(() => {
        setBusy(false);
        // A partial or lost answer cannot say which bytes are gone, so the server decides for all.
        revalidateRunImages(digests);
        deleted();
      });
  };
  return { pending, busy, error, kept, skipped, ask, cancel: () => setPending(null), confirm };
}

/** What a confirmation would delete: one image, or every image the current filter lists. */
type Deletion = { scope: "one" | "all"; images: readonly EligibleRunImage[] };

/** Reports every batch's kept images even if a subsequent batch fails. */
async function deleteImages(
  digests: readonly string[],
  record: (result: RunImageDeletion) => void,
) {
  for (let start = 0; start < digests.length; start += RUN_IMAGE_DELETION_LIMIT) {
    const batch = digests.slice(start, start + RUN_IMAGE_DELETION_LIMIT);
    record(await api.deleteRunImages({ sha256: batch }));
  }
}

function runHistoryCopy(runs: readonly RunImageReference[]) {
  const numbers = runs.map((run) => (run.number === null ? run.title : `#${run.number}`));
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(numbers);
  return runs.length === 1
    ? `Run ${list} keeps its history and shows “Image unavailable”.`
    : `Runs ${list} keep their history and show “Image unavailable”.`;
}

/** A filtered Delete all's note on other projects: kept, or also losing a shared image. */
function otherProjectsNote(images: readonly EligibleRunImage[], project: FactoryProject) {
  const shared = images.filter((image) =>
    image.runs.some((run) => run.project.id !== project.id),
  ).length;
  if (shared === 0) return " Images in other projects are kept.";
  return ` ${count(shared, "image")} ${shared === 1 ? "is" : "are"} also used by Runs in other projects; those Runs show “Image unavailable” too.`;
}

/** The confirmation's title, description and action for one image or every listed image. */
function deletionCopy({ scope, images }: Deletion, project: FactoryProject | null) {
  if (scope === "one") {
    const image = images[0]!;
    return {
      title: `Delete “${image.name}”?`,
      description: runHistoryCopy(image.runs),
      action: "Delete image",
    };
  }
  const title = count(images.length, "image");
  return {
    title: `Delete ${title}${project ? ` in ${project.title}` : ""}?`,
    description: `Their Runs keep their history and show “Image unavailable”.${project ? otherProjectsNote(images, project) : ""}`,
    action: `Delete ${title}`,
  };
}

/** Figma R10c/R10e: what the deletion removes and keeps, with Cancel and the danger action. */
function DeleteConfirmation({
  deletion,
  project,
  busy,
  onCancel,
  onConfirm,
}: {
  deletion: Deletion;
  project: FactoryProject | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { title, description, action } = deletionCopy(deletion, project);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        role="alertdialog"
        title={title}
        description={description}
        closeDisabled={busy}
        actions={
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <MutationGate>
              <Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>
                {busy ? "Deleting…" : action}
              </Button>
            </MutationGate>
          </>
        }
      />
    </Dialog>
  );
}

function RunImageList({
  images,
  project,
  onOpen,
  deleteAction,
}: {
  images: readonly EligibleRunImage[];
  project: FactoryProject | null;
  onOpen: (sha256: string) => void;
  deleteAction: (image: EligibleRunImage) => (() => void) | undefined;
}) {
  if (!images.length)
    return (
      <div className="flex min-h-55 items-center justify-center gap-2 text-sm text-muted-foreground">
        <ImageIcon aria-hidden strokeWidth={1.5} className="size-4" />
        <p>No Run images</p>
      </div>
    );
  return (
    <div className="grid gap-2">
      <RunImageSummary images={images} project={project} />
      <ul
        aria-label="Run images"
        className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4"
      >
        {images.map((image) => (
          <li key={image.sha256}>
            <RunImageCard
              image={image}
              onOpen={() => onOpen(image.sha256)}
              onDelete={deleteAction(image)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunImageSummary({
  images,
  project,
}: {
  images: readonly EligibleRunImage[];
  project: FactoryProject | null;
}) {
  const bytes = images.reduce((total, image) => total + image.sizeBytes, 0);
  const runs = new Set(
    images.flatMap((image) =>
      image.runs.filter((run) => !project || run.project.id === project.id).map((run) => run.id),
    ),
  );
  return (
    <p className="text-sm text-muted-foreground">
      {count(images.length, "image")} · {storageSize(bytes)} · {count(runs.size, "Run")}
      {project && ` in ${project.title}`}
    </p>
  );
}

/** The retained bytes, or an unavailable icon when they fail to load. */
function StoredImage({ image, preview }: { image: EligibleRunImage; preview?: boolean }) {
  const [unavailable, setUnavailable] = useState(false);
  const source = useRunImageSource();
  if (unavailable)
    return (
      <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
        <ImageOff aria-hidden strokeWidth={1.5} className="size-4" />
        {preview && "Image unavailable"}
      </span>
    );
  return (
    <img
      src={source(image.sha256)}
      alt={preview ? image.name : ""}
      loading="lazy"
      className={preview ? "size-full object-contain" : "size-full object-cover"}
      onError={() => setUnavailable(true)}
    />
  );
}

/** Figma Settings/RunImageCard: thumbnail, name, size and type, its Runs and their projects. */
function RunImageCard({
  image,
  onOpen,
  onDelete,
}: {
  image: EligibleRunImage;
  onOpen: () => void;
  onDelete: (() => void) | undefined;
}) {
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        aria-label={`Preview ${image.name}`}
        onClick={onOpen}
        className="group grid h-auto w-full justify-stretch gap-1.5 p-0 text-left font-normal whitespace-normal hover:bg-transparent"
      >
        <span className="block aspect-[162/104] overflow-hidden rounded-md border bg-card group-hover:border-border-strong">
          <StoredImage key={image.sha256} image={image} />
        </span>
        <span className="grid min-w-0 gap-px">
          <span className="truncate text-sm font-medium text-foreground">{image.name}</span>
          <span className="truncate text-2xs text-muted-foreground">
            {storageSize(image.sizeBytes)} · {imageType(image)}
          </span>
          <span className="truncate text-2xs text-muted-foreground">{runsSummary(image.runs)}</span>
          <span className="truncate text-2xs text-muted-foreground">{projectsOf(image)}</span>
        </span>
      </Button>
      {onDelete && (
        <div className="absolute top-0 right-0">
          <MutationGate>
            <IconButton label={`Delete ${image.name}`} onClick={onDelete} destructive>
              <Trash2 aria-hidden strokeWidth={1.5} />
            </IconButton>
          </MutationGate>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={destructive ? "size-9 p-1 hover:bg-transparent" : undefined}
          aria-label={label}
          onClick={onClick}
        >
          {destructive ? (
            <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-card text-foreground hover:border-destructive hover:text-destructive">
              {children}
            </span>
          ) : (
            children
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** One listed image at full size with every Run that uses it; ←/→ step within the list. */
function RunImagePreview({
  image,
  index,
  total,
  onIndexChange,
  onBack,
  onDelete,
  notices,
}: {
  image: EligibleRunImage;
  index: number;
  total: number;
  onIndexChange: (index: number) => void;
  onBack: () => void;
  onDelete: (() => void) | undefined;
  notices: ReactNode;
}) {
  const step = (offset: number) => onIndexChange((index + offset + total) % total);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!offset || total < 2) return;
    event.preventDefault();
    step(offset);
  };
  return (
    <section aria-label={`Preview of ${image.name}`} onKeyDown={onKeyDown}>
      <SettingsPage
        title={image.name}
        leading={
          <IconButton label="Back to Run images" onClick={onBack}>
            <ArrowLeft aria-hidden strokeWidth={1.5} />
          </IconButton>
        }
        badge={
          <span className="text-sm text-muted-foreground">
            {index + 1} of {total}
          </span>
        }
        action={
          <>
            {total > 1 && (
              <>
                <IconButton label="Previous image" onClick={() => step(-1)}>
                  <ChevronLeft aria-hidden strokeWidth={1.5} />
                </IconButton>
                <IconButton label="Next image" onClick={() => step(1)}>
                  <ChevronRight aria-hidden strokeWidth={1.5} />
                </IconButton>
              </>
            )}
            {onDelete && (
              <MutationGate>
                <Button variant="destructive" onClick={onDelete}>
                  Delete image…
                </Button>
              </MutationGate>
            )}
          </>
        }
      >
        {notices}
        <div className="h-75 overflow-hidden rounded-md border bg-card">
          <StoredImage key={image.sha256} image={image} preview />
        </div>
        <SettingsGroup label="Used by">
          {image.runs.map((run) => (
            <UsedByRow key={run.id} run={run} />
          ))}
        </SettingsGroup>
      </SettingsPage>
    </section>
  );
}

function UsedByRow({ run }: { run: RunImageReference }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-sm text-foreground">{runLabel(run)}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {lifecycleLabel[run.lifecycle]} · {run.project.title} · Image {run.ordinal}
        </span>
      </div>
      <Button asChild variant="ghost" size="xs">
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          search={{}}
          aria-label={`Open Run ${runLabel(run)}`}
        >
          Open Run
          <ExternalLink aria-hidden strokeWidth={1.5} />
        </Link>
      </Button>
    </div>
  );
}
