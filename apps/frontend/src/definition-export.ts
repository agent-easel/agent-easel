import { useState, useSyncExternalStore } from "react";
import type { DefinitionExport } from "@t3-factory/contracts";
import { portableDocumentText } from "@t3-factory/domain-validation";
import { ApiError } from "./api.ts";

/** Saves a file through the browser's download; the desktop app shows its own save dialog. */
function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The click starts the download synchronously; releasing the URL afterwards keeps the file.
  setTimeout(() => URL.revokeObjectURL(url));
}

/** A file name from the Flow's or Agent's name, e.g. `code-reviewer.agent.json`. */
function exportFileName({ document }: DefinitionExport): string {
  const name = document.kind === "flow" ? document.flow.name : document.agents[0].name;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || document.kind}.${document.kind}.json`;
}

export interface DefinitionExportSnapshot {
  /** The editor has unsaved changes, so Export asks before exporting the saved revision. */
  readonly confirming: boolean;
  readonly exporting: boolean;
  /** After an export: Agents whose model hint lacks a driver kind. */
  readonly driverKindOmitted: readonly string[];
  readonly error: string;
}

/** A refusal names its reasons, such as the definition over the import limits. */
function exportError(cause: unknown): string {
  if (cause instanceof ApiError)
    return [cause.message, ...cause.detail.issues.map((issue) => issue.message)].join(" ");
  return cause instanceof Error ? cause.message : "Factory could not export this definition.";
}

const idle: DefinitionExportSnapshot = {
  confirming: false,
  exporting: false,
  driverKindOmitted: [],
  error: "",
};

/**
 * Export of one editor's saved definition. Export always reads the saved revision on the server,
 * so a dirty editor confirms first; nothing here reads or changes the editor's draft.
 */
export function createDefinitionExport(
  read: () => Promise<DefinitionExport>,
  save: (name: string, text: string) => void = downloadFile,
) {
  let snapshot = idle;
  const listeners = new Set<() => void>();
  function set(next: DefinitionExportSnapshot) {
    snapshot = next;
    listeners.forEach((notify) => notify());
  }
  async function run() {
    set({ ...idle, exporting: true });
    try {
      const exported = await read();
      save(exportFileName(exported), portableDocumentText(exported.document));
      set({ ...idle, driverKindOmitted: exported.driverKindOmitted.map((agent) => agent.name) });
    } catch (cause) {
      set({ ...idle, error: exportError(cause) });
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
    /** Export pressed: a clean editor exports at once, a dirty one asks first. */
    async request(dirty: boolean) {
      if (snapshot.exporting) return;
      if (dirty) set({ ...idle, confirming: true });
      else await run();
    },
    /** **Export saved revision**. */
    async confirm() {
      if (snapshot.confirming) await run();
    },
    /** **Keep editing**. */
    keepEditing() {
      if (snapshot.confirming) set(idle);
    },
  };
}

export type DefinitionExportModel = ReturnType<typeof createDefinitionExport>;

/** One export model per opened editor. */
export function useDefinitionExport(read: () => Promise<DefinitionExport>) {
  const [model] = useState(() => createDefinitionExport(read));
  return { model, state: useSyncExternalStore(model.subscribe, model.getSnapshot) };
}
