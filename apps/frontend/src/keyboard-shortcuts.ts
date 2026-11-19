import { desktopBridge } from "./desktop-bridge.ts";

export type ShortcutPlatform = "desktop" | "browser";

export type ShortcutGroup = "application" | "navigation" | "runActions" | "canvas";

export const shortcutGroupLabels: Record<ShortcutGroup, string> = {
  application: "Application",
  navigation: "Navigation",
  runActions: "Open Run actions",
  canvas: "Canvas",
};

export const shortcutDefinitions = [
  { id: "palette", label: "Command palette", scope: "global", group: "application" },
  { id: "settings", label: "Settings", scope: "global", group: "application" },
  { id: "newRun", label: "New Run", scope: "global", group: "application" },
  { id: "searchRuns", label: "Filter Run titles", scope: "global", group: "application" },
  { id: "studio", label: "Studio", scope: "global", group: "application" },
  { id: "shortcutsCheatSheet", label: "Keyboard shortcuts", scope: "global", group: "application" },
  { id: "back", label: "Back", scope: "global", group: "navigation" },
  { id: "forward", label: "Forward", scope: "global", group: "navigation" },
  { id: "previousRun", label: "Previous Run", scope: "global", group: "navigation" },
  { id: "nextRun", label: "Next Run", scope: "global", group: "navigation" },
  { id: "openRow1", label: "Open row 1", scope: "global", group: "navigation" },
  { id: "openRow2", label: "Open row 2", scope: "global", group: "navigation" },
  { id: "openRow3", label: "Open row 3", scope: "global", group: "navigation" },
  { id: "openRow4", label: "Open row 4", scope: "global", group: "navigation" },
  { id: "openRow5", label: "Open row 5", scope: "global", group: "navigation" },
  { id: "openRow6", label: "Open row 6", scope: "global", group: "navigation" },
  { id: "openRow7", label: "Open row 7", scope: "global", group: "navigation" },
  { id: "openRow8", label: "Open row 8", scope: "global", group: "navigation" },
  { id: "openRow9", label: "Open row 9", scope: "global", group: "navigation" },
  { id: "snoozeRestore", label: "Snooze or restore Run", scope: "global", group: "runActions" },
  { id: "settle", label: "Settle Run", scope: "global", group: "runActions" },
  { id: "archive", label: "Archive Run…", scope: "global", group: "runActions" },
  { id: "rename", label: "Rename Run", scope: "contextual", group: "runActions" },
  { id: "toggleInspector", label: "Toggle inspector", scope: "global", group: "runActions" },
  { id: "zoomIn", label: "Zoom in", scope: "canvas", group: "canvas" },
  { id: "zoomOut", label: "Zoom out", scope: "canvas", group: "canvas" },
  { id: "fit", label: "Fit canvas", scope: "canvas", group: "canvas" },
  { id: "followActive", label: "Follow active", scope: "canvas", group: "canvas" },
] as const;

export type ShortcutId = (typeof shortcutDefinitions)[number]["id"];
export type ShortcutBinding = { key: string; mod: boolean; alt: boolean; shift: boolean };
export type ShortcutBindings = Record<ShortcutId, ShortcutBinding | null>;

export const openRowIds = [
  "openRow1",
  "openRow2",
  "openRow3",
  "openRow4",
  "openRow5",
  "openRow6",
  "openRow7",
  "openRow8",
  "openRow9",
] as const satisfies readonly ShortcutId[];

/** The six commands and bindings persisted before storage version 2. */
const legacyV1ShortcutDefaults: Record<
  "palette" | "settings" | "newRun" | "zoomIn" | "zoomOut" | "fit",
  ShortcutBinding
> = {
  palette: { key: "k", mod: true, alt: false, shift: false },
  settings: { key: ",", mod: true, alt: false, shift: false },
  newRun: { key: "n", mod: true, alt: true, shift: false },
  zoomIn: { key: "=", mod: false, alt: false, shift: false },
  zoomOut: { key: "-", mod: false, alt: false, shift: false },
  fit: { key: "0", mod: false, alt: false, shift: false },
};

const legacyV1Ids = new Set(Object.keys(legacyV1ShortcutDefaults));

export function getShortcutPlatform(): ShortcutPlatform {
  return desktopBridge() ? "desktop" : "browser";
}

function binding(
  key: string,
  options: Partial<Omit<ShortcutBinding, "key">> = {},
): ShortcutBinding {
  return { key, mod: false, alt: false, shift: false, ...options };
}

const sharedPlatformDefaults = {
  palette: binding("k", { mod: true }),
  settings: binding(",", { mod: true }),
  previousRun: binding("ArrowUp", { mod: true, alt: true }),
  nextRun: binding("ArrowDown", { mod: true, alt: true }),
  studio: binding("s", { mod: true, shift: true }),
  shortcutsCheatSheet: binding("/", { mod: true }),
  snoozeRestore: binding("z", { mod: true, shift: true }),
  settle: binding("e", { mod: true, shift: true }),
  archive: binding("Backspace", { mod: true }),
  rename: binding("F2"),
  toggleInspector: binding(".", { mod: true }),
  zoomIn: binding("="),
  zoomOut: binding("-"),
  fit: binding("0"),
  followActive: binding("."),
} satisfies Partial<Record<ShortcutId, ShortcutBinding>>;

const desktopOnlyDefaults = {
  newRun: binding("n", { mod: true }),
  searchRuns: binding("f", { mod: true }),
  back: binding("[", { mod: true }),
  forward: binding("]", { mod: true }),
  openRow1: binding("1", { mod: true }),
  openRow2: binding("2", { mod: true }),
  openRow3: binding("3", { mod: true }),
  openRow4: binding("4", { mod: true }),
  openRow5: binding("5", { mod: true }),
  openRow6: binding("6", { mod: true }),
  openRow7: binding("7", { mod: true }),
  openRow8: binding("8", { mod: true }),
  openRow9: binding("9", { mod: true }),
} satisfies Partial<Record<ShortcutId, ShortcutBinding>>;

const browserOnlyDefaults = {
  newRun: binding("n", { mod: true, alt: true }),
  searchRuns: binding("f", { mod: true, shift: true }),
  back: null,
  forward: null,
  openRow1: null,
  openRow2: null,
  openRow3: null,
  openRow4: null,
  openRow5: null,
  openRow6: null,
  openRow7: null,
  openRow8: null,
  openRow9: null,
} satisfies Partial<Record<ShortcutId, ShortcutBinding | null>>;

export function getDefaultShortcutBindings(platform = getShortcutPlatform()): ShortcutBindings {
  const specific = platform === "desktop" ? desktopOnlyDefaults : browserOnlyDefaults;
  return shortcutDefinitions.reduce((result, { id }) => {
    result[id] =
      id in specific
        ? (specific[id as keyof typeof specific] ?? null)
        : (sharedPlatformDefaults[id as keyof typeof sharedPlatformDefaults] ?? null);
    return result;
  }, {} as ShortcutBindings);
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

const physicalKeys: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: " ",
};

function eventKey(event: Pick<KeyboardEvent, "key" | "code">) {
  if (event.key === "Dead" || (event.key.length === 1 && event.key.charCodeAt(0) > 127)) {
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    return physicalKeys[event.code] ?? event.key;
  }
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function shouldHandleShortcut(event: KeyboardEvent) {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.getModifierState("AltGraph")
  );
}

export type ShortcutProblem = {
  tag: string;
  title: string;
  message: string;
};

export function shortcutModifierError(event: KeyboardEvent): ShortcutProblem | undefined {
  if (event.getModifierState("AltGraph"))
    return {
      tag: "Reserved",
      title: "AltGr is used for typing characters",
      message: "Choose a combination without AltGr.",
    };
  if (isMacPlatform() ? event.ctrlKey : event.metaKey)
    return {
      tag: isMacPlatform() ? "Needs ⌘" : "Needs Ctrl",
      title: isMacPlatform() ? "Use ⌘ for this shortcut" : "Use Ctrl for this shortcut",
      message: isMacPlatform() ? "Press ⌘ without ⌃." : "Press Ctrl without Meta.",
    };
  return undefined;
}

/** Plus and equals share a chord, including Shift used to print + on US keyboards. */
export function shortcutFromEvent(event: KeyboardEvent): ShortcutBinding | undefined {
  if (!shouldHandleShortcut(event) || shortcutModifierError(event)) return undefined;
  const key = eventKey(event);
  if (["Control", "Meta", "Alt", "Shift", "AltGraph", "Dead", "Unidentified"].includes(key))
    return undefined;
  return {
    key: key === "+" ? "=" : key,
    mod: isMacPlatform() ? event.metaKey : event.ctrlKey,
    alt: event.altKey,
    shift: key === "+" ? false : event.shiftKey,
  };
}

export function sameShortcutBinding(left: ShortcutBinding | null, right: ShortcutBinding | null) {
  if (!left || !right) return left === right;
  return (
    left.key === right.key &&
    left.mod === right.mod &&
    left.alt === right.alt &&
    left.shift === right.shift
  );
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding | null | undefined) {
  if (!binding) return false;
  const candidate = shortcutFromEvent(event);
  return !!candidate && sameShortcutBinding(candidate, binding);
}

const fixedKeys = new Set(["Escape", "Tab", "Enter", "Delete", "ContextMenu"]);

const supportedKey = (key: string) =>
  /^[\x20-\x7e]$/.test(key) ||
  /^F([1-9]|1[0-2])$/.test(key) ||
  [
    "Backspace",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ].includes(key);

const browserReservedModKeys = new Set([
  "a",
  "c",
  "v",
  "x",
  "z",
  "y",
  "f",
  "l",
  "n",
  "o",
  "p",
  "r",
  "s",
  "t",
  "w",
  "j",
  "h",
  "d",
  "u",
  "q",
  "e",
  "g",
  "b",
  "=",
  "-",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "[",
  "]",
]);

const desktopReservedModKeys = new Set(
  [...browserReservedModKeys].filter(
    (key) => !["n", "1", "2", "3", "4", "5", "6", "7", "8", "9", "[", "]"].includes(key),
  ),
);

const browserFunctionKeys = new Set([
  "F1",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F10",
  "F11",
  "F12",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
]);

function isShortcutPlatformReserved(binding: ShortcutBinding, platform: ShortcutPlatform) {
  if (
    Object.values(getDefaultShortcutBindings(platform)).some((candidate) =>
      sameShortcutBinding(candidate, binding),
    )
  )
    return false;
  if (browserFunctionKeys.has(binding.key)) return true;
  if (!binding.mod) return false;
  const nativeModKeys = platform === "desktop" ? desktopReservedModKeys : browserReservedModKeys;
  if (!binding.alt && nativeModKeys.has(binding.key)) return true;
  if (isMacPlatform() && !binding.alt && ["m", "i"].includes(binding.key)) return true;
  if (binding.shift && ["i", "k", "m"].includes(binding.key)) return true;
  return binding.alt && ["i", "j", "c", "u", "b", "l"].includes(binding.key);
}

function bindingKeyError(binding: ShortcutBinding) {
  if (fixedKeys.has(binding.key))
    return "This key belongs to a fixed navigation or editing control. Choose another key.";
  if (
    !supportedKey(binding.key) ||
    (binding.key !== binding.key.toLowerCase() && binding.key.length === 1) ||
    binding.key === "+"
  )
    return "Choose a letter, number, punctuation key or function key.";
  if (binding.key === "=" && binding.shift)
    return "Plus and equals share one shortcut. Press + or = without extra Shift modifiers.";
  return undefined;
}

export function conflictingShortcut(
  id: ShortcutId,
  binding: ShortcutBinding,
  bindings: ShortcutBindings,
) {
  return shortcutDefinitions.find(
    (other) => other.id !== id && sameShortcutBinding(binding, bindings[other.id]),
  );
}

export function validateShortcutBinding(
  id: ShortcutId,
  binding: ShortcutBinding,
  bindings: ShortcutBindings,
  platform = getShortcutPlatform(),
): ShortcutProblem | undefined {
  const keyError = bindingKeyError(binding);
  if (keyError) return { tag: "Reserved", title: "Choose another key", message: keyError };
  const definition = shortcutDefinitions.find((item) => item.id === id)!;
  const modifier = isMacPlatform() ? "⌘" : "Ctrl";
  if (definition.scope === "global" && !binding.mod)
    return {
      tag: `Needs ${modifier}`,
      title: `Global shortcuts need ${modifier}`,
      message: `Hold ${modifier} and press another key.`,
    };
  if (definition.scope === "canvas" && !binding.mod && binding.alt)
    return {
      tag: `Needs ${modifier}`,
      title: "Choose a canvas shortcut",
      message: `Use a bare key or hold ${modifier}.`,
    };
  if (isShortcutPlatformReserved(binding, platform))
    return {
      tag: "Reserved",
      title:
        platform === "browser"
          ? "The browser reserves this shortcut"
          : "Navigation or text editing uses this shortcut",
      message: "Press another shortcut.",
    };
  const conflict = conflictingShortcut(id, binding, bindings);
  return conflict
    ? {
        tag: "In use",
        title: `${conflict.label} uses ${formatShortcut(binding)}`,
        message: `Press another shortcut, or change ${conflict.label} first.`,
      }
    : undefined;
}

const macKeyGlyphs = new Map([
  ["ArrowLeft", "←"],
  ["ArrowUp", "↑"],
  ["ArrowRight", "→"],
  ["ArrowDown", "↓"],
  ["Backspace", "⌫"],
  ["Delete", "⌦"],
  ["Enter", "↵"],
  ["Escape", "Esc"],
  ["Tab", "⇥"],
  [" ", "␣"],
  ["Home", "↖"],
  ["End", "↘"],
  ["PageUp", "⇞"],
  ["PageDown", "⇟"],
  ["Insert", "Ins"],
  ["ContextMenu", "☰"],
]);

// The binding model reserves Control on Mac. The remaining modifiers follow Apple order.
const macModifierGlyphs = [
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["mod", "⌘"],
] as const;

const pcModifierLabels = [
  ["mod", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
] as const;

export function formatShortcut(binding: ShortcutBinding | null | undefined): string | undefined {
  if (!binding) return undefined;
  const mac = isMacPlatform();
  const modifiers = (mac ? macModifierGlyphs : pcModifierLabels)
    .filter(([modifier]) => binding[modifier])
    .map(([, label]) => label);
  const key = binding.key;
  const platformKey = mac ? macKeyGlyphs.get(key) : key === " " ? "Space" : undefined;
  const sharedKey = key === "=" ? "+ / =" : key.length === 1 ? key.toUpperCase() : key;
  return [...modifiers, platformKey ?? sharedKey].join(mac ? "" : "+");
}

/** ARIA uses UI Events key names and plus separators on every platform. */
export function shortcutAriaKeys(binding: ShortcutBinding | null) {
  if (!binding) return undefined;
  return [
    binding.mod ? (isMacPlatform() ? "Meta" : "Control") : "",
    binding.alt ? "Alt" : "",
    binding.shift ? "Shift" : "",
    binding.key === " " ? "Space" : binding.key,
  ]
    .filter(Boolean)
    .join("+");
}

/** One line of a shortcut group as the cheat sheet and the canvas shortcuts popover list it. */
export type ShortcutEntry = {
  readonly id: string;
  readonly label: string;
  readonly keys: readonly (string | undefined)[];
};

/** Fixed contextual controls listed with a registry group; they cannot be rebound. */
const canvasPanKeys = ["←", "↑", "→", "↓"];
const fixedGroupEntries: Partial<Record<ShortcutGroup, readonly ShortcutEntry[]>> = {
  canvas: [{ id: "pan", label: "Pan", keys: canvasPanKeys }],
};

export const fixedShortcuts = {
  deleteConnection: binding("Backspace"),
  openRowMenu: binding("F10", { shift: true }),
  startRun: binding("Enter", { mod: true }),
  undoFlowEdit: binding("z", { mod: true }),
};

export function fixedShortcutRows() {
  return [
    { label: "Close dialog or cancel", keys: ["Esc"] },
    { label: "Start Run from the composer", keys: [formatShortcut(fixedShortcuts.startRun)] },
    { label: "Pan canvas", keys: canvasPanKeys },
    {
      label: "Remove selected connection",
      keys: [formatShortcut(fixedShortcuts.deleteConnection)],
    },
    { label: "Open Run row menu", keys: [formatShortcut(fixedShortcuts.openRowMenu)] },
    { label: "Undo Flow edit", keys: [formatShortcut(fixedShortcuts.undoFlowEdit)] },
  ];
}

/** A group's registry commands with their current bindings, then its fixed controls. */
export function shortcutGroupEntries(
  group: ShortcutGroup,
  bindings: ShortcutBindings,
): readonly ShortcutEntry[] {
  return [
    ...shortcutDefinitions
      .filter((command) => command.group === group)
      .map((command) => ({
        id: command.id,
        label: command.label,
        keys: [formatShortcut(bindings[command.id])],
      })),
    ...(fixedGroupEntries[group] ?? []),
  ];
}

function bindingFingerprint(binding: ShortcutBinding) {
  return `${binding.mod}:${binding.alt}:${binding.shift}:${binding.key}`;
}

function isLegacyV1Default(id: ShortcutId, stored: ShortcutBinding) {
  return (
    legacyV1Ids.has(id) &&
    sameShortcutBinding(
      stored,
      legacyV1ShortcutDefaults[id as keyof typeof legacyV1ShortcutDefaults],
    )
  );
}

function placeShortcutBinding(
  id: ShortcutId,
  target: ShortcutBinding | null,
  occupied: Map<string, ShortcutId>,
  bindings: ShortcutBindings,
  conflicts: ShortcutId[],
) {
  if (!target) {
    bindings[id] = null;
    return;
  }
  const fingerprint = bindingFingerprint(target);
  if (occupied.has(fingerprint)) {
    bindings[id] = null;
    conflicts.push(id);
    return;
  }
  bindings[id] = target;
  occupied.set(fingerprint, id);
}

function parseBinding(value: unknown): ShortcutBinding | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    !("mod" in value) ||
    typeof value.mod !== "boolean" ||
    !("alt" in value) ||
    typeof value.alt !== "boolean" ||
    !("shift" in value) ||
    typeof value.shift !== "boolean"
  )
    return undefined;
  return { key: value.key, mod: value.mod, alt: value.alt, shift: value.shift };
}

export type ParsedShortcutStorage = {
  bindings: ShortcutBindings;
  conflicts: ShortcutId[];
  storageIssue?: string;
};

type StoredShortcutBlob = {
  version: unknown;
  bindings: unknown;
  conflicts?: unknown;
};

function readStoredConflicts(raw: unknown): ShortcutId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry: unknown): entry is ShortcutId =>
      typeof entry === "string" && shortcutDefinitions.some(({ id }) => id === entry),
  );
}

const corruptStoredShortcutMessage =
  "Some stored shortcuts could not be restored. Valid preferences were kept.";

function restoreStoredBindings(
  source: Record<string, unknown>,
  platform: ShortcutPlatform,
  legacy: boolean,
) {
  const defaults = getDefaultShortcutBindings(platform);
  const bindings = Object.fromEntries(
    shortcutDefinitions.map(({ id }) => [id, null]),
  ) as ShortcutBindings;
  const occupied = new Map<string, ShortcutId>();
  const conflicts: ShortcutId[] = [];
  let storageIssue: string | undefined;
  const supplied = new Set<ShortcutId>();
  for (const { id } of shortcutDefinitions.filter(({ id }) => id in source)) {
    const value = source[id];
    const parsed = parseBinding(value);
    if (legacy && parsed && isLegacyV1Default(id, parsed)) continue;
    if (value === null && !legacy) {
      supplied.add(id);
      continue;
    }
    if (!parsed || validateShortcutBinding(id, parsed, bindings, platform)) {
      storageIssue = corruptStoredShortcutMessage;
      continue;
    }
    supplied.add(id);
    placeShortcutBinding(id, parsed, occupied, bindings, conflicts);
  }
  for (const { id } of shortcutDefinitions) {
    if (!supplied.has(id)) placeShortcutBinding(id, defaults[id], occupied, bindings, conflicts);
  }
  return { bindings, conflicts, ...(storageIssue ? { storageIssue } : {}) };
}

export function parseShortcutStorage(
  raw: string,
  platform = getShortcutPlatform(),
): ParsedShortcutStorage | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || !("version" in data) || !("bindings" in data))
    return undefined;
  const stored = data as StoredShortcutBlob;
  if (stored.version !== 1 && stored.version !== 2) return undefined;
  if (!stored.bindings || typeof stored.bindings !== "object" || Array.isArray(stored.bindings))
    return {
      bindings: getDefaultShortcutBindings(platform),
      conflicts: [],
      storageIssue: corruptStoredShortcutMessage,
    };
  const result = restoreStoredBindings(
    stored.bindings as Record<string, unknown>,
    platform,
    stored.version === 1,
  );
  result.conflicts = [
    ...new Set([
      ...result.conflicts,
      ...readStoredConflicts(stored.conflicts).filter((id) => result.bindings[id] === null),
    ]),
  ];
  return result;
}
