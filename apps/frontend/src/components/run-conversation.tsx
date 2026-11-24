import type { RunDetail } from "@agent-easel/contracts";
import { CircleHelp, MessageCircle } from "lucide-react";
import { ProblemCard } from "./problem-card.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";

/** Public launch problems can contain protocol details; explain the actionable limit instead. */
function launchProblem(problem: string) {
  if (/authorization context/i.test(problem))
    return "The connection that accepted this Run is unavailable or has changed.";
  if (/payload|target/i.test(problem))
    return "Factory could not verify the saved conversation launch details.";
  return "Factory could not confirm the Run conversation launch.";
}

export function RunConversationNotice({
  coordinator,
}: {
  coordinator: RunDetail["runCoordinator"];
}) {
  if (!coordinator) return null;
  const { state, problem } = coordinator;
  if (state === "acknowledged" && !problem) return null;
  if (state === "acknowledged")
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Run coordination needs attention"
        className="w-140 max-w-full"
      >
        Factory could not confirm some work in this Run. Check the block details and Run history.
      </ProblemCard>
    );
  if (state === "cancelled")
    return (
      <ProblemCard
        density="compact"
        tone="neutral"
        icon={MessageCircle}
        title="Run conversation launch cancelled"
        className="w-140 max-w-full"
      >
        This launch was cancelled. The Run’s recorded status determines whether all work has
        stopped.
      </ProblemCard>
    );
  if (state === "uncertain")
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Run conversation launch uncertain"
        className="w-140 max-w-full"
      >
        {launchProblem(problem ?? "")} It may already exist in T3. Check this Run’s history before
        starting another Run.
      </ProblemCard>
    );
  if (problem)
    return (
      <ProblemCard
        density="compact"
        tone="attention"
        title="Run conversation unavailable"
        className="w-140 max-w-full"
      >
        {launchProblem(problem)} The conversation link is not available. Check the T3 connection and
        this Run’s history.
      </ProblemCard>
    );
  return (
    <ProblemCard
      density="compact"
      tone="info"
      icon={CircleHelp}
      title="Opening Run conversation"
      className="w-140 max-w-full"
    >
      The Run has been accepted. Its conversation link will appear once T3 confirms the launch.
    </ProblemCard>
  );
}

/** A Run-owned conversation stays primary even while its launch has no confirmed link. */
function preferredLink(run: RunDetail) {
  if (run.runCoordinator) return run.runCoordinator.link;
  const [first] = run.definitions.flow.graph.flowInput.targetBlockIds;
  return (
    run.blocks.find((block) => block.blockId === first)?.link ??
    run.blocks.find((block) => block.link)?.link ??
    null
  );
}

export function RunConversationAction({ run }: { run: RunDetail }) {
  const link = preferredLink(run);
  return link ? <OpenInT3 href={link} className="text-sm" /> : null;
}
