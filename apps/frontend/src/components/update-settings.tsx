import { useState } from "react";
import type { DesktopState, FactoryDesktop } from "@agent-easel/contracts/desktop-bridge";
import { Button } from "@/components/ui/button";
import { useUpgrade } from "../use-upgrade.ts";
import { dayAndTime } from "../time-format.ts";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsDetailRow, SettingsGroup, SettingsRow } from "./settings-page.tsx";
import { StatusBadge, type SettingKind } from "./status-badge.tsx";
import { downloadPercent, versionIn } from "./update-control.tsx";
import { UpgradeReview } from "./upgrade-review.tsx";

const channelOptions = [
  ["stable", "Stable"],
  ["beta", "Beta"],
] as const;

export function useSettingsUpdate(local: boolean) {
  const upgrade = useUpgrade({ includeServer: !local });
  const { phase, targets } = upgrade;
  const [reviewing, setReviewing] = useState(false);
  const available = targets.length > 0;
  const labels: Record<typeof phase, [SettingKind, string]> = {
    idle: ["success", "Up to date"],
    "up-to-date": ["success", "Up to date"],
    checking: ["checking", "Checking…"],
    available: ["info", `${versionIn(targets, "available")} available`],
    downloading: ["checking", `Downloading · ${downloadPercent(targets)}%`],
    ready: ["info", `${versionIn(targets, "downloaded")} downloaded`],
    upgrading: ["checking", "Upgrading…"],
    error: ["error", "Update failed"],
  };
  const [kind, label] = available ? labels[phase] : (["neutral", "Updates unavailable"] as const);
  const action = available ? settingsUpdateAction(upgrade, () => setReviewing(true)) : null;

  return {
    badge: (
      <StatusBadge role="status" kind={kind}>
        {label}
      </StatusBadge>
    ),
    action,
    phase,
    feedback: (
      <>
        {phase === "error" && <UpdateProblem upgrade={upgrade} />}
        {reviewing && phase === "ready" && (
          <UpgradeReview
            targets={targets}
            onCancel={() => setReviewing(false)}
            onConfirm={() => {
              setReviewing(false);
              void upgrade.upgrade();
            }}
          />
        )}
      </>
    ),
  };
}

function settingsUpdateAction(upgrade: ReturnType<typeof useUpgrade>, review: () => void) {
  switch (upgrade.phase) {
    case "available":
      return <Button onClick={() => void upgrade.download()}>Download update</Button>;
    case "ready":
      return <Button onClick={review}>Upgrade…</Button>;
    case "error":
      return <Button onClick={() => void upgrade.check()}>Check again</Button>;
    case "idle":
    case "up-to-date":
      return (
        <Button
          variant="outline"
          disabled={upgrade.phase === "up-to-date"}
          onClick={() => void upgrade.check()}
        >
          Check for updates
        </Button>
      );
    case "checking":
    case "downloading":
    case "upgrading":
      return null;
  }
}

function UpdateProblem({ upgrade }: { upgrade: ReturnType<typeof useUpgrade> }) {
  const failed = upgrade.targets.filter((target) => target.update.state === "error");
  const details =
    upgrade.failure?.message ??
    failed
      .map(({ update }) => [update.checkedAt, update.message].filter(Boolean).join(" · "))
      .filter(Boolean)
      .join("\n");
  const version = failed[0]?.update.version;
  return (
    <ProblemCard
      tone="error"
      title={
        upgrade.failure?.title ??
        (version ? `Couldn’t install ${version}` : "Couldn’t update Factory")
      }
      details={details}
    >
      Factory stays on its current version.
    </ProblemCard>
  );
}

export function UpdateSettings({
  state,
  desktop,
  downloading,
  onChange,
}: {
  state: DesktopState;
  desktop: FactoryDesktop;
  downloading: boolean;
  onChange: (operation: () => ReturnType<FactoryDesktop["setUpdateChannel"]>) => void;
}) {
  const supported = state.update.state !== "unsupported";
  return (
    <>
      {supported && state.updateChannel === "stable" && state.version.includes("-beta.") && (
        <ProblemCard tone="info" title="This beta stays until a newer stable release" />
      )}
      <SettingsGroup label="Updates">
        <SettingsDetailRow label="Version" value={state.version} />
        {supported && (
          <>
            <SettingsRow
              title="Release channel"
              control={(text) => (
                <SegmentedChoice
                  labelledBy={text.title}
                  value={state.updateChannel}
                  options={channelOptions}
                  disabled={downloading}
                  onChange={(channel) => onChange(() => desktop.setUpdateChannel(channel))}
                />
              )}
            />
            <SettingsDetailRow
              label="Last checked"
              value={state.update.checkedAt ? dayAndTime(state.update.checkedAt) : "—"}
            />
          </>
        )}
      </SettingsGroup>
    </>
  );
}
