import { ExternalLink } from "lucide-react";
import { TextLink } from "@/components/ui/text-link";
import { ProblemCard } from "./problem-card.tsx";

export function AgentEaselNotice() {
  return (
    <div className="shrink-0 px-3 pb-3">
      <ProblemCard
        tone="info"
        density="compact"
        label="T3 Factory is now AgentEasel"
        title="T3 Factory is now AgentEasel"
        action={
          <TextLink href="https://agenteasel.app/" trailingIcon={ExternalLink}>
            Download AgentEasel
          </TextLink>
        }
      >
        This is the last T3 Factory version. AgentEasel brings over your data on first launch; until
        then this app keeps working.
      </ProblemCard>
    </div>
  );
}
