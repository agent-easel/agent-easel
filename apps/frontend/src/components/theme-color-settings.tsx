import type {
  AppearancePresentation,
  T3Appearance,
  T3AppearanceState,
} from "@t3-factory/contracts";
import { useAppearance } from "../appearance.ts";
import { useLiveAppearance } from "../live/live-connection.ts";
import { SettingsDetailRow, SettingsGroup, SettingsRow } from "./settings-page.tsx";
import { StatusBadge, type SettingKind } from "./status-badge.tsx";

const statePills: Record<T3AppearanceState, { label: string; kind: SettingKind }> = {
  connecting: { label: "Connecting", kind: "neutral" },
  following: { label: "Following T3", kind: "success" },
  unavailable: { label: "Unavailable", kind: "attention" },
  unsupported: { label: "Not supported", kind: "neutral" },
};

function modeText(presentation: AppearancePresentation | null, mode: "light" | "dark") {
  if (!presentation) return "Factory colors";
  const half = presentation.modes[mode];
  return half.kind === "inherited" ? `T3 “${presentation.theme.name}” colors` : half.explanation;
}

function ThemeColorDetails({ appearance }: { appearance: T3Appearance | null }) {
  const presentation = appearance?.presentation ?? null;
  return (
    <>
      <SettingsDetailRow label="Light" value={modeText(presentation, "light")} />
      <SettingsDetailRow label="Dark" value={modeText(presentation, "dark")} />
    </>
  );
}

/**
 * Host Settings → Appearance → T3 theme colors: whether Factory follows the T3 environment's
 * default theme through the T3 connection, why not, and what each mode shows. Independent of
 * the connection's readiness.
 */
export function ThemeColorSettings() {
  const appearance = useLiveAppearance().value;
  const pill = appearance && statePills[appearance.state];
  return (
    <SettingsGroup
      label="T3 theme colors"
      badge={pill && <StatusBadge kind={pill.kind}>{pill.label}</StatusBadge>}
    >
      <SettingsRow
        title="T3’s default theme colors"
        description={
          <span aria-live="polite">
            {appearance?.explanation ??
              "Factory follows the colors of the T3 environment’s default theme through the T3 connection."}{" "}
            Runs never depend on theme colors.
          </span>
        }
      />
      <ThemeColorDetails appearance={appearance} />
    </SettingsGroup>
  );
}

/** T3 theme colors on clients other than the host: what the selected mode shows, and why. */
export function ThemeColorsNote() {
  const mode = useAppearance();
  const appearance = useLiveAppearance().value;
  if (!appearance) return null;
  const presentation = appearance.presentation;
  const half = presentation?.modes[mode];
  let text = appearance.explanation;
  if (half?.kind === "inherited")
    text = `Colors follow T3’s default theme “${presentation!.theme.name}”.`;
  else if (half) text = half.explanation;
  return (
    <SettingsGroup label="T3 theme colors">
      <SettingsRow description={text} />
    </SettingsGroup>
  );
}
