import { MutationGate } from "@/client-gate";
import { useEffect, useId, useState } from "react";
import type { ReportingInstallation } from "@t3-factory/contracts";
import { api } from "../api.ts";
import { Button } from "@/components/ui/button";
import { ProblemCard } from "../components/problem-card.tsx";
import { ReportingTargetProblem } from "../components/reporting-target-problem.tsx";
import { TechnicalDetails } from "../components/technical-details.tsx";
import { SettingsGroup, SettingsPage, SettingsRow } from "../components/settings-page.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import {
  installable,
  providerName,
  targetNeedsAttention,
  targetStatus,
  useReportingState,
} from "../reporting-state.tsx";

export function RuntimeSettings() {
  const { targets, refresh, error, readDetails, running, failures, install } = useReportingState();
  const [checking, setChecking] = useState(true);
  const [instanceNames, setInstanceNames] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    let active = true;
    void refresh().then(() => {
      if (active) setChecking(false);
    });
    void api.getAgentCapabilities().then(
      (value) => {
        if (active && value.state === "ready")
          setInstanceNames(
            new Map(
              value.providers.map((provider) => [
                provider.providerInstanceId,
                provider.displayName,
              ]),
            ),
          );
      },
      () => {}, // The configuration path still distinguishes homes while the T3 catalog is unreachable.
    );
    return () => {
      active = false;
    };
  }, [refresh]);

  const group = targets ?? [];
  const pending = group.filter(installable);
  const needsAction = group.filter(
    (target) => targetNeedsAttention(target) || failures[target.id],
  ).length;
  const busy = checking || running !== null;
  return (
    <SettingsPage
      title="Agent reporting"
      badge={!checking && needsAction > 0 && <ReportingCount count={needsAction} />}
      action={
        <MutationGate>
          <Button
            variant={pending.length || (!error && !needsAction) ? "outline" : "default"}
            disabled={busy}
            onClick={() => {
              setChecking(true);
              void refresh().then(() => setChecking(false));
            }}
          >
            Check again
          </Button>
          {pending.length > 0 && (
            <Button disabled={busy} onClick={() => void install(pending)}>
              Install all
            </Button>
          )}
        </MutationGate>
      }
    >
      {error && !checking && (
        <ProblemCard tone="error" title="Couldn’t check Agent reporting" details={readDetails}>
          Check again in a moment. Runs already started aren’t affected.
        </ProblemCard>
      )}
      {checking && !targets ? (
        <SettingsGroup label="Harnesses">
          <SettingsRow
            control={
              <StatusBadge kind="checking" role="status">
                Checking harnesses…
              </StatusBadge>
            }
          />
        </SettingsGroup>
      ) : (
        <ReportingResults
          targets={group}
          failures={failures}
          running={running}
          busy={busy}
          secondary={pending.length > 0}
          instanceNames={instanceNames}
          install={install}
        />
      )}
    </SettingsPage>
  );
}

function ReportingResults({
  targets,
  failures,
  running,
  busy,
  secondary,
  instanceNames,
  install,
}: {
  targets: readonly ReportingInstallation[];
  failures: Readonly<Record<string, string>>;
  running: string | null;
  busy: boolean;
  secondary: boolean;
  instanceNames: ReadonlyMap<string, string | null>;
  install: (targets: readonly ReportingInstallation[]) => Promise<void>;
}) {
  if (!targets.length) return null;
  const homes = new Map<string, number>();
  for (const target of targets) homes.set(target.provider, (homes.get(target.provider) ?? 0) + 1);
  return (
    <>
      <SettingsGroup label="Harnesses">
        {targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            busy={busy}
            running={running === target.id}
            failed={!!failures[target.id]}
            secondary={secondary}
            instances={displayNames(target, homes, instanceNames)}
            onInstall={() => void install([target])}
          />
        ))}
      </SettingsGroup>
      {targets.map((target) => (
        <ReportingTargetProblem key={target.id} target={target} failure={failures[target.id]} />
      ))}
    </>
  );
}

function ReportingCount({ count }: { count: number }) {
  return (
    <StatusBadge kind="attention">
      {count} {count === 1 ? "needs" : "need"} action
    </StatusBadge>
  );
}

function displayNames(
  target: ReportingInstallation,
  homes: ReadonlyMap<string, number>,
  instanceNames: ReadonlyMap<string, string | null>,
) {
  if ((homes.get(target.provider) ?? 0) < 2) return "";
  return target.instances
    .map((id) => instanceNames.get(id))
    .filter(Boolean)
    .join(", ");
}

function targetAction({ actions }: ReportingInstallation) {
  if (actions.install) return "Install";
  if (actions.repair) return "Repair";
  if (actions.reinstall) return "Reinstall";
  return null;
}

function TargetDescription({
  target,
  instances,
}: {
  target: ReportingInstallation;
  instances: string;
}) {
  return (
    <>
      {instances && <span className="block">{instances}</span>}
      {target.path && (
        <span className="block font-mono text-label wrap-anywhere">{target.path}</span>
      )}
      {target.provider === "antigravity" && target.status === "not-installed" && (
        <span className="block">{target.message}</span>
      )}
      {target.status === "installed" && target.launchSkill && target.launchSkill !== "current" && (
        <span className="block">
          Optional skills {target.launchSkill} · {targetAction(target)}{" "}
          {target.launchSkill === "missing" ? "adds them" : "updates them"}
        </span>
      )}
    </>
  );
}

function targetHasDetails(target: ReportingInstallation) {
  return (
    target.status === "unsupported" ||
    (target.status === "installed" && target.launchSkill !== "current")
  );
}

function TargetRow({
  target,
  busy,
  running,
  failed,
  secondary,
  instances,
  onInstall,
}: {
  target: ReportingInstallation;
  busy: boolean;
  running: boolean;
  failed: boolean;
  secondary: boolean;
  instances: string;
  onInstall: () => void;
}) {
  const actionId = useId();
  const name = providerName(target.provider);
  const action = targetAction(target);
  const status = targetStatus(target, running, failed);
  return (
    <div role="group" aria-label={name}>
      <SettingsRow
        title={name}
        description={<TargetDescription target={target} instances={instances} />}
        control={(text) => (
          <>
            <StatusBadge role="status" kind={status.kind} {...status.badge}>
              {status.label}
            </StatusBadge>
            {action && (
              <MutationGate>
                <Button
                  id={actionId}
                  variant={secondary || action === "Reinstall" ? "outline" : "default"}
                  aria-labelledby={`${actionId} ${text.title}`}
                  disabled={busy}
                  onClick={onInstall}
                >
                  {action}
                </Button>
              </MutationGate>
            )}
          </>
        )}
      />
      {!failed && targetHasDetails(target) && (
        <div className="px-4 pb-3">
          <TechnicalDetails details={target.message} />
        </div>
      )}
    </div>
  );
}
