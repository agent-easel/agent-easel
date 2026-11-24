import { useState } from "react";
import { Workflow } from "lucide-react";
import type { FactoryDesktop, PreviousInstallation } from "@agent-easel/contracts/desktop-bridge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { GateScreen } from "./gate-screen.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsRow } from "./settings-page.tsx";

function migrationSteps(previous: PreviousInstallation) {
  return [
    previous.remoteServer && {
      title: "Approve this computer again",
      detail:
        "Your server is remembered. Connect once more and approve this computer on the server; T3 Factory’s saved credential stays in its Keychain item.",
    },
    {
      title: "Allow notifications",
      detail:
        "macOS asks again for AgentEasel. Notifications you already received are not repeated.",
    },
    previous.launchAtLogin && {
      title: "Remove T3 Factory from Login Items",
      detail:
        "AgentEasel now opens at login instead. Remove T3 Factory in System Settings → General → Login Items.",
    },
    {
      title: "Move T3 Factory to the Trash",
      detail:
        "T3 Factory no longer starts its server. Its data stays as a backup until you remove it in Settings → Desktop app.",
    },
  ].filter((step) => step !== false);
}

export function MigrationSummary({
  desktop,
  previous,
}: {
  desktop: FactoryDesktop;
  previous: PreviousInstallation;
}) {
  const [error, setError] = useState("");
  const dismiss = async () => {
    const result = await desktop.dismissMigrationSummary();
    setError(result.ok ? "" : result.message);
  };
  return (
    <GateScreen
      size="wide"
      label="Migration from T3 Factory"
      icon={Workflow}
      eyebrow="AgentEasel"
      title="Welcome to AgentEasel"
      description={
        previous.home === "kept-existing"
          ? "AgentEasel brought over your T3 Factory settings and drafts. A few things need you once."
          : "AgentEasel brought over your Flows, Agents, Triggers, Run history, images, T3 Code connection, settings and drafts from T3 Factory. A few things need you once."
      }
    >
      {previous.home === "kept-existing" && (
        <ProblemCard tone="attention" title="AgentEasel kept its existing data home">
          ~/.agenteasel already existed, so your T3 Factory Flows, Agents and Run history were not
          copied. They stay in ~/.t3-factory.
        </ProblemCard>
      )}
      <Surface tone="group">
        {migrationSteps(previous).map((step) => (
          <SettingsRow key={step.title} title={step.title} description={step.detail} />
        ))}
      </Surface>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="justify-self-end" onClick={() => void dismiss()}>
        Continue
      </Button>
    </GateScreen>
  );
}
