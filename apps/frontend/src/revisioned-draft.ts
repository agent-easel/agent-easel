import type { ValidationIssue } from "@t3-factory/contracts";
import { ApiError } from "./api.ts";
import type { StudioRead } from "./studio-definitions.ts";
import { OfflineError } from "./transport.ts";

/** A saved definition with revisions and an owning Project, such as an Agent or a Flow. */
interface Revisioned {
  readonly id: string;
  readonly revision: number;
  readonly projectId: string | null;
}

/** JSON with sorted object keys, so equal content compares equal whatever its key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const sameContent = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * How the last save ended. `not-sent`: the window refused to send it while offline or
 * synchronizing. `unknown`: the connection failed after sending, so Factory may or may not have
 * accepted it.
 */
export type SaveOutcome = "pending" | "succeeded" | "rejected" | "not-sent" | "unknown";

/**
 * Factory holds a newer revision than the unsaved draft's baseline: saved elsewhere or found by
 * a refused save. `detected` names the newest revision Studio holds (null until it arrives);
 * `comparing` waits for it after the comparison was asked for; `compared` shows it.
 */
export type RevisionConflict<D> =
  | { readonly status: "none" }
  | { readonly status: "detected"; readonly revision: number | null }
  | { readonly status: "comparing" }
  | { readonly status: "compared"; readonly latest: D };

/**
 * Another client changed the definition's owning Project, which appends no revision, while the
 * draft had unsaved changes. `waiting`: a save was refused for it before Studio delivered the new
 * owner; `changed`: Studio shows the owner `to`, which the draft must acknowledge before saving.
 */
export type OwnerChange =
  | { readonly status: "none" }
  | { readonly status: "waiting" }
  | { readonly status: "changed"; readonly from: string | null; readonly to: string | null };

/** What every revisioned draft shows; each editor adds its own fields. */
export interface RevisionedDraftState<D, C> {
  /** The saved revision the draft is based on and the next save expects; null before a Create. */
  readonly saved: D | null;
  readonly content: C;
  /** The content differs from the saved revision's, whatever its key order. */
  readonly dirty: boolean;
  /** A save is pending; notices of newer revisions wait for its reply. */
  readonly saving: boolean;
  /** How the last save ended; null before the first save. */
  readonly saveOutcome: SaveOutcome | null;
  readonly error: string;
  /** Factory's validation issues behind `error`. */
  readonly issues: readonly ValidationIssue[];
  readonly conflict: RevisionConflict<D>;
  /**
   * The owning Project Studio shows now, or null for a global definition. Whenever saving is
   * allowed it is also the owner the draft acknowledged, so saves expect it.
   */
  readonly owner: string | null;
  readonly ownerChange: OwnerChange;
  /** A clean draft switched to this revision saved elsewhere, until the next change. */
  readonly updatedTo: number | null;
  /** Studio no longer holds the definition a synchronized read showed; the draft is kept. */
  readonly removed: boolean;
  readonly removing: boolean;
  readonly removalError: string;
  /** Nothing in the shared protocol blocks a save; an editor may add its own conditions. */
  readonly canSave: boolean;
}

/** One save to send: the content as submitted, compared with later revisions, and the call. */
export interface SaveRequest<D, C> {
  readonly submitted: C;
  readonly send: () => Promise<D>;
  /** Shown when the connection failed after sending. */
  readonly unknownMessage: string;
  /** Shown when a refusal carries no message. */
  readonly fallback: string;
}

const noConflict = { status: "none" } as const;
const noOwnerChange = { status: "none" } as const;

/** A refusal because the definition's owning Project is no longer the one the save expected. */
const isStaleOwner = (cause: ApiError) =>
  cause.detail.code === "conflict" &&
  cause.detail.issues.some((issue) => issue.code === "stale_owner");

function outcomeOf(cause: unknown): SaveOutcome {
  if (!(cause instanceof OfflineError)) return "rejected";
  return cause.delivery === "unknown" ? "unknown" : "not-sent";
}

/**
 * The revision protocol shared by Studio's revisioned definitions. A draft follows its
 * definition through Studio's saved list, reading only synchronized lists: a clean draft adopts
 * a newer revision, a dirty one keeps its edits and names the newer revision until it is
 * compared and loaded or kept; notices wait while a save is pending; the draft's own saves are
 * recognised as its own, also after a lost reply; a removal is noted only after a synchronized
 * read showed the definition. A draft without a saved revision follows nothing until its own
 * Create or a `load`. Each editor supplies its content projection, its save and removal calls
 * and its extras, publishes its own snapshot through `view` and calls `reconcile` from its
 * Studio subscription.
 */
export function createRevisionedDraft<D extends Revisioned, C extends object, S>(config: {
  readonly saved: D | null;
  readonly content: C;
  readonly contentOf: (definition: D) => C;
  /** This definition's kind in Studio's saved definitions. */
  readonly list: () => StudioRead<readonly D[]>;
  readonly view: (state: RevisionedDraftState<D, C>) => S;
  /** While true, a clean draft waits to adopt a newer revision; `reconcile` adopts it later. */
  readonly hold?: () => boolean;
  /** Runs whenever a saved revision replaces the draft. */
  readonly onAdopt?: () => void;
  /** Runs whenever the owning Project the draft shows changes, including by its own Change owner. */
  readonly onOwnerChange?: () => void;
}) {
  const { contentOf, list, view, hold, onAdopt, onOwnerChange } = config;
  let saved = config.saved;
  let content = config.content;
  let baseline = content;
  let lastSave: { readonly outcome: SaveOutcome; readonly content: C } | null = null;
  let error = "";
  let issues: readonly ValidationIssue[] = [];
  let conflict: RevisionConflict<D> = noConflict;
  /** The newer revision a dirty draft names, once Studio holds it. */
  let newest: D | null = null;
  let updatedTo: number | null = null;
  /** The owning Project Studio shows now, and the one the user last accepted for saving. */
  let owner = config.saved?.projectId ?? null;
  let acknowledgedOwner = owner;
  let ownerChange: OwnerChange = noOwnerChange;
  /** A synchronized read held the definition, so its later absence is a removal. */
  let seen = false;
  let removed = false;
  let removing = false;
  /** This draft's own removal was accepted; nothing is followed afterwards. */
  let removedHere = false;
  let removalError = "";
  let dirty = { content, baseline, value: false };
  const listeners = new Set<() => void>();

  /** Recomputed only when the content or baseline changed, not on every publish. */
  function isDirty() {
    if (dirty.content !== content || dirty.baseline !== baseline)
      dirty = { content, baseline, value: !sameContent(content, baseline) };
    return dirty.value;
  }
  function state(): RevisionedDraftState<D, C> {
    const saving = lastSave?.outcome === "pending";
    return {
      saved,
      content,
      dirty: isDirty(),
      saving,
      saveOutcome: lastSave?.outcome ?? null,
      error,
      issues,
      conflict,
      owner,
      ownerChange,
      updatedTo,
      removed,
      removing,
      removalError,
      canSave:
        !removed &&
        !saving &&
        !removing &&
        conflict.status === "none" &&
        ownerChange.status === "none",
    };
  }
  let snapshot = view(state());
  function publish() {
    snapshot = view(state());
    listeners.forEach((notify) => notify());
  }
  function showError(message: string, found: readonly ValidationIssue[] = []) {
    error = message;
    issues = found;
  }
  function closeConflict() {
    conflict = noConflict;
    newest = null;
  }
  function showOwner(projectId: string | null) {
    if (projectId === owner) return;
    owner = projectId;
    onOwnerChange?.();
  }
  /** The draft accepts `projectId` as its owning Project, so its saves expect it. */
  function acceptOwner(projectId: string | null) {
    showOwner(projectId);
    acknowledgedOwner = projectId;
    ownerChange = noOwnerChange;
  }
  /** The saved revision replaces the draft, which is clean and shows no conflict or error. */
  function adopt(next: D) {
    saved = next;
    acceptOwner(next.projectId);
    content = contentOf(next);
    baseline = content;
    closeConflict();
    showError("");
    onAdopt?.();
  }
  /** Shows why Factory refused a save; a stale save also enters the revision conflict. */
  function refused(cause: unknown, fallback: string) {
    if (!(cause instanceof ApiError))
      return showError(cause instanceof Error ? cause.message : fallback);
    showError(cause.message, cause.detail.issues);
    // Reconciling afterwards names the new owner, or the newer revision, once Studio holds it.
    if (isStaleOwner(cause)) ownerChange = { status: "waiting" };
    else if (cause.detail.code === "conflict") conflict = { status: "detected", revision: null };
  }
  /** A removal is shown at once, even while a save is pending, and beats its late success. */
  function noteAbsence() {
    if (!seen) return false;
    removed = true;
    closeConflict();
    ownerChange = noOwnerChange;
    updatedTo = null;
    showError("");
    removalError = "";
    return true;
  }
  /** A save whose reply was lost reached Factory after all if `latest` holds its content. */
  function recognisesLostSave(latest: D) {
    if (lastSave?.outcome !== "unknown" || !sameContent(contentOf(latest), lastSave.content))
      return false;
    if (sameContent(content, lastSave.content)) adopt(latest);
    else {
      saved = latest;
      baseline = contentOf(latest);
    }
    lastSave = { ...lastSave, outcome: "succeeded" };
    showError("");
    return true;
  }
  /** A newer revision replaces a clean draft and is named beside a dirty one. */
  function follow(latest: D): boolean {
    if (!isDirty()) {
      if (hold?.()) return false;
      adopt(latest);
      updatedTo = latest.revision;
      return true;
    }
    if (latest === newest) return false;
    newest = latest;
    conflict =
      conflict.status === "comparing" || conflict.status === "compared"
        ? { status: "compared", latest }
        : { status: "detected", revision: latest.revision };
    return true;
  }
  /**
   * Follows the owning Project Studio shows: a clean draft accepts it, while a dirty one keeps its
   * edits and must acknowledge it before saving. A stale-owner refusal keeps waiting while Studio
   * still shows the owner the draft expected.
   */
  function followOwner(latest: D): boolean {
    const shown = owner;
    showOwner(latest.projectId);
    if (owner === acknowledgedOwner) {
      if (ownerChange.status !== "changed") return owner !== shown;
      ownerChange = noOwnerChange;
      return true;
    }
    if (!isDirty()) {
      acceptOwner(owner);
      return true;
    }
    if (ownerChange.status === "changed" && ownerChange.to === owner) return false;
    ownerChange = { status: "changed", from: acknowledgedOwner, to: owner };
    return true;
  }
  /** Applies Studio's saved list to the draft; returns whether anything shown changed. */
  function apply(): boolean {
    if (!saved || removed || removing || removedHere) return false;
    const read = list();
    let changed = false;
    if (conflict.status === "comparing" && read.error) {
      conflict = { status: "detected", revision: null };
      showError("Could not load the latest revision. Try again.");
      changed = true;
    }
    if (!read.synchronized || !read.value) return changed;
    const id = saved.id;
    const latest = read.value.find((entry) => entry.id === id);
    if (!latest) return noteAbsence() || changed;
    return applyLatest(saved, latest) || changed;
  }
  /** Follows `latest`, the definition as a synchronized list shows it; returns whether it showed. */
  function applyLatest(current: D, latest: D): boolean {
    seen = true;
    // A pending save defers notices; an older revision is a delivery behind its accepted reply.
    if (lastSave?.outcome === "pending" || latest.revision < current.revision) return false;
    if (latest.revision === current.revision) {
      // Studio's unchanged definition can still name the owner a stale-owner refusal waits for:
      // live updates coalesce, so a move away and back after this editor's own Change owner may
      // never be delivered.
      if (latest === current) return ownerChange.status === "waiting" && followOwner(latest);
      saved = latest;
      followOwner(latest);
      return true;
    }
    const followed = recognisesLostSave(latest) || follow(latest);
    // A clean draft adopting `latest` has already accepted its owner.
    return followOwner(latest) || followed;
  }
  /** Applies `change` only while `revision` is still the one compared, then shows it. */
  function onCompared(revision: number, change: (latest: D) => void) {
    if (conflict.status !== "compared" || conflict.latest.revision !== revision) return;
    change(conflict.latest);
    publish();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    /** Shows a change to the editor's own state. */
    publish,
    /** Brings the draft up to Studio's saved list, which the editor follows. */
    reconcile() {
      if (apply()) publish();
    },
    /** Changes the content; each editor decides when editing is allowed. */
    edit(change: Partial<C>) {
      content = { ...content, ...change };
      updatedTo = null;
      publish();
    },
    /** Replaces the draft with saved `definition`, such as the one an editor opened. */
    load(definition: D) {
      adopt(definition);
      publish();
    },
    /**
     * Shows a problem the editor found itself, such as invalid content or a failed check, in place
     * of the last error; an empty message clears it.
     */
    report(message: string, found: readonly ValidationIssue[] = []) {
      showError(message, found);
      publish();
    },
    /**
     * Sends the draft. Notices wait for the reply; a stale save enters the same conflict as a
     * revision saved elsewhere, and a removal noted meanwhile beats the reply.
     */
    async save(request: SaveRequest<D, C>): Promise<D | undefined> {
      if (!state().canSave) return undefined;
      const sent = { outcome: "pending" as const, content: request.submitted };
      lastSave = sent;
      showError("");
      updatedTo = null;
      publish();
      try {
        const result = await request.send();
        lastSave = { ...sent, outcome: "succeeded" };
        if (removed) return undefined;
        adopt(result);
        return result;
      } catch (cause) {
        const outcome = outcomeOf(cause);
        lastSave = { ...sent, outcome };
        if (removed) return undefined;
        if (outcome === "unknown") showError(request.unknownMessage);
        else refused(cause, request.fallback);
        return undefined;
      } finally {
        apply();
        publish();
      }
    },
    /**
     * Accepts owning Project `projectId`, changed elsewhere, while it is still the change shown:
     * the edits stay and the next save expects it.
     */
    acknowledgeOwner(projectId: string | null) {
      if (ownerChange.status !== "changed" || ownerChange.to !== projectId) return;
      acceptOwner(projectId);
      showError("");
      publish();
    },
    /**
     * This editor's own Change owner moved the definition to `projectId`; nothing to acknowledge.
     * Studio's later deliveries are followed as usual: they cannot be told apart from a move
     * elsewhere, and a delivery read before the move is followed by the move itself.
     */
    ownerChangedHere(projectId: string | null) {
      if (!saved || projectId === owner) return;
      acceptOwner(projectId);
      publish();
    },
    /** The user checked an unknown save's outcome themselves, so the draft may send again. */
    acknowledgeUnknownSave() {
      if (lastSave?.outcome !== "unknown") return;
      lastSave = null;
      showError("");
      publish();
    },
    /** Removes the saved definition; an accepted removal leaves no unsaved changes. */
    async remove(send: (id: string) => Promise<unknown>, fallback: string) {
      if (!saved || removed || removing || lastSave?.outcome === "pending") return false;
      removing = true;
      removalError = "";
      publish();
      try {
        await send(saved.id);
        removedHere = true;
        baseline = content;
        return true;
      } catch (cause) {
        removalError = cause instanceof Error ? cause.message : fallback;
        return false;
      } finally {
        removing = false;
        apply();
        publish();
      }
    },
    clearRemovalError() {
      removalError = "";
      publish();
    },
    /** The transient "Updated to revision N" notice has been shown long enough. */
    dismissUpdate() {
      if (updatedTo === null) return;
      updatedTo = null;
      publish();
    },
    /** Shows the newest revision beside the draft; until Studio holds it, it is shown on arrival. */
    compare() {
      if (conflict.status !== "detected") return;
      showError("");
      conflict = newest ? { status: "compared", latest: newest } : { status: "comparing" };
      apply();
      publish();
    },
    /** Replaces the draft with compared `revision` while it is still the one compared. */
    takeLatest(revision: number) {
      onCompared(revision, adopt);
    },
    /** Keeps the content, unsaved and sending nothing, against compared `revision`. */
    keep(revision: number) {
      onCompared(revision, (latest) => {
        saved = latest;
        baseline = contentOf(latest);
        closeConflict();
        showError("");
      });
    },
  };
}
