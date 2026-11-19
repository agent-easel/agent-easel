# Frontend design system

Factory uses shadcn/ui on Tailwind CSS v4 with one set of semantic tokens, each with a
Light and a Dark value. Reuse the existing primitives and token vocabulary; do not introduce
parallel stylesheets, global element styling or per-screen color palettes.

## Light and Dark

**Settings → Appearance** offers exactly **Light** and **Dark**; Dark is the
default and there is no System mode. The choice is local to the client, never sent to the
server, and available on every connection gate and while offline; see
[Desktop and approved clients](desktop-and-clients.md#appearance).

The mode is `data-appearance` on `<html>`. Every color token, `color-scheme` (native
controls and scrollbars), the `dark:` variant and the browser `theme-color` follow it, so a
change applies at once without a reload. Color transitions are suspended for that instant
so controls do not fade one by one. Light is its own baseline, not an inversion of Dark:
white canvases and zinc structure, primary actions at a darker indigo, and status colors at
darker shades of the same hue families so text and dots stay readable on light surfaces.
Typography, geometry, radii and motion are identical in both modes. Raw Run images, project
favicons and emoji keep their pixels. Forced-colors mode replaces Factory's colors with the
system palette in either mode; meaning stays carried by labels and icons.

### T3 theme colors

With [theme colors](t3-integration.md#theme-colors), every color token can come
from the T3 environment's default theme instead of the baseline, separately per mode: the local
mode still picks Light or Dark, and a mode without an accepted T3 half keeps its baseline.
Appearance shows **Following T3** when either mode uses T3 colors, **Checking** during the read,
and **Factory colors** otherwise. Factory keeps its own typography, geometry, radii, shadows and motion.

The backend maps T3 roles by meaning: canvas to the background, raised surfaces to cards and
popovers, text and muted text to the foregrounds, sidebar roles to the sidebar, borders and
inputs to lines, accent to primary actions and links, focus to the focus ring. Hover, pressed and
selected fills are derived from the canvas or sidebar with that surface's own hue and chroma, so
they stay neutral and never take the accent. Status colors keep Factory's hue families from the
mode's baseline. A mode must keep its own polarity (a dark canvas in Dark, a light one in Light).

Contrast policy: text, secondary text, action labels, links and status colors need 4.5:1 on
every surface they appear on, and focus rings and section labels 3:1. A color that misses is moved
in lightness only, toward black or white, until it passes; if a required pair cannot pass, that
whole mode uses its Factory baseline. Appearance identifies which colors each mode uses and
shows **Technical details** when Factory cannot use the theme at all.
The primary action darkens on hover as in the baselines; an accent of middle lightness, on which
only a dark label is readable, lightens on hover instead so the label stays readable. The same
mapping and policy apply to built-in, seed-generated, overridden and variant palettes.
Clients receive only Factory-formatted color values and apply them through the CSSOM as one rule
per mode. Gates and unapproved screens use the baseline. The desktop window background and the
first paint use the baseline until a client receives the presentation.

## Visual rules

- Use neutral surfaces and borders for structure. Indigo marks primary actions and
  links; a selected Run row uses a neutral fill rather than the brand color.
- Keep status meaning consistent in both modes: cyan for working, indigo for waiting, green for success,
  amber for attention, red for problems and muted neutral for stopped work. Pair color
  with a label or icon; project icon colors identify projects, not availability. Studio's
  owner badge and group icon mark an owning Project in brand cyan beside its name and an
  unavailable one in the attention color with its reason; Global stays neutral. The dot
  on **Follow active** marking unseen Run progress uses the working color.
- Use Inter for interface text, exit names and key chips; Geist Mono stays for zoom levels.
  Fonts are bundled; rendering must not require network font services.
- Keep the interface compact, with consistent field, button, panel and sidebar dimensions.
  Secondary/helper text must remain readable; faint uppercase section labels are not a
  substitute for readable helper text.
- Focus must stay visible. Respect reduced motion: remove spatial transitions and keep
  modal changes short; programmatic canvas viewport moves jump instead of animating.
  Interactive controls must remain outside desktop drag regions.

## Components and interaction

Use shared shadcn/ui primitives and their variants for interactive controls instead of
raw HTML controls at call sites. Keep native semantics inside the shared primitives.
Tune a shared variant when the same design rule applies across screens; avoid repeated
call-site overrides and styled wrapper elements used only to compensate for a primitive.

Destructive Settle confirmation uses the shared alert dialog, initially focuses Cancel and restores
focus to its opener (or the Run row after a row-menu action) on dismissal.

Every status and field-state tag is one status badge: a 4 px rounded, 18 px high tag with an
icon and a label in the state colour on its tint. Context such as a Block name or a time sits
outside it as secondary text. Run and Block work states use the canonical labels **Working**
(cyan), **Waiting** (indigo), **Needs input** (amber, never Waiting's indigo), **Problem** (red),
**Finished** (green) and **Stopped** (neutral). Settings, field and list states use the Success,
Attention, Error, Neutral, Checking and Info kinds with their own label, such as Connected,
Installed, Not installed or Install failed; readiness reads **Ready** (Success) or **Not ready**
(Error). The glyph changes only where the meaning needs it: Unplug for Disconnected, a key for
authorization, a lock for Managed on the Factory host, a dashed circle for Not installed.

A field that shows a state tag sets `aria-invalid` and `aria-describedby` pointing at the one
message that explains it, as text next to the field or one card, never both. That message is a
`status` live region, or an `alert` for an error.

Every control needs a visible label or accessible name. Icon-only buttons also need a
tooltip. Preserve meaningful accessible names used by the UI verification journeys.
Unavailable choices in Agent execution settings stay visible and disabled, with their reason.
Long menus must stay within the viewport and scroll their choices without hiding search
or actions. Composer Flow and Project menus open downward from the field. Their height
is capped by the space below the field, and a scrolling list shows a visible scrollbar
and a bottom fade. Search is pinned and appears only when the menu lists more than
seven choices.

Use the shared key chip for shortcut hints. Each chord fits in one bordered chip in
Inter Medium at 11 px so glyphs such as ⇧ and ⌫ stay legible. On macOS, use
Apple modifier order (⌃⌥⇧⌘) followed by the key, as in ⌥⌘↑, ⇧⌘S, ⌘⌫ and ⌘↵.
Windows and Linux use Ctrl-plus notation such as Ctrl+Alt+N. Show an unassigned
binding as muted **Unbound** text in shortcut lists.

Settings sections share a title, an optional status badge, a host-management badge
where applicable, and trailing page actions. Labelled cards group settings and
read-only facts in rows. On/off settings use a switch named by the row title.
The content pane scrolls with a visible scrollbar and fades at the bottom
while more content follows.

Agent reporting shows the configuration home on the row to identify it.

Use **Refresh** to fetch the latest list or snapshot, **Check again** to repeat
a diagnostic check, and **Try again** to retry a failed read or operation.
In Settings, put the primary recovery action in the page header when the page read or check fails.

Confirmations and forms open in a centred dialog over a dimmed backdrop, with a
stronger scrim and a visible modal shadow in Light mode. The header shows the title, Esc key chip and close
button. Use at most one short introductory sentence in the body. Place any actions
at the trailing edge, with Cancel or Keep editing before the primary or destructive
action. Use 20 px of padding and a maximum height of 85vh. The body scrolls between
the header and actions. The standard width is `clamp(440px, 33.333vw, 560px)`.
Compare latest revision, Review and enable, and Import use the wide width
`clamp(560px, 60vw, 960px)`. Below 640 px wide, both use the viewport width minus
32 px.

A primary action with a blank required name stays neutral and disabled, with no reason and without
marking the field invalid. Any other cause that keeps it from running shows that one reason beside
the action. The control stays neutral while disabled and uses the filled primary only when it can
run. **Create Flow**, **Import**, and Agent **Save** / **Create Agent** follow it. Flow editor
**Save Flow** keeps the filled primary while disabled until that editor is revised; the same rule
still describes when it may run.

Save is the only filled primary action in Studio editors. The Trigger form's **Review and enable**
is the exception. The Flow and Agent editors place Save in the header. The Trigger form keeps its
actions in a pinned footer because its fields scroll.

Studio and Settings stay centred over the mounted Run shell, whose hidden content
is inert. Studio fills the window with a 16 px inset on every side at all viewport
sizes (`100vw − 32px` by `100vh − 32px`).
Settings uses `clamp(840px, 50vw, 1280px)` by
`clamp(560px, 80vh, 960px)` at sizes of at least 1024 × 720 px. Below either
Settings threshold, it fills the window with a 16 px inset on every side.
Unsaved-change guards and keyboard behavior are specified in
[Studio](studio.md) and [Keyboard shortcuts](keyboard-shortcuts.md).

Canvas blocks, ports and wires use the same tokens as the rest of the UI. Block rows and
ports are sized from the canvas surface's block dimensions, not with height, size or offset
utilities in block markup, so drawn blocks, wires, fit and Auto-arrange share one geometry.
State indicators and attention remain distinct. The execution canvas is read-only; its local
arrangement and viewport never mutate the Run's captured Flow revision. Product behavior is
defined in [Flow authoring](studio.md#canvas-and-block-configuration) and
[Runs](runs.md#execution-canvas).

### Which component for which pattern

Screens are assembled from these shared components. When a screen needs a pattern none of them
covers, extend the owning component or add a new one here (and on the Figma 🧩 Components page)
first, then use it; a one-off styled at the call site becomes the next consistency review.

- **State tag**: StatusBadge, with the Run kinds or the Setting kinds above.
- **Problem, notice or explanation**: ProblemCard, one card per issue with its next step. Its
  tones are the Setting kinds Error, Attention, Info and Neutral, so a field tag and its card
  agree; an Error card is an `alert`, the others are `status`. Default density is the Settings
  and Studio card; compact is the composer, Run page and dialog card. The next step is one
  TextLink: an action, or a chevron link to Settings or Studio, or an external link to T3.
- **Text link**: TextLink, for inline links and link-style actions. Its Link tone uses `--link`;
  Neutral keeps secondary text and turns primary on hover and focus. A trailing chevron moves
  forward in the app; the external ↗ leaves it or opens T3. It underlines on hover only, shows
  the `--ring` outline on keyboard focus, and a disabled action is at 50% opacity. In-app routes
  wrap AppLink, which stays the typed-route link; external links open in a new tab; actions are
  buttons.
- **Raw facts**: Technical details, closed by default with **Copy details**, as labelled rows
  or one raw error. Other closed secondary facts use the same disclosure.
- **Field state**: the shared field-state helper sets `aria-invalid` and `aria-describedby` from
  the explaining card's id, and the Attention border.
- **Shortcut hint**: the key chip.
- **Dialog**: the shared dialog in its standard or wide size, with the shared header.
- **Settings page**: the Settings page template of header, groups, rows and detail rows.
- **Studio list**: the Studio list header (title, count, search, Import/New) and its rows.
- **Choice**: ChoiceMenu where choices carry descriptions, badges or disabled reasons;
  NativeSelect for a plain list of values; SegmentedChoice for a short exclusive choice that
  stays visible.
- **Agent-written text**: AgentTextPreview, the clamped Markdown preview with its read link and
  the shared reader, in its result or Needs input size; AgentTextReader when a card opens the
  reader without a preview. Human-written text and Factory messages stay plain text.
- **Way out to T3**: OpenInT3, the "Open in T3 ↗" TextLink; its filled button form is only for
  an Attention card whose action is going to T3.
- **Stored secret**: SecretField, with Stored, Replace and Remove; a blank field never clears it.
- **Times**: the shared time formats: a wall clock (`20:31`), day and time (`today 20:31`),
  relative age (`just now`, `12 min ago`; `12m` in the sidebar), `Edited yesterday`, and the
  full local date and time for tooltips and accessible names.
- **Canvas**: the canvas surface, which owns block geometry, ports, wires and the dot grid for
  both the Flow editor and the execution canvas.

## Changing the design system

Use Tailwind utilities and semantic token names such as `bg-card`,
`text-muted-foreground` and `border-border-strong`. Do not add raw color values or a new
stylesheet to style an individual feature. Merge caller classes with the existing `cn()`
helper and accept `className` where the primitive supports it.

Define new semantic tokens in `apps/frontend/src/styles.css` with a value in both the Dark
`:root` block and the Light block, and expose them through `@theme inline`. A new color token
also joins the contracts' appearance token list and needs a T3 mapping, so inherited palettes keep
covering every color. Check new colors in both modes. Keep their purpose clear; exact values and component variants belong in that
source rather than a second documentation inventory.

When a required primitive is missing, add it from `apps/frontend` with
`pnpm dlx shadcn@4.21.5 add <name>`. Review generated imports and pin any new dependencies
exactly; do not accept unrelated packages. Retain only the exports actually used.
Run the [quality gate](quality-gates.md) and the relevant
[UI verification](testing.md#ui-verification) for visual or interaction changes.
