import { useCustomTheme } from "../custom-theme.ts";
import { AppearanceChoice } from "./appearance-choice.tsx";
import { SettingsPage } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { ThemeColorSettings } from "./theme-color-settings.tsx";

export function AppearanceSettings() {
  const { presentation } = useCustomTheme();
  const modes = presentation?.modes;
  const customized = modes?.light.kind === "custom" || modes?.dark.kind === "custom";
  return (
    <SettingsPage
      title="Appearance"
      badge={
        customized ? (
          <StatusBadge kind="success">Custom colors</StatusBadge>
        ) : (
          <StatusBadge kind="neutral">Factory colors</StatusBadge>
        )
      }
    >
      <AppearanceChoice />
      <ThemeColorSettings />
    </SettingsPage>
  );
}
