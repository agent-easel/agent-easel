import { useThemeColors } from "./inherited-colors.tsx";
import { AppearanceChoice } from "./appearance-choice.tsx";
import { SettingsPage } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { ThemeColorSettings } from "./theme-color-settings.tsx";

export function AppearanceSettings() {
  const { status, presentation } = useThemeColors();
  const modes = presentation?.modes;
  const following = modes?.light.kind === "inherited" || modes?.dark.kind === "inherited";
  const checking = !status || status.state === "connecting";
  return (
    <SettingsPage
      title="Appearance"
      badge={
        checking ? (
          <StatusBadge kind="checking">Checking</StatusBadge>
        ) : following ? (
          <StatusBadge kind="success">Following T3</StatusBadge>
        ) : (
          <StatusBadge kind="neutral">Factory colors</StatusBadge>
        )
      }
    >
      <AppearanceChoice />
      <ThemeColorSettings status={status} presentation={presentation} />
    </SettingsPage>
  );
}
