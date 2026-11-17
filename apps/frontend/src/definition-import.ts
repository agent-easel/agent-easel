import { useState, useSyncExternalStore } from "react";
import type { StudioSelection } from "./settings-navigation.ts";
import type { StudioDefinitions } from "./studio-definitions.ts";
import type {
  AgentCapabilities,
  AgentExecutionSettings,
  AgentModelOptionValue,
  CommitImportInput,
  ImportResult,
  ImportReview,
  ImportReviewAgent,
} from "@t3-factory/contracts";
import { hintedSelection } from "@t3-factory/domain-validation";
import { api, ApiError } from "./api.ts";
import { randomId } from "./lib/ids.ts";

/** The Factory calls an import makes; the HTTP client in the app, fakes in tests. */
export type DefinitionImportOperations = Pick<typeof api, "reviewImport" | "commitImport">;

/** A chosen file's name and text, kept until the import finishes or is cancelled. */
export interface ImportFile {
  readonly name: string;
  readonly text: string;
}

export interface ImportRow extends ImportReviewAgent {
  /** What Confirm saves for this Agent; null is Needs a model. */
  readonly selection: AgentExecutionSettings | null;
  /** The hint's options the selected model does not accept; empty without a selection. */
  readonly droppedOptions: ImportReviewAgent["droppedOptions"];
  /** Why the last commit refused this row's selection; empty otherwise. */
  readonly refusal: string;
}

export interface DefinitionImportSnapshot {
  /** The chosen file; an import is open while it is set, and a rejection keeps it for retry. */
  readonly file: ImportFile | null;
  readonly reviewing: boolean;
  readonly review: (Omit<ImportReview, "agents"> & { readonly rows: readonly ImportRow[] }) | null;
  readonly committing: boolean;
  readonly error: string;
  /** Field-addressed reasons of the last rejection. */
  readonly issues: readonly string[];
  /** The owning Project every imported definition gets, or null for Global, the default. */
  readonly target: string | null;
}

/** A model the review's picker offers: a reporting-capable provider's model in the connected environment. */
export interface ImportModelChoice {
  readonly providerInstanceId: string;
  readonly modelId: string;
  readonly label: string;
}

export function importModelChoices(capabilities: AgentCapabilities): ImportModelChoice[] {
  if (capabilities.state !== "ready" || capabilities.environments.length === 0) return [];
  return capabilities.providers
    .filter((provider) => provider.reporting.supported)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        providerInstanceId: provider.providerInstanceId,
        modelId: model.id,
        label: `${provider.displayName ?? provider.providerInstanceId} · ${model.label ?? model.id}`,
      })),
    );
}

/**
 * Opens what an import created, the imported Flow or the Agent of an Agent file, once Studio's
 * live lists hold it, so its editor never starts out as not found.
 */
export async function openImported(
  result: ImportResult,
  definitions: Pick<StudioDefinitions, "listed">,
  open: (selection: StudioSelection) => unknown,
) {
  if (result.flowId === null) {
    const agentId = result.agents[0]!.id;
    await definitions.listed("agents", agentId);
    return open({ tab: "agents", agentId });
  }
  await definitions.listed("flows", result.flowId);
  return open({ tab: "flows", flowId: result.flowId });
}

const idle: DefinitionImportSnapshot = {
  file: null,
  reviewing: false,
  review: null,
  committing: false,
  error: "",
  issues: [],
  target: null,
};

const UNCERTAIN =
  "Factory could not confirm whether the import finished. Confirm again: a retry returns the same result and never creates a copy.";

/** A whole-file issue that only repeats the headline adds nothing under it. */
const repeatsHeadline = (issue: { path: string; message: string }, headline: string) =>
  (issue.path === "" || issue.path === "document") && issue.message === headline;

/** The headline plus every issue that adds to it; a field-addressed issue always keeps its path. */
function rejection(cause: unknown, fallback: string) {
  if (cause instanceof ApiError)
    return {
      error: cause.message,
      issues: cause.detail.issues
        .filter((issue) => !repeatsHeadline(issue, cause.message))
        .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)),
    };
  return { error: cause instanceof Error ? cause.message : fallback, issues: [] };
}

/** The rows whose provider the last commit refused, keyed by the issue path `selections.<key>.…`. */
function refusedKeys(cause: unknown): ReadonlyMap<string, string> {
  if (!(cause instanceof ApiError)) return new Map();
  return new Map(
    cause.detail.issues
      .filter((issue) => issue.code === "harness_unsupported")
      .map((issue) => [issue.path.split(".")[1] ?? "", issue.message]),
  );
}

/**
 * One import: the chosen file, its review and the reviewed model choices. Review writes nothing;
 * Confirm is always available and commits every row as shown, so Agents may arrive without a model.
 * One request id covers every Confirm of this import, so an uncertain commit retries safely.
 */
export function createDefinitionImport(
  operations: DefinitionImportOperations = api,
  newRequestId: () => string = randomId,
) {
  let snapshot = idle;
  let requestId = "";
  const listeners = new Set<() => void>();
  function set(next: Partial<DefinitionImportSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((notify) => notify());
  }
  function editRow(key: string, change: (row: ImportRow) => Partial<ImportRow>) {
    const { review } = snapshot;
    if (!review || snapshot.committing) return;
    const rows = review.rows.map((row) =>
      row.key === key ? { ...row, ...change(row), refusal: "" } : row,
    );
    set({ review: { ...review, rows } });
  }
  async function review(file: ImportFile) {
    set({ ...idle, file, reviewing: true });
    try {
      const reviewed = await operations.reviewImport(
        new Blob([file.text], { type: "application/json" }),
      );
      if (snapshot.file !== file) return;
      const { agents, ...rest } = reviewed;
      const rows = agents.map((agent) => ({ ...agent, selection: agent.proposed, refusal: "" }));
      set({ reviewing: false, review: { ...rest, rows } });
    } catch (cause) {
      if (snapshot.file !== file) return;
      set({ reviewing: false, ...rejection(cause, "Factory could not read this file.") });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    /** A newly chosen file starts a new import with its own request id. */
    async choose(file: ImportFile) {
      requestId = newRequestId();
      await review(file);
    },
    /** Reviews the kept file again after a rejected review. */
    async retry() {
      if (snapshot.file && !snapshot.review && !snapshot.reviewing) await review(snapshot.file);
    },
    /**
     * Picks a catalog model, keeping the hint's options it accepts and listing the dropped rest,
     * or Needs a model with null.
     */
    select(key: string, choice: Pick<ImportModelChoice, "providerInstanceId" | "modelId"> | null) {
      const capabilities = snapshot.review?.capabilities;
      const environmentId = capabilities?.environments[0]?.environmentId;
      const model = capabilities?.providers
        .find((provider) => provider.providerInstanceId === choice?.providerInstanceId)
        ?.models.find((entry) => entry.id === choice?.modelId);
      editRow(key, ({ hint }) =>
        choice && environmentId && model
          ? hintedSelection(
              { environmentId, providerInstanceId: choice.providerInstanceId },
              model,
              hint?.modelOptions ?? [],
            )
          : { selection: null, droppedOptions: [] },
      );
    },
    setOption(key: string, id: string, value: AgentModelOptionValue["value"]) {
      editRow(key, ({ selection }) => ({
        selection: selection && {
          ...selection,
          modelOptions: selection.modelOptions.map((option) =>
            option.id === id ? { id, value } : option,
          ),
        },
      }));
    },
    /** Chooses the import target: a Project available for new Runs, or null for Global. */
    setTarget(target: string | null) {
      if (snapshot.review && !snapshot.committing) set({ target });
    },
    /** Commits every row as reviewed; the result on success, undefined when refused or uncertain. */
    async confirm(): Promise<ImportResult | undefined> {
      const { file, review: reviewed } = snapshot;
      if (!file || !reviewed || snapshot.committing) return undefined;
      set({ committing: true, error: "", issues: [] });
      try {
        const input: CommitImportInput = {
          requestId,
          document: JSON.parse(file.text) as CommitImportInput["document"],
          selections: Object.fromEntries(reviewed.rows.map((row) => [row.key, row.selection])),
          projectId: snapshot.target,
        };
        const result = await operations.commitImport(input);
        set(idle);
        return result;
      } catch (cause) {
        const refused = refusedKeys(cause);
        const rows = reviewed.rows.map((row) => ({ ...row, refusal: refused.get(row.key) ?? "" }));
        set({
          committing: false,
          review: { ...reviewed, rows },
          ...(cause instanceof ApiError ? rejection(cause, "") : { error: UNCERTAIN, issues: [] }),
        });
        return undefined;
      }
    },
    /** Closes the import; nothing was written. */
    cancel() {
      if (!snapshot.committing) set(idle);
    },
  };
}

export type DefinitionImportModel = ReturnType<typeof createDefinitionImport>;

export function useDefinitionImport() {
  const [model] = useState(() => createDefinitionImport());
  return { model, state: useSyncExternalStore(model.subscribe, model.getSnapshot) };
}
