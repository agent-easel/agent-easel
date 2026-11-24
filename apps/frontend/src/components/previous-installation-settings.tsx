import type { PreviousInstallation } from "@agent-easel/contracts/desktop-bridge";
import { Button } from "@/components/ui/button";
import { relativeDay } from "../time-format.ts";
import { SettingsGroup, SettingsRow } from "./settings-page.tsx";

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
        description={`Brought over ${relativeDay(previous.migratedAt)}. T3 Factory’s data home and desktop settings stay on this Mac until you move them to the Trash.`}
        control={
          <Button variant="outline" onClick={onRemove}>
            Move to Trash…
          </Button>
        }
      />
    </SettingsGroup>
  );
}
