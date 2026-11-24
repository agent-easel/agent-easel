import { useEffect, useState } from "react";
import type { TelemetrySetting } from "@agent-easel/contracts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "../api.ts";
import { MutationGate } from "../client-gate.tsx";
import { useClientScope } from "../client-scope.ts";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsDetailRow, SettingsGroup, SettingsPage, SettingsRow } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";

const descriptions = {
  environment: "Turned off on the AgentEasel host by FACTORY_TELEMETRY_ENABLED=false.",
  unavailable: "Analytics is unavailable on this AgentEasel host.",
};
const description =
  "Helps improve AgentEasel. Sent from the AgentEasel host without your identity.";

export function PrivacySettings() {
  const host = useClientScope() === "host";
  const [setting, setSetting] = useState<TelemetrySetting | null>(null);
  const [reads, setReads] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api.getTelemetrySetting().then(
      (value) => active && setSetting(value),
      () => active && setReadFailed(true),
    );
    return () => {
      active = false;
    };
  }, [reads]);

  function save(telemetryEnabled: boolean) {
    setSaveFailed(false);
    setSaving(true);
    return api
      .updateTelemetrySetting({ telemetryEnabled })
      .then(setSetting, () => setSaveFailed(true))
      .finally(() => setSaving(false));
  }

  const disabledByHost = host ? setting?.disabledReason : null;
  const retry = () => {
    setReadFailed(false);
    setReads((count) => count + 1);
  };
  return (
    <SettingsPage
      title="Privacy"
      hostManaged={!host}
      badge={disabledByHost && <StatusBadge kind="neutral">Off on the AgentEasel host</StatusBadge>}
      action={readFailed && <Button onClick={retry}>Try again</Button>}
    >
      {readFailed && <ProblemCard tone="error" title="Couldn’t read product analytics" />}
      {!setting && !readFailed && (
        <StatusBadge kind="checking">Reading product analytics…</StatusBadge>
      )}
      {setting && (
        <SettingsGroup label="Product analytics">
          <SettingsRow
            title="Share anonymous usage data"
            description={
              <span className="block max-w-88 wrap-anywhere">
                {disabledByHost ? descriptions[disabledByHost] : description}
              </span>
            }
            control={(text) =>
              host ? (
                <MutationGate>
                  <Switch
                    aria-labelledby={text.title}
                    aria-describedby={text.description}
                    checked={setting.effectiveEnabled}
                    disabled={saving || !!disabledByHost}
                    onCheckedChange={(value) => void save(value)}
                  />
                </MutationGate>
              ) : setting.effectiveEnabled ? (
                "On"
              ) : (
                "Off"
              )
            }
          />
        </SettingsGroup>
      )}
      {saveFailed && (
        <ProblemCard tone="error" title="Couldn’t save product analytics">
          Try the switch again to save your preference.
        </ProblemCard>
      )}
      <SettingsGroup label="What’s sent">
        <SettingsDetailRow
          label="Sent"
          value="AgentEasel version, channel and OS, and counts of the features you use"
        />
        <SettingsDetailRow
          label="Never sent"
          value="Prompts, code, file paths, and names of Projects, Flows, Agents and Runs"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
