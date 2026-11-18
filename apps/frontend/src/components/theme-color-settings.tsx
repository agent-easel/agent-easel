import { Unplug } from "lucide-react";
import type { AppearancePresentation, T3Appearance } from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { useSettingsNavigation } from "../settings-navigation.ts";
import { SettingsDetailRow, SettingsGroup, SettingsProblemCard } from "./settings-page.tsx";

export function ThemeColorSettings({
  status,
  presentation,
}: {
  status: T3Appearance | null;
  presentation: AppearancePresentation | null;
}) {
  if (status?.state === "unsupported")
    return (
      <SettingsProblemCard tone="info" title="This T3 doesn’t share its theme">
        Update T3 to follow its theme.
      </SettingsProblemCard>
    );
  if (status?.state === "unavailable" && !presentation) return <ThemeConnectionProblem />;
  const name = presentation?.theme.name ?? status?.unreadableTheme;
  const checking = !status || status.state === "connecting";
  const modes = presentation?.modes;
  const rejected = modes?.light.kind === "baseline" && modes.dark.kind === "baseline";
  const details = rejected
    ? [modes.light.explanation, modes.dark.explanation].join("\n")
    : status?.unreadableTheme
      ? status.explanation
      : undefined;
  return (
    <>
      <SettingsGroup label="T3 theme">
        <SettingsDetailRow label="Theme" value={name ?? (checking ? "—" : "None set in T3")} />
        {modes && !rejected && <ThemeModes modes={modes} />}
      </SettingsGroup>
      {details && (
        <SettingsProblemCard
          tone="info"
          title={`Factory can’t use the “${name}” theme`}
          details={details}
        >
          Factory uses its own colors.
        </SettingsProblemCard>
      )}
    </>
  );
}

function ThemeModes({ modes }: { modes: AppearancePresentation["modes"] }) {
  return (
    <>
      <SettingsDetailRow
        label="Light"
        value={modes.light.kind === "inherited" ? "T3 colors" : "Factory colors"}
      />
      <SettingsDetailRow
        label="Dark"
        value={modes.dark.kind === "inherited" ? "T3 colors" : "Factory colors"}
      />
    </>
  );
}

function ThemeConnectionProblem() {
  const openSettings = useSettingsNavigation();
  return (
    <SettingsProblemCard
      tone="info"
      icon={Unplug}
      title="Theme colors wait for the T3 connection"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openSettings({ tab: "connection" })}
        >
          Open T3 connection
        </Button>
      }
    >
      Factory colors are used meanwhile.
    </SettingsProblemCard>
  );
}
