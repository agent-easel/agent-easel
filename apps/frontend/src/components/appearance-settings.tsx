import { useClientScope } from "../client-scope.ts";
import { AppearanceChoice } from "./appearance-choice.tsx";
import { SettingsPage } from "./settings-page.tsx";
import { ThemeColorSettings, ThemeColorsNote } from "./theme-color-settings.tsx";

/**
 * Settings → Appearance: this device's Light or Dark choice, then T3 theme colors (detailed on
 * the host; explained on other clients).
 */
export function AppearanceSettings() {
  const host = useClientScope() === "host";
  return (
    <SettingsPage title="Appearance">
      <AppearanceChoice />
      {host ? <ThemeColorSettings /> : <ThemeColorsNote />}
    </SettingsPage>
  );
}
