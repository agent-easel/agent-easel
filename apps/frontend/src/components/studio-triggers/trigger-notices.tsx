import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { TriggerDefinition, ValidationIssue } from "@agent-easel/contracts";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { api } from "../../api.ts";
import {
  matchingTriggerName,
  type TriggerDraftModel,
  type TriggerDraftSnapshot,
} from "../../trigger-draft.ts";
import { StudioLink } from "../app-link.tsx";
import { ProblemCard } from "../problem-card.tsx";
import { TechnicalDetails } from "../technical-details.tsx";
import type { TriggerActions } from "./trigger-actions.ts";
import { triggerProblemIds } from "./trigger-form.tsx";
import { scheduleText } from "./trigger-text.ts";

/** Give repair guidance without exposing the host's search paths in the summary. */
function splitGuidance(message: string) {
  const paths = "Factory looks for it on its PATH, then in /opt/homebrew/bin and /usr/local/bin;";
  if (message.includes(paths)) {
    return {
      message: message.replace(paths, "Then"),
      details: paths.slice(0, -1) + ".",
    };
  }
  const privatePath = /(?:^|[\s("'"=])(?:~\/|\/(?:[^\s/]+\/)+)[^\s]+/;
  return privatePath.test(message)
    ? {
        message:
          "Check that the Project folder and its GitHub remote are accessible on the Factory host.",
        details: message,
      }
    : { message, details: undefined };
}

function queryCode(message: string) {
  return message
    .split(/(-?\b[a-z][\w-]*:(?:[\w:-]*[\w-])?)/gi)
    .map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part));
}

export function TriggerGuidance({ message }: { message: string }) {
  const guidance = splitGuidance(message);
  return (
    <>
      <p>{guidance.message}</p>
      {guidance.details && <TechnicalDetails details={guidance.details} />}
    </>
  );
}

export function SharedRepositoryCard({
  repository,
  warnings,
}: {
  repository: string;
  warnings: readonly ValidationIssue[];
}) {
  const warning = warnings.find((entry) => entry.code === "trigger_repository_shared");
  return warning ? (
    <ProblemCard tone="attention" title={`Another Trigger watches ${repository}`}>
      {warning.message}
    </ProblemCard>
  ) : null;
}

export function TriggerFieldNotices({
  state,
  repositoryProblem,
  flowProblem,
  publicQueryWarning,
  ghProblem,
  retry,
}: {
  state: TriggerDraftSnapshot;
  repositoryProblem: string | undefined;
  flowProblem: string | undefined;
  publicQueryWarning: boolean;
  ghProblem: string | undefined;
  retry: () => void;
}) {
  const { query, content, saved } = state;
  const repository = repositoryProblem && splitGuidance(repositoryProblem);
  const gh = ghProblem && splitGuidance(ghProblem);
  return (
    <>
      {state.nameTaken && (
        <ProblemCard id={triggerProblemIds.name} tone="error" title="This name is already used">
          Another Trigger has this name. Choose a different name.
        </ProblemCard>
      )}
      {"error" in query && (
        <ProblemCard
          id={triggerProblemIds.query}
          tone="error"
          title={
            query.code === "trigger_query_label_missing"
              ? "The query needs a ready label"
              : "Check the GitHub issue query"
          }
        >
          {queryCode(query.error)}
        </ProblemCard>
      )}
      {publicQueryWarning && (
        <ProblemCard
          id={triggerProblemIds.query}
          tone="attention"
          title="No author filter on a public repository"
        >
          Issues anyone opens can start a Run once they carry the ready label.
        </ProblemCard>
      )}
      {repository && (
        <ProblemCard
          id={triggerProblemIds.repository}
          tone="error"
          title="The repository can’t be read"
          details={repository.details}
        >
          {repository.message}
        </ProblemCard>
      )}
      {flowProblem && (
        <ProblemCard
          id={triggerProblemIds.flow}
          tone="error"
          title="The selected Flow isn’t ready"
          action={
            <TextLink asChild trailingIcon={ChevronRight}>
              <StudioLink
                selection={{
                  tab: "flows",
                  flowId: content.flowId,
                  fromTrigger: saved?.id ?? "new",
                }}
              >
                Open Flow
              </StudioLink>
            </TextLink>
          }
        >
          {flowProblem}
        </ProblemCard>
      )}
      {state.intervalError && (
        <ProblemCard
          id={triggerProblemIds.interval}
          tone="error"
          title="Check interval out of range"
        >
          {state.intervalError}
        </ProblemCard>
      )}
      {state.limitError && (
        <ProblemCard id={triggerProblemIds.limit} tone="error" title="Max active Runs out of range">
          {state.limitError}
        </ProblemCard>
      )}
      {gh && (
        <ProblemCard
          tone="error"
          title={
            ghProblem.includes("gh auth login")
              ? "gh isn’t signed in on the Factory host"
              : "GitHub readiness needs attention"
          }
          details={gh.details}
          action={<TextLink onClick={retry}>Check again</TextLink>}
        >
          {gh.message}
        </ProblemCard>
      )}
    </>
  );
}

export function EditorNotices({
  draft,
  state,
  failure,
  recovered,
}: {
  draft: TriggerDraftModel;
  state: TriggerDraftSnapshot;
  failure: TriggerActions["state"]["failure"];
  recovered: (trigger: TriggerDefinition) => void;
}) {
  const { conflict } = state;
  return (
    <>
      {state.removed && (
        <ProblemCard tone="attention" title="This Trigger was removed elsewhere">
          Your edits are kept here. They can no longer be saved.
        </ProblemCard>
      )}
      {state.updatedTo !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          Updated to revision {state.updatedTo}
        </p>
      )}
      {conflict.status === "detected" && (
        <ProblemCard
          tone="attention"
          title={
            conflict.revision === null
              ? "A newer revision was saved elsewhere"
              : `Revision ${conflict.revision} was saved elsewhere`
          }
          action={<TextLink onClick={draft.compare}>Compare latest revision</TextLink>}
        />
      )}
      {conflict.status === "comparing" && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the latest revision…
        </p>
      )}
      {conflict.status === "compared" && (
        <ProblemCard
          tone="attention"
          title={`Revision ${conflict.latest.revision} was saved elsewhere`}
          action={
            <span className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => draft.loadLatest(conflict.latest.revision)}
              >
                Load revision {conflict.latest.revision}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => draft.keepEdits(conflict.latest.revision)}
              >
                Keep my edits
              </Button>
            </span>
          }
        >
          “{conflict.latest.name}” checks <code>{conflict.latest.github.query}</code>{" "}
          {scheduleText(conflict.latest.schedule)} with up to {conflict.latest.maxActiveRuns} active
          Runs.
        </ProblemCard>
      )}
      {!state.saved && state.saveOutcome === "unknown" ? (
        <UnknownCreateNotice
          name={state.content.name}
          onOpen={recovered}
          onRetry={draft.allowCreateAgain}
        />
      ) : (
        state.error &&
        !state.nameTaken &&
        conflict.status === "none" && <SaveFailure creating={!state.saved} message={state.error} />
      )}
      {failure && <SaveFailure title={failure.name} message={failure.message} />}
    </>
  );
}

function SaveFailure({
  creating,
  title,
  message,
}: {
  creating?: boolean;
  title?: string;
  message: string;
}) {
  const guidance = splitGuidance(message);
  return (
    <ProblemCard
      tone="error"
      title={title ?? (creating ? "Couldn’t create this Trigger" : "Couldn’t save this Trigger")}
      details={guidance.details}
    >
      {guidance.message} {creating && "Your settings are still here."}
    </ProblemCard>
  );
}

function UnknownCreateNotice({
  name,
  onOpen,
  onRetry,
}: {
  name: string;
  onOpen: (trigger: TriggerDefinition) => void;
  onRetry: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [lookedUp, setLookedUp] = useState<
    { found: TriggerDefinition | undefined } | "failed" | null
  >(null);
  useEffect(() => {
    let current = true;
    void api.listTriggers().then(
      (triggers) => {
        if (current) setLookedUp({ found: matchingTriggerName(triggers, name) });
      },
      () => {
        if (current) setLookedUp("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [name, attempt]);
  const result = recoveryMessage(lookedUp, onOpen, onRetry, () => {
    setLookedUp(null);
    setAttempt((previous) => previous + 1);
  });
  return (
    <ProblemCard
      tone="attention"
      title="Factory may have created this Trigger"
      action={result.action}
    >
      {result.message}
    </ProblemCard>
  );
}

function recoveryMessage(
  lookedUp: { found: TriggerDefinition | undefined } | "failed" | null,
  onOpen: (trigger: TriggerDefinition) => void,
  onRetry: () => void,
  retryLookup: () => void,
) {
  if (lookedUp === null) return { message: "Checking the Trigger list…" };
  if (lookedUp === "failed")
    return {
      message: "Factory couldn’t read the Trigger list. Your settings are still here.",
      action: <TextLink onClick={retryLookup}>Check again</TextLink>,
    };
  const { found } = lookedUp;
  if (found)
    return {
      message: `A Trigger named “${found.name}” is already saved.`,
      action: (
        <TextLink trailingIcon={ChevronRight} onClick={() => onOpen(found)}>
          Open Trigger
        </TextLink>
      ),
    };
  return {
    message: "No Trigger with this name was found. Your settings are still here.",
    action: <TextLink onClick={onRetry}>Create again</TextLink>,
  };
}
