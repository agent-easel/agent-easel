import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { settingsTabAt, type SettingsSelection } from "../settings-navigation.ts";
import { useNavigationBlock } from "../use-navigation-block.ts";

/**
 * Asks before leaving `tab`, closing Settings or unloading the page while `drafts`, the titles of
 * that page's sections with unsaved edits, is not empty. Each section keeps its own Save/Discard.
 */
export function useSettingsDraftGuard(tab: SettingsSelection["tab"], drafts: readonly string[]) {
  return useNavigationBlock(drafts.length > 0, (location) =>
    drafts.length && settingsTabAt(location) !== tab ? drafts : undefined,
  );
}

/** Keep editing or discard every listed section's unsaved edits and continue. */
export function SettingsDraftDialog({
  decision,
}: {
  decision: ReturnType<typeof useSettingsDraftGuard>;
}) {
  if (decision.status !== "blocked") return null;
  const names = decision.unsaved.join(" and ");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) decision.reset();
      }}
    >
      <DialogContent
        title={`Discard unsaved ${names} changes?`}
        description="Discard your edits to continue with the saved settings."
        actions={
          <>
            <Button variant="outline" onClick={decision.reset}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={decision.proceed}>
              Discard changes
            </Button>
          </>
        }
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          decision.reset();
        }}
      ></DialogContent>
    </Dialog>
  );
}
