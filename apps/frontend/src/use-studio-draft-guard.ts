import type { DraftGuardState } from "./draft-guard.ts";
import type { RefObject } from "react";
import { validateAppSearch, type StudioSelection } from "./settings-navigation.ts";
import { useNavigationBlock } from "./use-navigation-block.ts";

export type StudioDraft = DraftGuardState & { kind: "flow" | "agent" | "trigger"; id: string };

export type StudioDraftGuardInput = {
  flow?: StudioDraft | undefined;
  agent?: StudioDraft | undefined;
  trigger?: StudioDraft | undefined;
  flowRef?: RefObject<StudioDraft | undefined>;
  agentRef?: RefObject<StudioDraft | undefined>;
  triggerRef?: RefObject<StudioDraft | undefined>;
};

/** The draft a Trigger page edits: a saved Trigger's id, or `new:<kind>` for a create form. */
export function triggerDraftId(selection: StudioSelection | undefined) {
  if (selection?.tab !== "triggers") return undefined;
  return selection.kind ? `new:${selection.kind}` : selection.triggerId;
}

const studioPathIds = { flows: "flowId", agents: "agentId", triggers: "triggerId" } as const;

/** The Studio destination a masked `/studio/...` path names. */
function studioSelectionFromPath(pathname: string): StudioSelection | undefined {
  if (pathname === "/studio/triggers/new/github-issues")
    return { tab: "triggers", triggerId: "new", kind: "github_issues" };
  const [, root, tab, id, ...rest] = pathname.split("/");
  if (root !== "studio" || !tab || !(tab in studioPathIds) || rest.length) return undefined;
  const key = studioPathIds[tab as keyof typeof studioPathIds];
  return validateAppSearch({ studio: { tab, ...(id ? { [key]: id } : {}) } }).studio;
}

function studioSelectionFromLocation(location: {
  pathname: string;
  search: unknown;
}): StudioSelection | undefined {
  const search =
    typeof location.search === "object" && location.search
      ? (location.search as Record<string, unknown>)
      : {};
  return validateAppSearch(search).studio ?? studioSelectionFromPath(location.pathname);
}

function staysWithDraft(studio: StudioSelection | undefined, draft: StudioDraft) {
  if (!studio) return false;
  // An Agent opened from the Flow editor opens over it, so the Flow's draft stays.
  if (draft.kind === "flow")
    return (
      (studio.tab === "flows" && studio.flowId === draft.id) ||
      (studio.tab === "agents" && studio.fromFlow === draft.id)
    );
  if (draft.kind === "trigger") return triggerDraftId(studio) === draft.id;
  return studio.tab === "agents" && studio.agentId === draft.id;
}

function liveDrafts(input: StudioDraftGuardInput): StudioDraft[] {
  const flow = input.flowRef ? input.flowRef.current : input.flow;
  const agent = input.agentRef ? input.agentRef.current : input.agent;
  const trigger = input.triggerRef ? input.triggerRef.current : input.trigger;
  return [flow, agent, trigger].filter(
    (draft): draft is StudioDraft => !!draft && (draft.dirty || draft.removed),
  );
}

/** Only the shown page's editor has a draft, so a navigation leaves at most one. */
export function useStudioDraftGuard(input: StudioDraftGuardInput) {
  const guarded = liveDrafts(input).length > 0;
  return useNavigationBlock(guarded, (location) => {
    const studio = studioSelectionFromLocation(location);
    return liveDrafts(input).find((draft) => !staysWithDraft(studio, draft));
  });
}
