import { useSyncExternalStore } from "react";
import type {
  FlowDraft,
  LaunchChoices,
  PromptSegment,
  RunImage,
  StartRunInput,
  StartTitleProvenance,
  ValidationIssue,
} from "@agent-easel/contracts";
import {
  isCanonicalTimestamp,
  isStartTitleProvenance,
  parseStartPrompt,
  promptText,
  promptTitle,
  RUN_IMAGE_LIMIT,
  TASK_TITLE_LIMIT,
} from "@agent-easel/domain-validation";
import { randomId } from "./lib/ids.ts";
import { admittedStart, api, ApiError } from "./api.ts";
import { transport } from "./transport.ts";
import type { LiveScopeView } from "./live/owner.ts";
import {
  indexedDbImages,
  readImageFile,
  type DraftImageStore,
  type ImageUploads,
} from "./draft-images.ts";

/**
 * Client-local Run preparation. It exists while its prompt has a non-whitespace character or it
 * has an image; Start needs text.
 */
export interface SavedRunDraft {
  readonly id: string;
  readonly segments: readonly PromptSegment[];
  /** Image manifest in attachment order; the bytes live in the draft image store. */
  readonly images: readonly RunImage[];
  readonly projectId: string;
  readonly flowId: string;
  /** A title chosen by the user; absent while the title follows the prompt. */
  readonly manualTitle?: string;
  /**
   * Automatic until the user renames the draft, then manual. A draft saved before provenance
   * existed is legacy: whether its title was chosen is never guessed.
   */
  readonly titleProvenance: StartTitleProvenance;
  readonly createdAt: string;
  /** Run navigation shows the draft once the user has left its composition. */
  readonly listed: boolean;
  /** The frozen Start request awaiting a confirmed outcome. */
  readonly submission?: StartRunInput;
}

/** Where the user fixes a rejected Start: Agent reporting setup, or the Agent and Flow choices. */
type StartRemedy = "reporting" | "studio";

/**
 * Places references to just-attached images, in order, into the prompt and returns the prompt,
 * or nothing to leave it as it is.
 */
export type PlaceReferences = (imageIds: readonly string[]) => readonly PromptSegment[] | undefined;

/** A file the composer did not attach, with why. */
export interface ImageRejection {
  readonly name: string;
  readonly reason: string;
}

/** An accepted file's attached image, which may already have held its bytes, or its rejection. */
type FileOutcome = { attached: string } | { rejected: ImageRejection };

const rejection = (name: string, reason: string): FileOutcome => ({ rejected: { name, reason } });

interface RunDraft {
  draftId: string | undefined;
  /**
   * Changes each time the composer opens a saved draft or a fresh composition, and never while
   * the open one is edited, so a fresh draft receiving its id keeps the same value.
   */
  opening: number;
  projectId: string;
  flowId: string;
  /** The prompt in order: text, and references to images of the manifest. */
  segments: readonly PromptSegment[];
  /** The prompt's text alone, which Start requires. */
  text: string;
  images: readonly RunImage[];
  imageRejections: readonly ImageRejection[];
  pending: boolean;
  busy: boolean;
  error: string;
  remedy: StartRemedy;
  issues: readonly ValidationIssue[];
  saveFailed: boolean;
}

type Choice = "projectId" | "flowId";

interface Composition {
  projectId: string;
  flowId: string;
  segments: readonly PromptSegment[];
  images: readonly RunImage[];
}

const composition = (saved: SavedRunDraft): Composition => ({
  projectId: saved.projectId,
  flowId: saved.flowId,
  segments: saved.segments,
  images: saved.images,
});

const unknownOutcome =
  "Start outcome unknown. Your input and request identity are kept. Check the same request again to recover its Run without creating a duplicate.";

const unsavedUnknownOutcome =
  "Start outcome unknown, and this browser could not save the request for recovery after a reload. Keep this window open and check the same request again to recover its Run without creating a duplicate.";

/**
 * The Flows the composer's picker offers: every global Flow, then every Flow of the selected
 * Project. Ready Flows come first and not-ready Flows follow, in each group. Without a Project
 * the picker is disabled and offers none.
 */
export function composerFlows(flows: readonly FlowDraft[], projectId: string) {
  const ordered = (matched: readonly FlowDraft[]) => [
    ...matched.filter((flow) => flow.readiness.ready),
    ...matched.filter((flow) => !flow.readiness.ready),
  ];
  return {
    disabled: !projectId,
    global: projectId ? ordered(flows.filter((flow) => flow.projectId === null)) : [],
    project: projectId ? ordered(flows.filter((flow) => flow.projectId === projectId)) : [],
  };
}

export function draftTitle(draft: Pick<SavedRunDraft, "segments" | "manualTitle">) {
  return draft.manualTitle ?? promptTitle(promptText(draft.segments)) ?? "Untitled draft";
}

/**
 * Newest first, then ascending creation key: the order Run navigation uses. A draft's key is
 * its id, which its Start sends as the request key, so its Run takes the same place.
 */
export function byCreation(
  a: { createdAt: string; id: string; creationKey?: string },
  b: typeof a,
) {
  const age = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (age) return age;
  const [first, second] = [a.creationKey ?? a.id, b.creationKey ?? b.id];
  return first < second ? -1 : first > second ? 1 : 0;
}

const draftsKey = (server: string) => `factory-run-drafts:${server}`;

interface SavedDrafts {
  current: string | undefined;
  drafts: readonly SavedRunDraft[];
}

const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Adjacent text segments joined and empty ones dropped: one spelling for each prompt. */
export function joinedSegments(segments: readonly PromptSegment[]): PromptSegment[] {
  const joined: PromptSegment[] = [];
  for (const segment of segments) {
    const last = joined.at(-1);
    if (segment.type === "image") joined.push(segment);
    else if (last?.type === "text")
      joined[joined.length - 1] = { type: "text", text: last.text + segment.text };
    else if (segment.text) joined.push(segment);
  }
  return joined;
}

/** Drafts and submissions saved before provenance carry none; they are legacy. */
function readTitleProvenance(value: unknown) {
  if (value === undefined) return "legacy";
  return isStartTitleProvenance(value) ? value : undefined;
}

function readSubmission(value: unknown): StartRunInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const { requestId, projectId, flowId, title, createdAt } = fields;
  const prompt = parseStartPrompt(fields);
  const titleProvenance = readTitleProvenance(fields.titleProvenance);
  if (!filled(requestId) || !filled(projectId) || !filled(flowId) || !prompt) return undefined;
  if (!filled(title) || !titleProvenance || !isCanonicalTimestamp(createdAt)) return undefined;
  return Object.freeze({
    requestId,
    projectId,
    flowId,
    ...prompt,
    ...(fields.confirmCompletedIssues === true && { confirmCompletedIssues: true }),
    title,
    titleProvenance,
    createdAt,
  });
}

/** A draft exists while it has prompt text or an image. */
const retained = (draft: Pick<SavedRunDraft, "segments" | "images">) =>
  filled(promptText(draft.segments)) || draft.images.length > 0;

function readDraft(value: unknown): SavedRunDraft | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const { id, projectId, flowId, manualTitle, createdAt, listed, submission } = fields;
  const prompt = parseStartPrompt(fields);
  const titleProvenance = readTitleProvenance(fields.titleProvenance);
  if (!filled(id) || !prompt || !retained(prompt) || typeof projectId !== "string")
    return undefined;
  if (typeof flowId !== "string" || typeof listed !== "boolean") return undefined;
  if (!isCanonicalTimestamp(createdAt)) return undefined;
  if (manualTitle !== undefined && !filled(manualTitle)) return undefined;
  if (!titleProvenance) return undefined;
  const request = readSubmission(submission);
  if (submission !== undefined && !request) return undefined;
  return {
    id,
    ...prompt,
    projectId,
    flowId,
    ...(manualTitle === undefined ? {} : { manualTitle }),
    titleProvenance,
    createdAt,
    listed,
    ...(request ? { submission: request } : {}),
  };
}

/** Undefined when storage cannot be read; malformed saved data reads as no drafts. */
function readSaved(server: string): SavedDrafts | undefined {
  let text: string | null;
  try {
    text = localStorage.getItem(draftsKey(server));
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text ?? "null");
  } catch {
    value = null;
  }
  const { current, drafts } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const valid = Array.isArray(drafts) ? drafts.map(readDraft).filter((d) => d !== undefined) : [];
  return {
    current: typeof current === "string" ? current : undefined,
    drafts: valid.toSorted(byCreation),
  };
}

function writeSaved(server: string, saved: SavedDrafts) {
  try {
    localStorage.setItem(draftsKey(server), JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

function withoutSubmission({ submission, ...editable }: SavedRunDraft): SavedRunDraft {
  void submission;
  return editable;
}

function confirmedRejection(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && ["validation", "conflict", "not_found"].includes(error.detail.code)
  );
}

/** Factory's image staging through the API. */
const apiUploads: ImageUploads = {
  has: (image) => api.hasRunImage(image.sha256),
  upload: async (image, data) => {
    await admittedStart.stageRunImage(image.sha256, data);
  },
};

const missingDigests = (error: ApiError) =>
  new Set(error.detail.issues.map((issue) => issue.path.replace(/^images\./, "")));

/**
 * Factory reported an image missing and this browser no longer holds its bytes. Factory did not
 * accept the request, so the draft unlocks for the image to be removed or attached again.
 */
class LocalImageMissing extends Error {}

const missingImagesOutcome =
  "AgentEasel still lacks some images of this request. Check the same request to upload them again.";

export function createRunDraft(
  startRun: (submission: StartRunInput) => Promise<{ id: string }> = admittedStart.startRun,
  images: { store: DraftImageStore; uploads: ImageUploads } = {
    store: indexedDbImages,
    uploads: apiUploads,
  },
) {
  let server: string | undefined;
  const rememberedChoices = new Map<string, string>();
  function remembered(key: string) {
    if (server === undefined) return "";
    const name = `factory-last-${key}:${server}`;
    const cached = rememberedChoices.get(name);
    if (cached !== undefined) return cached;
    try {
      return localStorage.getItem(name) ?? "";
    } catch {
      return "";
    }
  }
  function rememberChoice(key: string, value: string) {
    if (server === undefined) return;
    const name = `factory-last-${key}:${server}`;
    rememberedChoices.set(name, value);
    try {
      localStorage.setItem(name, value);
    } catch {
      // Preferences remain available in memory when browser storage is unavailable.
    }
  }
  let drafts: readonly SavedRunDraft[] = [];
  let listedDrafts: readonly SavedRunDraft[] = [];
  let current: Composition = { projectId: "", flowId: "", segments: [], images: [] };
  let currentId: string | undefined;
  let opening = 0;
  let imageRejections: readonly ImageRejection[] = [];
  let error = "";
  let remedy: StartRemedy = "studio";
  let issues: readonly ValidationIssue[] = [];
  let saveFailed = false;
  /** The owners of the latest current delivery's Flows by id; absent while choices are not current. */
  let currentOwners: ReadonlyMap<string, string | null> | undefined;
  const unsaved = new Map<string, SavedRunDraft | undefined>();
  const inFlight = new Set<string>();
  let draft: Readonly<RunDraft> = snapshot();
  const listeners = new Set<() => void>();

  function snapshot(): RunDraft {
    const saved = drafts.find((d) => d.id === currentId);
    return {
      draftId: currentId,
      opening,
      ...current,
      text: promptText(current.segments),
      imageRejections,
      pending: !!saved?.submission,
      busy: !!currentId && inFlight.has(currentId),
      error,
      remedy,
      issues,
      saveFailed,
    };
  }
  function publish() {
    draft = snapshot();
    const listed = drafts.filter((d) => d.listed);
    if (
      listed.length !== listedDrafts.length ||
      listed.some((d, index) => d !== listedDrafts[index])
    )
      listedDrafts = listed;
    listeners.forEach((notify) => notify());
  }
  /**
   * Applies one draft's change over the latest saved drafts, so other tabs' edits to other
   * drafts survive and ordinary edits to the same draft are last-save-wins.
   */
  function commit(
    scope: string,
    id: string,
    change: (saved: SavedRunDraft | undefined) => SavedRunDraft | undefined,
  ) {
    const latest = latestDrafts(scope);
    const previous = latest.find((d) => d.id === id) ?? (scope === server ? find(id) : undefined);
    // Another tab's unresolved Start must survive this tab's stale edit, rename or discard.
    const unseenStart = scope === server && !!previous?.submission && !find(id)?.submission;
    if (unseenStart) show(previous);
    const next = unseenStart ? previous : change(previous);
    const others = latest.filter((d) => d.id !== id);
    const result = next ? [...others, next].toSorted(byCreation) : others;
    if (scope !== server)
      return writeSaved(scope, { current: readSaved(scope)?.current, drafts: result });
    const saved = store(scope, result);
    if (!saved) unsaved.set(id, next);
    return saved;
  }
  /** Writes the current server's drafts and open composition, tracking whether the write held. */
  function store(scope: string, result: readonly SavedRunDraft[]) {
    const saved = writeSaved(scope, { current: currentId, drafts: result });
    drafts = result;
    saveFailed = !saved;
    if (saved) unsaved.clear();
    return saved;
  }
  function latestDrafts(scope: string) {
    const stored = readSaved(scope)?.drafts;
    if (scope !== server) return stored ?? [];
    return stored ? withUnsaved(stored) : drafts;
  }
  /** Overlays this tab's changes that failed to save onto other tabs' stored drafts. */
  function withUnsaved(stored: readonly SavedRunDraft[]) {
    if (unsaved.size === 0) return stored;
    const kept = stored.filter((d) => !unsaved.has(d.id));
    const local = [...unsaved.values()].filter((d) => d !== undefined);
    return [...kept, ...local].toSorted(byCreation);
  }
  function find(id: string | undefined) {
    return drafts.find((d) => d.id === id);
  }
  function show(saved: SavedRunDraft | undefined) {
    opening += 1;
    currentId = saved?.id;
    issues = [];
    error = saved?.submission && !inFlight.has(saved.id) ? unknownOutcome : "";
    imageRejections = [];
    if (saved) current = composition(saved);
  }
  function selectServer(next: string) {
    if (next === server) return;
    server = next;
    unsaved.clear();
    const saved = readSaved(next);
    drafts = saved?.drafts ?? [];
    const restored = find(saved?.current);
    if (restored) show(restored);
    else {
      show(undefined);
      current = {
        projectId: remembered("project"),
        flowId: remembered("flow"),
        segments: [],
        images: [],
      };
    }
    pruneImages(next);
    publish();
  }
  /** Composer load: bytes no saved draft of this server references are deleted. */
  function pruneImages(scope: string) {
    const referenced = new Set(
      drafts.flatMap((saved) => saved.images.map((image) => `${saved.id}/${image.imageId}`)),
    );
    images.store.retainOnly(scope, referenced).catch(() => {
      // Unreferenced bytes stay until the next load; drafts are unaffected.
    });
  }
  function leaveComposition() {
    const leaving = find(currentId);
    if (server === undefined || !leaving || leaving.listed) return false;
    commit(server, leaving.id, (saved) => saved && { ...saved, listed: true });
    return true;
  }
  function save() {
    if (server === undefined) return;
    const prompt = { segments: current.segments, images: current.images };
    if (!retained(prompt)) {
      const removed = currentId;
      currentId = undefined;
      if (removed) removeDraft(server, removed);
      return;
    }
    const id = currentId ?? randomId();
    currentId = id;
    const { projectId, flowId } = current;
    commit(server, id, (saved) => ({
      ...(saved ?? {
        id,
        titleProvenance: "automatic",
        createdAt: new Date().toISOString(),
        listed: false,
      }),
      projectId,
      flowId,
      ...prompt,
    }));
  }
  /** Metadata first, then bytes: a reader never finds a reference without its bytes. */
  function removeDraft(scope: string, id: string) {
    commit(scope, id, () => undefined);
    images.store.remove(scope, id).catch(() => {
      // The next composer load deletes bytes no draft references.
    });
  }
  /**
   * A Flow fits a global Flow or one of the composition's Project; a Flow current choices don't
   * list yet is kept, since only current data confirms an owner.
   */
  function fits(flowId: string, projectId: string) {
    const owner = currentOwners?.get(flowId);
    return owner === undefined || owner === null || owner === projectId;
  }
  /** False while the draft awaits a Start outcome: its submitted content stays as sent. */
  function edit(change: Partial<Pick<Composition, Choice | "segments">>) {
    if (find(currentId)?.submission) return false;
    current = { ...current, ...change };
    // Clearing the Project clears the Flow too; another Project keeps only a Flow that fits it.
    if (
      change.projectId !== undefined &&
      (!current.projectId || !fits(current.flowId, current.projectId))
    )
      current = { ...current, flowId: "" };
    error = "";
    issues = [];
    imageRejections = [];
    if (change.projectId !== undefined || change.flowId !== undefined) {
      rememberChoice("project", current.projectId);
      rememberChoice("flow", current.flowId);
    }
    save();
    publish();
    // A stale tab's save keeps another tab's unresolved Start instead.
    return !find(currentId)?.submission;
  }
  /** Opens a saved draft, or a fresh composition with the remembered choices. */
  function openComposition(next: SavedRunDraft | undefined) {
    leaveComposition();
    show(next);
    if (!next)
      current = {
        projectId: remembered("project") || current.projectId,
        flowId: remembered("flow") || current.flowId,
        segments: [],
        images: [],
      };
    if (!find(currentId)?.submission && !fits(current.flowId, current.projectId))
      current = { ...current, flowId: "" };
    if (server !== undefined) store(server, latestDrafts(server));
    publish();
  }
  /**
   * Applies a launch-choice delivery. A current one clears a Project it no longer lists or that
   * is unavailable for a reason other than the connection, and a Flow it no longer lists or that
   * doesn't fit, silently and keeping the prompt. A connection outage keeps the last known
   * Project. A non-current delivery changes nothing. A draft awaiting a Start outcome keeps its
   * submitted choices.
   */
  function receiveChoices({
    value,
    synchronized,
  }: Pick<LiveScopeView<LaunchChoices>, "value" | "synchronized">) {
    currentOwners =
      value && synchronized
        ? new Map(value.flows.map((flow) => [flow.id, flow.projectId]))
        : undefined;
    if (!value || !currentOwners || find(currentId)?.submission) return;
    const listed = value.catalog.projects.find((project) => project.id === current.projectId);
    const projectId =
      listed?.availability === "available" || listed?.availability === "connection-unavailable"
        ? current.projectId
        : "";
    const flowId =
      currentOwners.has(current.flowId) && fits(current.flowId, projectId) ? current.flowId : "";
    if (projectId === current.projectId && flowId === current.flowId) return;
    current = { ...current, projectId, flowId };
    save();
    publish();
  }
  /** False when the title is blank or too long, or the draft awaits a Start outcome. */
  function rename(id: string, title: string) {
    const manualTitle = title.trim();
    const saved = find(id);
    if (server === undefined || !saved || saved.submission) return false;
    if (!manualTitle || manualTitle.length > TASK_TITLE_LIMIT) return false;
    commit(server, id, (latest = saved) => ({
      ...latest,
      manualTitle,
      titleProvenance: "manual",
    }));
    publish();
    return true;
  }
  /** A draft awaiting a Start outcome is kept so its exact request can still be checked. */
  function discard(id: string) {
    const saved = find(id);
    if (server === undefined || !saved || saved.submission) return;
    if (id === currentId) {
      currentId = undefined;
      current = { ...current, segments: [], images: [] };
      error = "";
      issues = [];
      imageRejections = [];
    }
    removeDraft(server, id);
    publish();
  }
  function rejectStart(id: string, failure: unknown, recoverable: boolean) {
    if (id !== currentId) return;
    if (failure instanceof LocalImageMissing) {
      error = failure.message;
      issues = [];
      remedy = "studio";
    } else if (confirmedRejection(failure)) {
      error = failure.message;
      issues = failure.detail.issues;
      remedy = failure.detail.issues.some((issue) => issue.code === "reporting_installation")
        ? "reporting"
        : "studio";
    } else if (failure instanceof ApiError && failure.detail.code === "missing_images")
      error = missingImagesOutcome;
    else error = recoverable ? unknownOutcome : unsavedUnknownOutcome;
  }
  async function start(confirmCompletedIssues = false) {
    const requestServer = server;
    const saved = find(currentId);
    if (requestServer === undefined || !saved || inFlight.has(saved.id)) return;
    // Start is admitted once, while the view is current; its uploads and request then follow.
    if (!transport.acceptsMutations()) return;
    const { id } = saved;
    const request =
      saved.submission ??
      Object.freeze({
        // Rejected requests are never recorded, so one key per draft can still be retried.
        requestId: id,
        ...(confirmCompletedIssues && { confirmCompletedIssues: true }),
        projectId: saved.projectId,
        flowId: saved.flowId,
        segments: saved.segments,
        images: saved.images,
        title: draftTitle(saved),
        titleProvenance: saved.titleProvenance,
        createdAt: saved.createdAt,
      });
    inFlight.add(id);
    const recoverable = commit(requestServer, id, (latest = saved) => ({
      ...latest,
      submission: request,
      // The unresolved Start is the sidebar's Idle row while this composer stays open.
      listed: true,
    }));
    error = "";
    issues = [];
    publish();
    let run;
    try {
      run = await submit(requestServer, request);
    } catch (failure) {
      inFlight.delete(id);
      if (failure instanceof LocalImageMissing || confirmedRejection(failure))
        commit(requestServer, id, (latest) => latest && withoutSubmission(latest));
      if (requestServer === server) {
        rejectStart(id, failure, recoverable);
        publish();
      }
      return;
    }
    inFlight.delete(id);
    const shown = requestServer === server && id === currentId;
    if (shown) currentId = undefined;
    removeDraft(requestServer, id);
    if (!shown) {
      publish();
      return;
    }
    // Only the transport result decides Start's outcome; preferences and navigation do not.
    rememberChoice("project", request.projectId);
    rememberChoice("flow", request.flowId);
    current = { ...current, segments: [], images: [] };
    publish();
    return run.id;
  }
  /**
   * Stages the request's images Factory lacks, then sends the same Start. Images Factory
   * reports missing at acceptance are uploaded again and the request retried once. An image
   * whose local bytes are gone is left to Factory's answer: an accepted request is still
   * recovered, and only a confirmed `missing_images` makes it a rejection.
   */
  async function submit(scope: string, request: StartRunInput) {
    await stage(scope, request, request.images, true);
    try {
      return await startRun(request);
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.detail.code === "missing_images")) throw failure;
      const missing = missingDigests(failure);
      const lacking = request.images.filter((image) => missing.has(image.sha256));
      await stage(scope, request, lacking, false);
      return startRun(request);
    }
  }
  async function stage(
    scope: string,
    request: StartRunInput,
    pending: readonly RunImage[],
    probe: boolean,
  ) {
    for (const image of pending) {
      if (probe && (await images.uploads.has(image))) continue;
      const data = await images.store.load(scope, request.requestId, image.imageId);
      if (!data && probe) continue;
      if (!data)
        throw new LocalImageMissing(
          `${image.name} is no longer saved in this browser. Remove it and attach it again.`,
        );
      await images.uploads.upload(image, data);
    }
  }
  /**
   * Attaches images to the open draft. Each file is checked on its own; a rejected file leaves
   * the others and the existing attachments. Identical bytes resolve to the image already
   * attached. `reference` receives the attached image of each accepted file, in order, and
   * returns the prompt with references to them, or nothing to leave the prompt as it is. It is
   * not called once the draft changed or awaits a Start outcome.
   */
  async function attachImages(files: readonly File[], reference?: PlaceReferences) {
    const scope = server;
    if (scope === undefined || find(currentId)?.submission) return;
    const id = currentId ?? randomId();
    currentId = id;
    const rejected: ImageRejection[] = [];
    const attached: string[] = [];
    for (const file of files) {
      const outcome = await attachImage(scope, id, file);
      if (outcome === undefined) return;
      if ("attached" in outcome) attached.push(outcome.attached);
      else rejected.push(outcome.rejected);
    }
    // References go only into the draft that is still open and editable (a stale tab's save
    // keeps another tab's unresolved Start), and only to images it still has: one may have been
    // removed while a later file was read.
    const open = scope === server && currentId === id && !find(id)?.submission;
    const placeable = attached.filter((imageId) =>
      current.images.some((image) => image.imageId === imageId),
    );
    const segments = open && placeable.length ? reference?.(placeable) : undefined;
    if (segments) {
      current = { ...current, segments };
      save();
    }
    imageRejections = rejected;
    publish();
  }
  /** The image already holding these bytes, or a rejection past the limit. */
  function admission(candidate: { name: string; sha256: string }): FileOutcome | undefined {
    const existing = current.images.find((image) => image.sha256 === candidate.sha256);
    if (existing) return { attached: existing.imageId };
    if (current.images.length >= RUN_IMAGE_LIMIT)
      return rejection(candidate.name, `A Run takes at most ${RUN_IMAGE_LIMIT} images.`);
    return undefined;
  }
  /** The file's outcome, or nothing if the draft changed meanwhile. */
  async function attachImage(
    scope: string,
    id: string,
    file: File,
  ): Promise<FileOutcome | undefined> {
    const candidate = await readImageFile(file);
    if (!candidate.ok) return rejection(candidate.name, candidate.reason);
    const early = admission(candidate);
    if (early) return early;
    const image: RunImage = {
      imageId: randomId(),
      sha256: candidate.sha256,
      name: candidate.name,
      mimeType: candidate.mimeType,
      sizeBytes: candidate.data.size,
    };
    try {
      await images.store.save(scope, id, image.imageId, candidate.data);
    } catch {
      return rejection(candidate.name, "Browser storage is full or unavailable.");
    }
    if (scope !== server || currentId !== id || find(id)?.submission) return undefined;
    // Another attach may have completed while these bytes were saved.
    const late = admission(candidate);
    if (late) {
      images.store.remove(scope, id, [image.imageId]).catch(() => {
        // The next composer load deletes bytes no draft references.
      });
      return late;
    }
    current = { ...current, images: [...current.images, image] };
    save();
    return { attached: image.imageId };
  }
  /** Removes an attached image with every reference to it. */
  function removeImage(imageId: string) {
    const scope = server;
    const id = currentId;
    if (scope === undefined || !id || find(id)?.submission) return;
    current = {
      ...current,
      segments: joinedSegments(
        current.segments.filter(
          (segment) => segment.type === "text" || segment.imageId !== imageId,
        ),
      ),
      images: current.images.filter((image) => image.imageId !== imageId),
    };
    imageRejections = [];
    save();
    // A stale tab's save keeps another tab's unresolved Start, which still needs these bytes.
    const kept = find(id)?.images.some((image) => image.imageId === imageId);
    if (currentId === id && !kept)
      images.store.remove(scope, id, [imageId]).catch(() => {
        // The next composer load deletes bytes no draft references.
      });
    publish();
  }
  /** The open draft's image bytes, for thumbnails and full-size preview. */
  function loadImage(imageId: string) {
    if (server === undefined || !currentId) return Promise.resolve(undefined);
    return images.store.load(server, currentId, imageId);
  }
  function syncFromStorage() {
    if (server === undefined) return;
    const saved = readSaved(server);
    if (!saved) return;
    drafts = withUnsaved(saved.drafts);
    const latest = find(currentId);
    if (latest) {
      current = composition(latest);
    } else if (currentId && !inFlight.has(currentId)) {
      currentId = undefined;
      current = { ...current, segments: [], images: [] };
    }
    publish();
  }
  if (typeof window !== "undefined")
    window.addEventListener("storage", (event) => {
      if (server !== undefined && event.key === draftsKey(server)) syncFromStorage();
    });
  return {
    getSnapshot: () => draft,
    /** Drafts shown in Run navigation, newest first. */
    getDrafts: () => listedDrafts,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    selectServer,
    edit,
    /** New Run: an empty prompt with remembered choices; the previous draft stays saved. */
    openFresh: () => openComposition(undefined),
    openDraft(id: string) {
      const saved = find(id);
      if (saved && saved.id !== currentId) openComposition(saved);
    },
    /** The user left the New Run view, so its draft joins Run navigation. */
    leave() {
      if (leaveComposition()) publish();
    },
    receiveChoices,
    rename,
    discard,
    start,
    attachImages,
    removeImage,
    loadImage,
  };
}

export const runDraft = createRunDraft();

export function useRunDraft() {
  return useSyncExternalStore(runDraft.subscribe, runDraft.getSnapshot);
}

export function useRunDrafts() {
  return useSyncExternalStore(runDraft.subscribe, runDraft.getDrafts);
}
