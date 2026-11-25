import type { ComponentProps } from "react";
import type { ReportingInstallation } from "@agent-easel/contracts";
import { providerName } from "../reporting-state.tsx";
import { ProblemCard } from "./problem-card.tsx";

function reportingSetupGuidance(
  target: ReportingInstallation,
  missing: boolean,
  profileProblem: boolean,
) {
  if (profileProblem) return target.message;
  if (missing) return "Restore it on the AgentEasel host, then check again.";
  if (target.actions.repair) return "Repair the configuration, then start a fresh T3 Code session.";
  return "Review Technical details and fix the configuration on the AgentEasel host.";
}

/** Why one harness's reporting needs attention, or why its install failed, with the next step. */
export function ReportingTargetProblem({
  target,
  failure,
  density = "default",
}: {
  target: ReportingInstallation;
  failure?: string | undefined;
  density?: ComponentProps<typeof ProblemCard>["density"];
}) {
  const name = providerName(target.provider);
  const details = [target.path, failure ?? target.message].filter(Boolean).join("\n");
  if (failure)
    return (
      <ProblemCard
        tone="error"
        density={density}
        title={`Couldn’t install for ${name}`}
        details={details}
      >
        Check the configuration permissions, then install again.
      </ProblemCard>
    );
  if (target.status === "needs-attention") {
    const missing = !target.path && target.message.includes("ENOENT");
    const profileProblem = target.provider === "antigravity" && !target.path;
    return (
      <ProblemCard
        tone="attention"
        density={density}
        title={
          missing
            ? `${name}’s configuration folder is missing`
            : `${name}’s reporting configuration needs attention`
        }
        details={profileProblem ? undefined : details}
      >
        {reportingSetupGuidance(target, missing, profileProblem)}
      </ProblemCard>
    );
  }
  return null;
}
