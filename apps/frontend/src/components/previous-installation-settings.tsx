import type { PreviousInstallation } from "@agent-easel/contracts/desktop-bridge";
import { Button } from "@/components/ui/button";
import { relativeDay } from "../time-format.ts";
import { SettingsGroup, SettingsRow } from "./settings-page.tsx";

function copiedBackup({ home, profile }: PreviousInstallation) {
  if (home !== "copied")
    return "T3 Factory’s desktop settings stay on this Mac until you move them to the Trash. Its data home (~/.t3-factory) was not copied and is never moved from here.";
  if (profile !== "copied")
    return "T3 Factory’s data home stays on this Mac until you move it to the Trash. Its desktop settings were not copied and are never moved from here.";
  return "T3 Factory’s data home and desktop settings stay on this Mac until you move them to the Trash.";
}

export function PreviousInstallationSettings({
  previous,
  onRemove,
}: {
  previous: PreviousInstallation;
  onRemove: () => void;
}) {
  return (
    <SettingsGroup label="Previous T3 Factory data">
      <SettingsRow
        title="Backup from T3 Factory"
        description={`Brought over ${relativeDay(previous.migratedAt)}. ${copiedBackup(previous)}`}
        control={
          <Button variant="outline" onClick={onRemove}>
            Move to Trash…
          </Button>
        }
      />
    </SettingsGroup>
  );
}
