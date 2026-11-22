# Frontend design system

Factory uses shadcn/ui on Tailwind CSS v4 with one set of semantic tokens, each with a
Light and a Dark value. Reuse the existing primitives and token vocabulary; do not introduce
parallel stylesheets, global element styling or per-screen color palettes.

## Light and Dark

**Settings → Appearance** offers **System**, **Light** and **Dark**. System is the
default and follows the device's appearance while the client is open. Light and Dark
fix the effective mode to the selected appearance. The preference belongs to the client
and is available on every connection gate and while offline.
See [Desktop and approved clients](desktop-and-clients.md#appearance).

The effective Light or Dark mode is `data-appearance` on `<html>`. Every color token,
`color-scheme` (native controls and scrollbars), the `dark:` variant and the browser `theme-color` follow it, so a
change applies at once without a reload. Color transitions are suspended for that instant
so controls do not fade one by one. Light is its own baseline, not an inversion of Dark:
white canvases and zinc structure, primary actions at a darker indigo, and status colors at
darker shades of the same hue families so text and dots stay readable on light surfaces.
Typography, geometry, radii and motion are identical in both modes. Raw Run images, project
favicons and emoji keep their pixels. Forced-colors mode replaces Factory's colors with the
system palette in either mode; meaning stays carried by labels and icons.

### T3 theme colors

With [theme colors](t3-integration.md#theme-colors), every color token can come
from the T3 environment's default theme instead of the baseline, separately per mode.
The effective appearance picks the palette. A mode without an accepted T3 palette keeps
its baseline.
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
- Feature components take font sizes only from the type-scale tokens in
  `apps/frontend/src/styles.css`, never arbitrary sizes such as `text-[13px]`.
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
Compare latest revision, Review and enable, Import and the keyboard shortcuts
sheet use the wide width `clamp(560px, 60vw, 960px)`. Below 640 px wide, both use
the viewport width minus 32 px.

A primary action with a blank required name stays neutral and disabled, with no reason and without
marking the field invalid. Any other cause that keeps it from running shows that one reason beside
the action, including **Offline** while the client is offline and the action could otherwise run.
The control stays neutral while disabled and uses the filled primary only when it can run. **Create Flow**, **Import** and the Studio editors' **Save** / **Create Agent** follow it.

Save is the only filled primary action in Studio editors: filled only while there are unsaved
changes it may send, neutral and disabled while saved or blocked, and **Saving…** while saving.
In the Trigger form, **Review and enable** stays neutral beside Save. The Flow and Agent editors
place Save in the header. The Trigger form keeps its actions in a pinned footer because its fields scroll.

Studio and Settings stay centred over the mounted Run shell, whose hidden content
is inert. In a browser, Studio fills the window with a 16 px inset on every side at all viewport
sizes (`100vw − 32px` by `100vh − 32px`).
Settings uses `clamp(840px, 50vw, 1280px)` by
`clamp(560px, 80vh, 960px)` at sizes of at least 1024 × 720 px. Below either
Settings threshold, it fills the window with a 16 px inset on every side.
In the desktop app, a window-filling Studio or Settings starts below the 48 px title-bar
strip instead and keeps the 16 px inset at the sides and bottom; see
[native window appearance](desktop-and-clients.md#native-window-appearance).
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
- **Bordered container**: Surface, in one of four tones. Inset is content inside a panel or
  card; Group holds grouped rows, as in Settings, divided by borders and clipped; Raised is a
  card that stands on the page; Floating is a control or popup over the canvas, with the
  floating shadow. Surface owns the border, background, radius and shadow only; padding, gap,
  layout and content stay at the call site. A popover or other primitive that renders its own
  element takes Surface's classes instead of nesting a Surface.
- **Text link**: TextLink, for inline links and link-style actions. Its Link tone uses `--link`;
  Neutral keeps secondary text and turns primary on hover and focus. The optional trailing icon
  accepts any Lucide icon component. Common choices are `ChevronRight` for forward navigation in
  the app, `ExternalLink` for leaving the app or opening T3, and `Maximize2` for opening a reader.
  It underlines on hover only, shows the `--ring` outline on keyboard focus, and a disabled action
  is at 50% opacity. In-app routes wrap AppLink, which stays the typed-route link; external links
  open in a new tab; actions are buttons.
- **Navigation row**: NavRow, wrapping a typed AppLink with `asChild`. Compact rows are 32 px
  tall, for Settings, and can carry a status or attention marker; Regular rows are 34 px tall,
  for Studio, and can carry a trailing count. The selected row uses `bg-sidebar-accent`,
  primary text and `aria-current="page"`; unselected rows use secondary text and a hover fill.
  Both densities use the shared focus ring. The command palette, menus and library rows keep
  their own components.
- **Keyboard focus**: the shared focus ring, the `focus-ring` utility: 3 px of `--ring` at half
  opacity on keyboard focus. A field or bordered control adds the `--ring` border beside it; a
  surface or full-width row whose outer ring would be clipped adds the inset modifier. A
  deliberate destructive or attention tone and an invalid field override it; TextLink replaces
  it with its outline.
- **Raw facts**: Technical details, closed by default with **Copy details**, as labelled rows
  or one raw error. Other closed secondary facts use the same disclosure.
- **Field state**: the shared field-state helper sets `aria-invalid` and `aria-describedby` from
  the explaining card's id, and the Attention border.
- **Shortcut hint**: the key chip.
- **Dialog**: the shared dialog in its standard or wide size, with the shared header.
- **Settings page**: the Settings page template of header, groups, rows and detail rows.
- **Studio list**: the Studio list header (title, count, search, Import/New) and its rows.
- **Studio editor header**: StudioEditorHeader in three layouts. Toolbar is the Flow editor's
  52 px row above the canvas: owner, name, save status, controls, More actions, Save. Stacked is the
  Agent editor's title row (name, controls, More actions, Save) over one status line, with no owner
  because the list group beside it names the owner. Page is the Trigger editor's title with its
  controls at the right over its check status, with Save in the pinned footer. StudioSaveButton
  carries the Save rule wherever Save sits, including a pinned footer, and StudioSaveStatus shows
  the saved check or the unsaved dot.
- **Empty state**: EmptyState, always in a dashed frame. Large is for a whole list or preview
  that is empty, such as an empty Studio list or an unavailable image: a centred icon tile, the
  title, an optional body and an optional action; on a muted surface, such as Studio, the icon tile
  takes the accent fill, which every palette keeps distinct from muted. Compact is for a panel list
  that is empty for a reason worth explaining, such as a Run sidebar title search with no match: a
  left-aligned title and a short body. A one-line hint without an explanation stays plain status
  text, not an EmptyState: the sidebar's "No Runs yet", the command palette's "No matches", and
  list loading, no-match and error lines.
- **Choice**: ChoiceMenu for every dropdown choice, a select-only combobox named by its field, with
  or without groups, icons, descriptions, badges, disabled reasons and pinned search; long names
  wrap. A menu that combines a choice with actions or a submenu (the Project picker, the Flow
  workspace control) keeps its menu, and the app never shows a native OS select. SegmentedChoice
  for a short exclusive choice that stays visible; in a labelled row it fills the row in equal
  segments, as a Finish ending's Output.
- **Agent-written text**: AgentTextPreview, the clamped Markdown preview with its read link and
  the shared reader, in its result or Needs input size; AgentTextReader when a card opens the
  reader without a preview. Human-written text and Factory messages stay plain text.
- **Run result**: ResultSection (Figma Run/ResultSection), the Run overview's Result: the
  reached ending's name with the flag icon, its output, Output missing tag or neither, its From,
  By when the author differs from the worker, Worker when known, and At facts, the Stopping tag while the Run stops its workers, and No result yet
  or No result before a result. The Finish block's inspector shows the same output and facts.
- **Way out to T3**: OpenInT3, the "Open in T3 ↗" TextLink; its filled button form is only for
  an Attention card whose action is going to T3.
- **Stored secret**: SecretField, with Stored, Replace and Remove; a blank field never clears it.
  After its destination changes, a stored secret shows the Choose tag and adds Use stored key;
  Save waits for a choice, and Undo or Cancel return to it.
- **Times**: the shared time formats: a wall clock (`20:31`), day and time (`today 20:31`),
  relative age (`just now`, `12 min ago`; `12m` in the sidebar), `Edited yesterday`, and the
  full local date and time for tooltips and accessible names.
- **Full-window state**: GateScreen, the one screen before the application (connecting, access,
  incompatible versions, First-run setup), with the desktop titlebar and local application
  controls. Default is the narrow card with a large state icon; Wide is the First-run setup
  checklist card with the product name beside a small brand icon.
- **Setup step**: SetupStepHeader (Figma Setup/StepHeader) for each First-run setup step: a
  numbered indicator that is Current in the primary colour, Upcoming greyed out and Done as a
  success check, then the title and its one-sentence reason. The heading names the state, so it
  is announced without colour.
- **Setup harness**: HarnessRow (Figma Setup/HarnessRow) for one agent harness in First-run
  setup: the harness name, the configuration paths Factory writes, the installation's own message
  and its install status badge, as a group named after the harness. Rows sit in a grouped Surface.
- **Canvas**: the canvas surface, which owns block geometry, ports, wires and the dot grid for
  both the Flow editor and the execution canvas.
- **Finish block**: FinishBlock (Figma Studio/FinishBlock), drawn by the canvas surface like a
  block: the Flag kind icon, **FINISH**, **Finish** and its ending count, then one row per ending
  with its own input port on the left edge. Its state is the Flow editor's (an unconnected ending's
  name and port in the Error colour) or a Run's: neutral before an ending is reached, the reached
  row filled with **Reached · *time*** and **Not reached** on the others, or **No ending reached**.
  Without endings the editor shows its one hint row and a Run its header only.
- **Join block**: the Join card (Figma "Join card states"), drawn by the canvas surface
  like the Finish block: the Merge kind icon (Figma Icon/Merge, Lucide `Merge`, in brand cyan),
  **JOIN**, the name and **Join · *N* sources**, then one row per source block in the Flow's block
  order, each with its own input port on the left edge, and below a divider its one **output** row
  with its right port. In the Flow editor a source row reads ***N* exits**, the number of that
  block's exits wired in, and before any source is wired one hint row holds the port. Readiness
  marks the card with the Error edge and tag, the source ports when it has too few sources, and
  the output row and port when its output is unconnected. Run states are drawn on the same rows.
- **Subflow group**: SubflowGroup (Figma Canvas/SubflowGroup), drawn by the canvas surface for a
  placed Subflow block in Studio: a bordered group container holding a read-only in-place preview
  of the referenced Flow (inner Flow input labeled **Incoming message** wired to its targets,
  inner blocks and Finish, drawn-only ending routes to the outer right border, and interactive
  outer left/right ports), with a **Collapse** control in its header. Collapsed, cyclic,
  over-budget, missing or unset Subflows render as a compact block card with a footer carrying
  **Expand** (when expandable) or an error badge and **Open Flow**. In Runs the same group
  shows the captured Flow, invocation and queue evidence in its header and draws the inner Flow
  input, execution Blocks and Finish with their Run state.

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
