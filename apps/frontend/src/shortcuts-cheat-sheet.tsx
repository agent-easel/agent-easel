import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import {
  formatShortcut,
  getDefaultShortcutBindings,
  openRowIds,
  sameShortcutBinding,
  shortcutGroupEntries,
  shortcutGroupLabels,
  type ShortcutBindings,
  type ShortcutGroup,
} from "./keyboard-shortcuts.ts";
import { useShortcutPreferences } from "./shortcut-preferences.ts";
import { settingsMask } from "./settings-navigation.ts";
import {
  Dialog,
  DialogSurface,
  DialogDescription,
  DialogDismiss,
  DialogTitle,
} from "./components/ui/dialog";
import { KeyChip } from "./components/ui/key-chip";
import { TextLink } from "./components/ui/text-link";

const columns = [
  ["application", "navigation"],
  ["runActions", "canvas"],
] as const satisfies readonly (readonly ShortcutGroup[])[];

const desktopDefaults = getDefaultShortcutBindings("desktop");
const openRows: ReadonlySet<string> = new Set(openRowIds);

function sheetEntries(group: ShortcutGroup, bindings: ShortcutBindings) {
  const entries = shortcutGroupEntries(group, bindings).filter(({ keys }) =>
    keys.some((key) => key !== undefined),
  );
  if (
    group === "navigation" &&
    openRowIds.every((id) => sameShortcutBinding(bindings[id], desktopDefaults[id]))
  ) {
    return [
      ...entries.filter(({ id }) => !openRows.has(id)),
      {
        id: "openRows",
        label: "Open row 1–9",
        keys: [`${formatShortcut(bindings.openRow1)} … ${formatShortcut(bindings.openRow9)}`],
      },
    ];
  }
  return entries;
}

function ShortcutSection({
  group,
  bindings,
}: {
  group: ShortcutGroup;
  bindings: ShortcutBindings;
}) {
  const commands = sheetEntries(group, bindings);
  if (!commands.length) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
        {shortcutGroupLabels[group]}
      </h3>
      <dl>
        {commands.map((command) => (
          <div
            key={command.id}
            className="flex min-h-7 items-center justify-between gap-3 text-[13px]"
          >
            <dt>{command.label}</dt>
            <dd>
              <KeyChip>
                {command.id === "zoomIn" && command.keys[0] === "+ / ="
                  ? "+"
                  : command.keys.join(" ")}
              </KeyChip>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Read-only shortcut reference grouped like Settings → Keyboard shortcuts. */
export function ShortcutsCheatSheet({
  open,
  onOpenChange,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
}) {
  const { bindings } = useShortcutPreferences();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSurface
        presentation="workspace"
        className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[720px] flex-col overflow-hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <header className="flex min-h-13 shrink-0 items-center gap-2 border-b pr-3 pl-5">
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-sm font-semibold outline-none">
            Keyboard shortcuts
          </DialogTitle>
          <TextLink asChild className="ml-auto text-[13px]">
            <Link
              to={pathname}
              search={{ settings: { tab: "keyboard" } }}
              mask={settingsMask({ tab: "keyboard" })}
              resetScroll={false}
              onClick={() => onOpenChange(false)}
            >
              Edit in Settings
            </Link>
          </TextLink>
          <DialogDismiss label="Close keyboard shortcuts" />
        </header>
        <DialogDescription className="sr-only">
          Factory commands and their current bindings.
        </DialogDescription>
        <div className="grid min-h-0 gap-8 overflow-y-auto p-5 sm:grid-cols-2">
          {columns.map((groups) => (
            <div key={groups[0]} className="flex min-w-0 flex-col gap-5">
              {groups.map((group) => (
                <ShortcutSection key={group} group={group} bindings={bindings} />
              ))}
            </div>
          ))}
        </div>
      </DialogSurface>
    </Dialog>
  );
}
