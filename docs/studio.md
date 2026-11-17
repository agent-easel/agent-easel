# Studio

Studio is the modal authoring surface for global Flows, reusable Agent definitions and the [Triggers](#triggers) that start Flows automatically. It opens over the current Run or the Run composer and leaves that screen mounted, so closing it returns
there with its draft intact. Settings holds connection, Agent reporting and keyboard preferences and does not list Agents or Triggers.

## Shell

Studio is an almost full-window dialog with a Settings-style header (**Studio / Flows**, **Studio / Agents** or **Studio / Triggers**, an Escape hint and **Back to Runs**) and no logo. The desktop dialog leaves 48 px above
it for native window controls and 16 px elsewhere; browsers use 16 px margins (8 px when narrow). The 192 px sidebar (144 px narrow) has an **AUTHOR** group with **Flows** and **Agents**, each with its
definition count, and an **AUTOMATE** group with **Triggers**. Its count is the number of Triggers, or, in red, the number
in Error while any Trigger is ([Trigger attention](#trigger-attention)). Studio and Settings share a short opacity-only transition that reduced motion disables; the underlying sidebar title area stays mounted.

While Studio is open, its Flow, Agent and Trigger lists, the Agents' runtime summaries and saved-Flow usage
counts, the sidebar counts and the Flow editor's Agent library follow every committed create, save,
duplicate, removal and import live, whichever client or Factory MCP made it, and each Trigger's checks, with no navigation or
retry. A failed subscription shows the list's error until the automatic retry succeeds. Both editors read their definition from these lists and follow its
saved revisions ([Following saved revisions](#following-saved-revisions)).

The current Flow draft survives navigation to the lists and Agents and keeps following its saved revisions while hidden; closing Studio or opening another Flow with unsaved changes asks to **Keep editing** or **Discard changes** (browser Back follows the same
rule; reload uses the browser's leave warning). Agent edits are guarded independently of a retained Flow draft.

| Destination | Browser URL |
| --- | --- |
| Flow list | `/studio/flows` (`/studio` and `/flows` also open it) |
| Opened Flow | `/studio/flows/:flowId` (`/flows/:flowId`) |
| Agent list | `/studio/agents` (`/settings/agents`) |
| Opened or new Agent | `/studio/agents/:agentId` (`new` creates; `/settings/agents/:agentId`) |
| Trigger list | `/studio/triggers` |
| New Trigger type picker | `/studio/triggers/new` |
| New GitHub Issues Trigger | `/studio/triggers/new/github-issues` |
| Opened Trigger | `/studio/triggers/:triggerId` |

The Flow editor's **Start Run** leaves Studio and opens a fresh composition with that Flow selected; unfinished Run drafts stay saved. Direct Studio links remember the last Run or composer and restore it on close, also when browser storage is
unavailable; a fresh session opens `/runs/new`. `/settings` and `/settings/connection` open the connection dialog and `/settings/skills` redirects to `/studio/flows`. Routing is described in
[Application foundation](foundation.md#ui-routes).

## Keyboard shortcuts

The [keyboard shortcuts](keyboard-shortcuts.md) topic is the authoritative reference for
platform defaults, customization, migration and every registry command. Canvas zoom keys
are listed there under **Canvas**; defaults can be changed in **Settings → Keyboard
shortcuts**.

While Studio or Settings is open, the Run composer and detail underneath are **inert**.
Run actions, sidebar navigation and the cheat sheet are blocked. Settings, New Run and
Studio shortcuts remain available through the existing unsaved-change guards; nested
dialogs and menus block them. **Mod+/** opens the read-only shortcuts cheat
sheet from the same registry grouping as Settings. Escape closes only the topmost layer
(palette, nested dialogs, block configuration, then Studio). Switching from a dirty Flow
by shortcut or palette uses the same Keep editing / Discard changes guard; opening
Settings from a clean Studio closes Studio. Palette navigation stays available while
catalogs load or fail (errors name the section).

## Following saved revisions

The Agent editor and the Flow editor follow their open definition's saved revisions by the same
rules; each editor's differences are listed with it ([Agent definitions](#agent-definitions),
[Saving and readiness](#saving-and-readiness)). Unsaved changes are the difference from the saved
revision's content, so editing back to it leaves none.

**Saved elsewhere.** When another client, tab or Factory MCP saves a newer revision, an editor
without unsaved changes switches to it and briefly shows **Updated to revision N**, which an edit
ends at once. An editor with unsaved changes keeps them and the revision they are based on,
and shows **Revision N was saved elsewhere**, naming the newest revision, until it is resolved; a
later revision replaces N and Save stays disabled meanwhile. The editor follows only Studio's
synchronized lists.
A save refused because Factory already holds a newer revision that Studio had not delivered yet
appends nothing, keeps the local work and raises the same notice.

**Compare, load or keep.** **Compare latest revision** clears the error shown and places the local
draft and saved revision N side by side as read-only text. When Studio does not hold N yet, as
after a refused save, the comparison opens once it arrives; if the list fails to load meanwhile,
the editor says **Could not load the latest revision. Try again.** From the comparison, loading N
discards the edits, while keeping the draft against N sends nothing and leaves it unsaved against
N: keeping requires another explicit Save, which writes it as N+1 and can conflict again. Both act
only on the revision shown: when N+1 arrives the comparison moves to it, an action for an older
revision does nothing, and a removal dismisses the comparison. There is no merge, field-level diff
or silent overwrite.

**Own saves.** The editor's own saves never raise **saved elsewhere**, whether the save's reply or
its delivery arrives first. Deliveries during a pending save wait for its reply, and a higher
revision than the reply's is then treated as saved elsewhere. A rejected save keeps the draft and
its baseline and shows its error beside any newer-revision notice. A save refused before sending
because Factory is offline says that nothing was sent; when the connection is lost after sending,
the editor shows **Save outcome unknown**. Either way the draft is kept and nothing is retried. An
unknown save whose content later arrives as a new revision is recognised as the editor's own: a
draft still holding that content becomes clean at it, and later edits stay unsaved against it.

**Removed elsewhere.** A removal is noticed only after a synchronized list showed the definition,
so a definition just created or duplicated is not treated as removed before Studio delivers it.
It is shown at once, also while a save is pending, and wins over that save's late reply. The
editable draft is kept, the comparison is dismissed and the save error is cleared. The delivery of
the editor's own submitted removal is not a removal elsewhere. Each editor's removed-elsewhere
notice and recovery are described with it.

## Agent definitions

Open **Studio → Agents** (`/studio/agents`) to create, edit or duplicate reusable definitions; an existing one opens at `/studio/agents/:agentId` and a new one at `/studio/agents/new`. A
definition stores a name, plain-text prompt, optional execution settings (T3 environment, provider, model and thinking options) and its exits. There is no runtime-mode, permission or tools field: T3 chooses launch
defaults. Definitions are global and Runs supply project context.

**Exits.** An Agent declares the exits its worker can finish with, managed in a compact table under the Prompt: **Name**, **Description**, **Message required** and a remove action. **+ Add exit** adds a row; **Save** stores the edited exits in a new Agent revision. Each exit has a stable ID; names
are distinct and non-empty. A new Agent starts with one exit, `done`, which needs no message. Every Flow block of the Agent offers its current exits, so an exit edit reaches open Flow editors through Studio's saved definitions without changing their graphs, while a Run keeps the exits of the Agent revision it captured. Renaming an exit keeps its ID and therefore every wire; removing a wired exit makes those Flows not ready and disables **Start Run** in their editors (see
[Saving and readiness](#saving-and-readiness)). Agents saved before Agent exits existed have none: their blocks kept their former exits as Flow-local exits.

A persistent 300 px list sits beside the editor with **Search Agents**, **Import** (see [Import](#import)), **+ Add agent**, runtime summaries and counts of distinct saved Flows using each Agent (excluding Runs and unsaved
drafts); narrow screens stack list and editor. The header shows name, revision, **Duplicate…**, **Export** (after the first save; see [Definition export](#definition-export)), **Delete** and **Save** (**Create Agent** for a new one). Leaving an edited Agent asks to **Keep
editing** or **Discard changes**; a retained Flow draft keeps its own guard.

**Worker settings.** Studio exposes one **Worker** execution selection: choose the environment first, then provider, model and thinking options from live T3 capabilities
(`orchestrator_capabilities`) for that environment, never a Factory allowlist. When T3 is unavailable saved settings stay visible as unknown or unavailable and nothing is substituted.
Availability is separate from verified execution support. A provider without Factory reporting support ([Reporting installation](t3-integration.md#reporting-installation) lists the drivers that have it) stays in the provider menu
as a disabled choice marked **No Factory reporting yet**, with the reason under it, so it cannot be chosen; a saved Agent that already uses one keeps it visible with that mark. New Agents default to the first provider with reporting support; when T3 offers none, no provider is preselected. Saved settings always carry their thinking-option list, empty when none is chosen; malformed lists are rejected. Factory launches each Block worker with these saved settings
([Run execution](runner.md#current-execution-contract)); the API's `execution` field holds the worker settings. Agent reads return the saved settings without contacting T3; Studio judges their availability against the capabilities it loads.

The Worker is optional. **Clear** empties the selection, and a save whose environment, provider or model is not chosen stores
no execution settings rather than a partial one, so an Agent can be saved before T3 offers a supported provider. Such an
Agent shows [**Needs a model**](../GLOSSARY.md#needs-a-model) in the Agent list, in the block library, on the block
inspector's worker line (which links to the Agent) and as a neutral tag on its Flow canvas blocks, never presented as an
execution state; its Worker section asks for an environment, provider and model, it opens
with nothing preselected and Duplicate keeps it model-less. **Needs a model** is distinct from the Unavailable and Unknown
states of a saved selection. Every Flow that places such an Agent is not ready (`agent_model_required`, one issue per block,
"{block}: {agent} needs a model."), so a Run never starts with it; choosing a model in the Agent editor makes those Flows
ready without saving them again. In the API `execution` is
`null`; create and save require the `execution` key, as complete settings (`environmentId`, `providerInstanceId`, `modelId`
and a `modelOptions` list) or an explicit `null`, so an omitted key or a partial object, including one without
`modelOptions`, is a validation error. A `null` execution skips the reporting-support check.

The list and editor also show the provider's [reporting installation status](t3-integration.md#agent-reporting).
The editor follows the current provider choice, explains installation problems and links to **Settings → Agent reporting**.
Installed configuration does not establish full execution readiness or live report visibility; Start still checks those gates.

**Saving.** Each accepted create or save appends one immutable Agent revision holding the name, prompt, settings and exits; a stale or invalid save returns an error,
appends nothing and keeps local edits. Duplicate creates a variant with a new identity from the saved revision, so save edits first. Create and save bodies may be up to 2 MB, enough for a 120,000-character prompt.
A save response arriving after leaving refreshes the list without reopening the editor. Mention skills directly in the prompt (for example `$review-code`); there is no skill field or interpolation.

**Revisions saved elsewhere.** An open Agent editor reads its Agent from Studio's saved definitions instead of loading it once and follows the
[shared revision rules](#following-saved-revisions). Its comparison shows name, worker settings, exits and prompt as two read-only blocks, with **Loading the latest
revision…** while it waits for the newest revision. **Load latest revision** asks for confirmation before discarding the edits; **Keep my edits against revision N** keeps
them. The confirmation names its revision like the comparison: when N+1 arrives it closes, and a removal dismisses it. After an unknown **Create Agent**, which would create a
second Agent if repeated, Create stays disabled until **I checked the Agent list** is pressed. The new-Agent form ignores other Agents' changes; after its Create, or after
**Duplicate…**, the opened Agent follows these rules even before Studio has delivered it.

A Create or Duplicate answer bridges only the wait for its first appearance in Studio's current
lists. After that appearance, reopening its URL uses the saved lists; an old answer cannot reopen
a definition removed elsewhere.

**Removing.** **Delete** confirms by name and removes the Agent from Studio, Flow references and Start selection with no restore; its saved revisions are kept and later saves to it are rejected. It
rejects Agents placed in the latest revision of any current Flow; the backend checks those blocks at removal time even if the usage count is stale, while removed Flows and Runs never block
removal. An unsaved Flow draft may still reference a removed Agent and needs repair before running. Runs keep the Agent revision they started with, and removing an absent or removed Agent succeeds.
Factory MCP's [`factory_remove_agent`](t3-integration.md#authoring-tools) performs the same removal; open Studio lists drop it at once.


**Removed elsewhere.** If an Agent already open in Studio is removed by another client, its URL and
editable draft stay open, even when the draft was clean. A persistent **This Agent was removed
elsewhere. Your draft is kept.** notice replaces revision notices. Save, Duplicate and Delete are
disabled with an explanation, and their handlers refuse further writes. An unsubmitted Delete
confirmation closes; an already submitted Delete completes normally through the idempotent removal
and returns to the list without another discard prompt. Saves that reach a removed Agent are still
rejected by the backend and never recreate it.

**Copy as JSON** recovers the current name, prompt, execution settings and exits, including unfinished
edits, in the create API's shape without identity, revision or status fields. Studio confirms a
successful clipboard write; if clipboard access fails, a read-only selectable JSON box remains
available. Leaving or closing Studio asks **This Agent was removed elsewhere. Discard the retained
draft?** with **Keep editing** and **Discard**, even for a clean draft. A hidden Flow draft keeps its
independent guard, and a decision discarding both drafts names both. Ordinary unsaved-change prompts
stay unchanged; browser close and reload use only the browser's standard warning. A fresh link to
an absent Agent shows **Agent not found** and **Back to list**; a failed read instead offers Retry.

See [T3 integration](t3-integration.md) for authorization and capability reads.

## Flow authoring

Open **Studio → Flows** (`/studio/flows`), choose **New Flow** (or **Import**, see [Import](#import)) and save a name; the editor opens at `/studio/flows/:flowId`. All Flows are global: project selection never
filters or assigns them, and no connection or project is needed to author. Block and exit IDs, positions, graph, name and revision persist across restarts.

Factory installs no built-in Flow and assumes no development process: the blocks, exits and wires you connect are the
whole process. For example, a bounded review loop wires a reviewer Agent's changes-requested exit to a Condition whose
rule **From arrival 3 onward** leads to a Human step and whose Otherwise returns to the implementing Agent, so the third
request for changes escalates to you instead of looping again ([Condition](#canvas-and-block-configuration)).

### Canvas and block configuration

The editor has a block library on the left (**Human step**, **Wait**, **Continuation**, **Condition** and saved Agent definitions; **Search Agents**, **Collapse**/**Expand library**) and the canvas. Add a block with the row's
**Add** action or drag the row onto the canvas (a ghost shows the drop position; dropping elsewhere adds nothing); undropped additions fill a three-column grid right of the Flow
input and are selected. Drag a block's header or edit its X/Y fields; wires follow live and the draft changes once, on drop. Escape cancels any drag.

Selecting a block (click, or focus + Enter) opens **Block configuration**, a panel floating over the canvas's right edge. It renames the block, chooses its saved Agent, lists its exits
read-only and links to the Agent definition. Prompts, execution settings and exits belong to the Agent, and two blocks may share a definition. Besides Flow-local and hidden exits, a block's
one override is its optional [Revisit instruction](../GLOSSARY.md#revisit-instruction): two blocks sharing a reviewer Agent can play different loop roles, such as a single check and a
correction loop, without duplicating the Agent and letting the copies drift apart. It is deliberately narrow: there is no first-visit block prompt and no execution, model or exit-definition
override, so any other variant is a new or duplicated Agent. Clicking empty canvas, **Close block configuration** or Escape closes the panel. Blocks show kind, Agent, an input port and one port per exit, each marked **Agent**,
**local** or **fixed** and with **message** when it requires one; wires carry `exit → recipient` labels in one neutral style, and multiple incoming connections each anchor to their own
input port (Flow input first, at least 18 px apart).

An Agent block's panel always shows the optional **Revisit instruction** plain-text field, edited like a Continuation's prompt (up to 120,000 characters; surrounding whitespace is
dropped on save, and whitespace alone saves as empty). The field never cuts input short: longer text stays in the draft and Save reports the error at the block's field. Its helper text says it is sent on every visit to the block after the first, with the incoming message; the Agent prompt still applies;
and the instruction decides that visit's scope but never waives the Agent's criteria, a required check or a defect with evidence. Edits are unsaved draft changes like any other. A block with a
non-empty instruction shows a small neutral **Revisit instruction** tag in its canvas header, never the text and never styled as an execution state. New Agent blocks start empty, and swapping
the block's Agent or copying the Flow's graph keeps the value. Delivery is described in the [Runner](runner.md#revisit-instructions).

A **Continuation** block is configured with only a name and a required **Prompt**; it has no Agent, settings or exits to configure. Its canvas block reads
**continues *Agent*'s thread**, naming the nearest Agent on its incoming paths (walking back through Human steps, Waits, Conditions and Continuations), or **the incoming Agent's thread** when
several Agents can reach it. It has one unnamed output port, and wires from it carry no exit label. Its panel explains the single output and the once-per-Run rule: the first
message sends the prompt to that conversation and waits for its response, messages arriving meanwhile wait, and every later message passes through unchanged
([Runs](runs.md#continuations)). Returning to the Agent's conversation is shown as this text, not as an extra wire.

Every Flow has one **Flow input block** (**FLOW INPUT** / **Flow input** / **Run prompt**) at the top left: one output port, no input, exits or configuration, and it cannot be removed. The
Agent blocks it connects to start a Run, each with the same prompt in its own session; no block is marked "entry".

**Connections.** Drag from an exit's output port (right edge dot) onto any block, including earlier blocks and the source itself; an exit may connect to many recipients (independent
fan-out; there are no Join or End blocks). A dashed preview snaps to the highlighted target's input port and the draft changes once on a valid drop; dropping on empty canvas, the port
itself, an already connected block or pressing Escape changes nothing. Drag from the Flow input port (**Connect Flow input**) the same way; only Agent blocks are valid targets, not Human steps or Continuations. Ports
take no keyboard focus. Click a wire or its label to select it (the block panel closes); each wire is also a keyboard button (**Connection *exit* from *source* to *target***). With a
connection selected, Delete/Backspace (outside form controls) or the **Delete connection** button removes it. Removing a block or exit removes its connections.

**Exits.** An Agent block offers its Agent's exits, minus those hidden in this Flow, followed by its Flow-local exits; inherited exits cannot be edited in a Flow. Hiding exits and adding
Flow-local exits are stored with the Flow revision. **Exits from Agent** shows read-only names, descriptions and message requirements, with **Hide in this Flow** / **Show in this Flow**.
Hidden rows remain visible in the panel but are absent from worker choices and cannot start new connections; they still reserve their names and IDs against local exits. Hiding a wired exit preserves its connection and reports a readiness issue until the exit is shown or the wire removed.
Wired hidden or removed exits keep a separate, unavailable canvas endpoint marked **Agent · hidden** or **Agent · removed**, so their wires never appear to leave a usable exit.
Agent blocks resolve against Studio's saved Agents as they arrive: an Agent saved or removed elsewhere updates block Agent names, exit ports and the missing-Agent state at once, without
changing the draft or its unsaved state, block positions or the view. A wire from an exit the Agent no longer has stays as such a broken wire; Studio never repairs the graph or deletes a connection.
**Local exits · only in this Flow** offers editable name, description and message-required cards and **Add local exit**. Removing a local exit removes its connections.
Flows upgraded from per-block exits show those exits as local. A Human step has the fixed, locked
exits **Approve** (message optional) and **Request changes** (message required). An unconnected exit ends that branch.

**Wait.** A Wait holds each arrival for a fixed duration, then passes its message on unchanged. Its panel sets the
Flow-local name and **Wait for** a number of **minutes**, **hours** or **days**, such as 1.5 hours; an empty amount saves a draft without
a duration. It has one input and one unnamed output (**after the wait**) whose **Output** section lists the recipients or
**finish here**. A Wait has no Agent, prompt, execution settings, reports or worker, and the Flow input cannot connect to
it.

**Condition.** A Condition routes each arrival by its arrival number at that block: an ordered list of rules
**From arrival *N* onward → *output***, each with its own stably identified, named output, followed by the fixed, mandatory
**Otherwise** output, which cannot be renamed, removed or reordered. The first rule the arrival number reaches selects its
output; when none does, Otherwise is selected, as the normal route rather than an error. A Condition with no rules passes every
arrival on through Otherwise, and a new Condition from the library starts that way, ready. A Condition has no Agent, prompt,
execution settings, reports or worker, and the Flow input cannot connect to it. A Run routes through it as the [Runner](runner.md#condition-arrivals) describes.

Its panel explains **Arrival numbers**: every message reaching the Condition gets the next number in the Run, counted together over
all its incoming connections and starting at 1; rules are checked from the top and the first whose number is reached (≥, so it
applies from that arrival onward) selects its output; Otherwise is the normal route when none does; and the number counts arrivals,
not reviews or attempts, without resetting within the Run. **Add rule** appends a rule with a blank name and no arrival number. Each
rule row edits its output name and **From arrival** number and offers **Move rule up**, **Move rule down** and **Remove rule** as
keyboard buttons. Renaming or moving a rule keeps its output and wires; removing it removes its wires in the same edit. An empty
arrival number stays empty (none) rather than defaulting. An entry that is not a whole number from 1 to 9,007,199,254,740,991 is
shown as typed and marked invalid, never rounded or saved as another value: **Save Flow** and **Check readiness** stay unavailable
until it is corrected or cleared. **Otherwise** stays last with its recipients and cannot be renamed, moved or removed. The canvas
row of each output reads **from arrival *N* onward** with its name, and Otherwise **when no rule matches**. A Condition has no rule
quota of its own, so within the [2 MB definition limit](#validation) it may hold tens of thousands of rules: the panel renders only
the rule rows near its visible part as it scrolls, and the canvas draws a port for every wired rule, Otherwise and the first eight
unwired rules, so the block stays a usable size; a later unwired rule is connected after moving it up.

### Automatic layout and canvas view

**Auto-arrange** lays out the draft left to right (Flow input leftmost, correction edges returning left, including disconnected blocks and loops, with orthogonal routes) and fits the
result. Progress is shown; an error, the 15-second limit, an edit or a drag leaves the draft intact. Positions are draft changes persisted by **Save Flow**; routed wires are transient and recomputed
on load only when the saved positions can be preserved, so blocks never move on reload. Manual edits return to normal wire paths.

The canvas shares its view controls with the Run canvas: scale 20%–200%; **+**/**−** zoom around the viewport center and **0** fits (bare keys leave browser zoom alone; bindings in
[Keyboard shortcuts](keyboard-shortcuts.md)); pinch or **Mod**+wheel (Command on macOS, Control elsewhere) zooms at the pointer, including Safari pinch; plain scroll, arrow keys and dragging
empty canvas pan. Drag, drop and wire gestures follow the zoom level. The view fits on load and container resize but is preserved across edits, selection and a switch to a revision saved
elsewhere; explicit Fit reserves space for an open inspector. Zoom and pan never change saved positions. Such a switch closes a selection or **Block configuration** only when its block or wire
no longer exists.

### Workspace setting

The toolbar's **Workspace** control holds the Flow's [workspace setting](../GLOSSARY.md): **Project checkout** or **New worktree**, and for a
worktree its **Base**, either **Default branch** (the Project repository's `origin/HEAD`, such as `origin/main`; no branch name is assumed across projects) or **Custom ref** (a
branch, tag or commit such as `develop`). New Flows use a new worktree from the default branch; Flows saved before the setting existed keep the project checkout. A changed
setting is part of the unsaved draft: it clears readiness and is saved, compared on conflict and retained like the graph. Studio does not check the ref, because Flows
are global; Start resolves it against the selected Project ([Runs](runs.md#starting)).

### Saving and readiness

The editor header also offers **Export** (see [Definition export](#definition-export)).

**Save Flow** accepts structurally valid incomplete graphs, increments the revision and shows **Saved** separately from readiness. There is no autosave or undo/redo. **Check readiness**
validates the draft through the backend without saving and is cleared by any change, by a newer saved revision, by keeping the local draft against one, by a change to an Agent the draft
places, by the Flow's removal and while Studio's saved definitions are not synchronized, also while a switch to a newer revision waits; **Start Run** stays disabled while readiness is unknown. A check result applies only to the
content, baseline revision and placed Agent revisions it was requested for: an answer arriving after any of them changed, or resolved against Agent revisions Studio does not show yet, is
discarded. A clean draft shows the readiness Studio received with its saved revision and the Agents shown, also after a placed Agent changes. A draft with unsaved changes then shows
**Agents changed — check readiness again** and is not checked automatically. **Start Run** is enabled only by readiness for the graph and Agent revisions on screen. The summary sits at the canvas's top-left and its issue list can cover the Flow input until collapsed. Actionable
issues: a Flow input connected to no Agent, a missing Agent reference, block and local exit names, a block without exits, a local exit sharing a name or ID with any current Agent exit, including hidden exits (also when
the Agent adds that exit later), a wire from an exit hidden in this Flow or no longer on the Agent, a block whose Agent Needs a model, a Continuation without a prompt, a Condition rule row that cannot run or a loop through only Conditions and Continuations, and unreachable blocks. Each names the block, the exit and the problem, and selecting one
inspects its block; a Condition rule issue also scrolls to that rule and focuses its name or arrival number. These issues disable **Start Run**, never a save. **Graph ready** covers graph and saved-Agent requirements only; live connection, Agent settings availability, project and reporting installation
are separate Start gates ([Runs](runs.md)).

When another client, tab or Factory MCP saves the open Flow, the editor follows it by the [shared revision rules](#following-saved-revisions), also when the draft is hidden while
Agents are shown. A clean draft's switch to the newer revision waits while a block or library item is dragged, a wire is drawn, Auto-arrange runs or a draft field has focus or text
composition, and happens afterwards only if the draft is still clean; a draft with unsaved changes names the newer revision at once. **Compare latest revision** shows both drafts as JSON:
**Use latest saved Flow** discards local changes, and **Keep local draft against revision N** keeps them for another explicit **Save Flow** after reconciling any differences. A rejected save
lists Factory's validation issues under its error; selecting one that names a block inspects it.

### Removing a Flow

**Remove** in Flow details removes the editable definition from Studio and the Run composer after a confirmation that names the Flow, says existing Runs remain and warns about unsaved changes. Success returns to
the Flow list, also when another view already removed it: removing an absent or removed Flow succeeds. Runs, their captured revisions, shared Agents and T3 threads are unaffected: active Runs continue, Run canvases show the revision each Run started with, and
removal is not Archive. Its saved revisions are kept, but there is no restore. Removal needs no revision match; a save that reaches a removed Flow errors, keeps the local draft visible for copying and never recreates it. New Runs cannot select a removed
Flow. Factory MCP's [`factory_remove_flow`](t3-integration.md#authoring-tools) performs the same removal; open Studio lists drop it at once.


**Removed elsewhere.** A Flow already opened in Studio keeps its URL and editable draft when another
client removes it, even if it was clean or an interaction is in progress. The persistent **This Flow
was removed elsewhere. Your draft is kept.** notice replaces revision notices and dismisses comparison
and unsubmitted Remove confirmations. Save Flow, Start Run, Check readiness and further Remove are
disabled with an explanation; their handlers also refuse these actions. An already submitted Remove
completes normally and returns to the list without another discard prompt. Removal wins over a late
save reply, and the retained draft stays editable while that reply is pending. The backend still
rejects saves and Starts targeting removed Flows and never recreates them.

**Copy as JSON** exports the current `{name, graph, workspace}`, including unfinished edits, block
and exit IDs, Agent references, connections and positions, without identity, revision or readiness.
Clipboard success is confirmed; clipboard failure shows the same bounded, selectable read-only JSON
fallback as the Agent editor. Its content follows further edits.

A retained removed Flow has a discard guard even when clean or hidden while viewing Agents or the
Flow list. Closing Studio or opening another Flow asks **This Flow was removed elsewhere. Discard
the retained draft?** with **Keep editing** and **Discard**. Keep editing returns to the hidden Flow
when it is the blocking draft. When both a Flow and an Agent block navigation, the dialog names both
and Keep editing preserves the current editor. Ordinary unsaved-change prompts stay unchanged;
browser close and reload use the standard browser warning. A fresh link to a missing Flow shows
**Flow not found** with **Back to list**; transport failures instead remain retryable.

## Triggers

**Studio → Triggers** (`/studio/triggers`) manages the [Triggers](../GLOSSARY.md#trigger) that start Flows for a
Project's GitHub issues. What a check reads, admits and starts, and the decisions behind it, are described in
[Starting from a Trigger](runs.md#starting-from-a-trigger). Approved clients have the same full management as the
host; readiness, review and checks always run on the Factory host with its `gh` login.

**List.** Each row shows the Trigger's name, its health (**Healthy** after a completed check without a problem,
**Error** while a problem stops every check, nothing before the first completed check), **GitHub Issues · Project →
Flow · schedule** (for example `every 5 min`, `every 2 hours` or `manual`), one line naming the problem while it is in
Error, an enable switch and a ⋯ menu with **Run** (only while enabled), **Edit** and **Remove**. Clicking the row opens
Edit. The list shows no prompt, issue list, check history, Off pill or active-Run counts. With no Triggers it explains
what a Trigger does and suggests running [`setup-factory`](installation.md#optional-skills) in the repository first.
Turning a switch on opens the [review](#reviewing-what-starts); turning it off saves at once.

**Creating.** **New Trigger** first asks for the type, at `/studio/triggers/new`. GitHub Issues is the only one, and its
card shows whether `gh` on the Factory host is found and signed in, and as whom; there are no placeholders for other
kinds, and a Trigger's kind never changes. The create form has:

- **Name**, unique among current Triggers regardless of case, so a removed Trigger's name can be reused.
- **Project**, which must be local to the Factory host. Factory detects the Project's GitHub repository through `gh`
  and shows it as **Detected**; saving confirms it. A Trigger never reads another repository. When an opened
  Trigger's Project folder later names a different repository, its checks stop with a repository mismatch and the
  form shows that repository as **Detected now** with **Confirm this repository**. Confirming changes the draft's
  repository, which widens what can start, so saving it goes through the review and **Apply and check**. Factory
  accepts a changed repository only while it is the one the Project's folder names at save time.
- **GitHub issue query**, prefilled `label:factory:ready author:@me`. It must contain exactly one positive `label:`
  qualifier, shown below the field as the [ready label](../GLOSSARY.md#ready-label) that the worker removes when it
  claims the issue, together with the login `@me` resolves to right now. Save refuses a query without exactly one
  usable label, with a comma list, negation or `no:label` as the ready label, with OR or parentheses around it, or with a
  scope qualifier (`repo:`, `org:`, `user:`, `is:`, `state:`, `type:`, `project:`); Factory always adds the
  repository, issue type and open state. A query GitHub rejects also blocks saving. Removing the author filter on a
  public repository warns rather than refuses.
- **Flow**; every Start uses its current saved revision, like New Run.
- **Run on a schedule**, with a number and minutes or hours (1 minute to 24 hours, default every 5 minutes). When off,
  the Trigger checks only when **Run** is chosen.
- **Max active Runs**, 1 to 10, default 1.

A readiness list, shown only while creating, checks `gh` (found and signed in), the repository (readable and matching
the Project's remote) and the Flow (passing Start's preflight). **Save disabled** saves the Trigger off; **Review and
enable** saves it after the review. Saving also warns when another Trigger already watches the same repository. A new
Trigger is always saved disabled first and enabled only through the review.

**Editing.** An opened Trigger shows the same fields under a **status strip** and has no readiness list. The strip
shows the health and either the latest check (when it ran, how many Runs it started, how many issues are waiting for a
free slot, each issue that did not start with its key and reason, and when the next check is due, or that the Trigger
checks only on **Run** or is off) or the current problem: what cannot be used since when and for how many checks, its
repair guidance and a **Run** button to check again. Guidance names steps that must happen on the Factory host, such as
installing `gh`, `gh auth login` or restarting a Factory opened from Finder. A failing Trigger keeps checking and never
turns itself off. Factory keeps only this latest check and problem; there is no history.

Triggers follow the [saved-revision rules](#following-saved-revisions) of the other editors: **Updated to revision
N**, **Revision N was saved elsewhere** with **Compare latest revision**, **Load revision N** and **Keep my edits**, and
**This Trigger was removed elsewhere** with the edits kept but no longer savable. Leaving a Trigger with unsaved changes
asks to **Keep editing** or **Discard**, like an Agent. Enabling, disabling and checks do not change a Trigger's
revision.

### Reviewing what starts

Enabling a Trigger, and saving an edit that widens what an enabled Trigger can start, first opens a review: the matching
issues a check would start now, oldest first, each marked **Starts now** or **Waits** for a slot, issues the Trigger
already started left out, the query's author filter (or the warning that a public repository has none), and the problem
a check would hit instead, if any. Nothing starts before confirming. **Enable and check** enables the Trigger and runs
its first check at once; **Apply and check** saves the edit and checks. Each confirms exactly the settings the review
showed: the preview reports the saved revision it evaluated and enabling names that revision, refused if another
revision was saved meanwhile, in which case nothing is enabled and the review opens again on the current settings; an
edit saves against the revision it started from, so a revision saved elsewhere meanwhile refuses it as a conflict. While creating, the review also offers **Save
disabled**. A later saved revision of the Flow or its Agents applies to the next Start without another review, as in
New Run.

An edit widens what can start when it changes the Project or repository, the query or the Flow, or raises **Max active
Runs**. Renames, schedule changes, a lower limit, disabling and any edit of a disabled Trigger save without review;
enabling it later reviews the result. The review is enforced by the client, not the server: a server-side "reviewed"
flag would only repeat a claim every approved client can make, since each has full Trigger management, so the review is
a guard against mistakes rather than an authorization boundary.

### Removing a Trigger

**Remove** in a row's ⋯ menu asks for confirmation (Cancel has focus, and focus returns to the menu button). Removal
deletes the Trigger with its schedule, latest check and problem, and no Start is accepted afterwards, even from a check
already in progress. Runs it already started keep running and keep showing where they came from. A new Trigger, also
one reusing the name, starts again the issues that still carry its ready label.

### Trigger attention

While any Trigger is in Error, the **Triggers** item in Studio's sidebar shows the number in red, and the Studio entry
beside Settings in the Run sidebar shows a red dot with **N Triggers in Error** in its tooltip and accessible
description. A Trigger problem never creates a Run Problem or Needs input, a desktop notification or a Dock badge;
an issue that failed to start appears only in the status strip and leaves the Trigger Healthy.

### Trigger HTTP API

The Trigger screens use these routes, available to the host and every approved client with the protocol and mutation
headers described in [Run HTTP API](runs.md#run-http-api). Bodies carry typed Trigger fields only; unknown fields are
refused. There are no Factory MCP tools for Triggers.

| HTTP | Purpose |
| --- | --- |
| `GET /api/triggers/readiness?projectId=&flowId=` | Check `gh`, the Project's repository and the Flow |
| `GET /api/triggers` | List Triggers |
| `POST /api/triggers` | Create a Trigger, saved disabled |
| `GET /api/triggers/:id` | Read one Trigger |
| `PUT /api/triggers/:id` | Save settings against `expectedRevision` |
| `PUT /api/triggers/:id/enabled` | Disable, or enable the `reviewedRevision` a preview showed |
| `POST /api/triggers/:id/run` | Run one check now |
| `POST /api/triggers/preview` | Review what a new Trigger would start; starts and saves nothing |
| `POST /api/triggers/:id/preview` | Review what a Trigger, or an edit of it, would start; starts and saves nothing |
| `DELETE /api/triggers/:id` | Remove a Trigger |

## Definition export

**Export** in the Agent editor header downloads the Agent's latest saved revision, and **Export** in the Flow editor header downloads the
Flow's latest saved revision with the latest saved revision of every Agent its blocks use. The JSON file is named after the definition (for
example `code-reviewer.agent.json` or `reviewed-change.flow.json`); the desktop app saves the same file. A never-saved Agent cannot be exported;
a Flow is saved when it is created. With unsaved changes Studio first asks "Export the saved revision? Unsaved changes won't be included."
(**Export saved revision** / **Keep editing**); either way the editor and its draft are unchanged. `GET /api/agents/:id/export` and
`GET /api/flows/:id/export` answer `{document, driverKindOmitted}`.

Every export writes portable document format version 2, whatever the definition holds:

```json
{
  "format": "t3-factory/definitions",
  "formatVersion": 2,
  "kind": "agent",
  "factoryVersion": "0.42.0",
  "exportedAt": "2026-11-14T10:00:00.000Z",
  "agents": [
    {
      "key": "agent-1",
      "name": "Code reviewer",
      "prompt": "Review the change.",
      "model": {
        "driverKind": "codex",
        "providerInstanceId": "codex-main",
        "modelId": "gpt-6.1-sol",
        "modelOptions": [{ "id": "reasoning", "value": "high" }]
      },
      "exits": [{ "id": "done", "name": "done", "description": "", "messageRequired": false }]
    }
  ]
}
```

- `format`, `formatVersion` and `kind` identify the document; `factoryVersion` (`source` for a source checkout) and `exportedAt` are informational only.
- `agents` holds the bundled Agents; an Agent document holds exactly one. Each has a document-local `key` (`[A-Za-z][A-Za-z0-9_-]{0,63}`,
  unique in the document), so Agent and Flow documents share one Agent entry.
- `model` is the model hint: present exactly when the Agent has execution settings, otherwise `null`. It keeps the provider instance, model and
  thinking options whatever their availability, and never the environment. `driverKind` comes from the live T3 catalog; when T3 is disconnected
  or no longer lists the provider it is omitted, and Studio names the affected Agents.
- The file never contains environment ids, server or definition ids, revisions, definition timestamps or Runs. Exit ids are kept.

A Flow document has `kind: "flow"` and a `flow` beside `agents`:

```json
{
  "format": "t3-factory/definitions",
  "formatVersion": 2,
  "kind": "flow",
  "factoryVersion": "0.42.0",
  "exportedAt": "2026-11-14T10:00:00.000Z",
  "flow": {
    "name": "Reviewed change",
    "graph": {
      "blocks": [
        {
          "id": "review",
          "name": "Code review",
          "kind": "agent",
          "position": { "x": 240, "y": 0 },
          "agentKey": "agent-1",
          "hiddenExitIds": [],
          "localExits": [],
          "revisitInstruction": ""
        },
        {
          "id": "gate",
          "name": "Escalate",
          "kind": "condition",
          "position": { "x": 480, "y": 0 },
          "rules": [{ "id": "ask", "name": "Ask a person", "fromArrival": 3 }],
          "otherwise": { "id": "otherwise" }
        },
        { "id": "approve", "name": "Approve", "kind": "human", "position": { "x": 720, "y": 0 } }
      ],
      "connections": [
        { "sourceBlockId": "review", "exitId": "done", "targetBlockId": "gate" },
        { "sourceBlockId": "gate", "exitId": "ask", "targetBlockId": "approve" },
        { "sourceBlockId": "gate", "exitId": "otherwise", "targetBlockId": "review" }
      ],
      "flowInput": { "position": { "x": 0, "y": 0 }, "targetBlockIds": ["review"] }
    },
    "workspace": { "mode": "worktree", "base": { "kind": "default" } }
  },
  "agents": [
    {
      "key": "agent-1",
      "name": "Code reviewer",
      "prompt": "Review the change.",
      "model": null,
      "exits": [{ "id": "done", "name": "done", "description": "", "messageRequired": false }]
    }
  ]
}
```

- `flow` holds the Flow's name, saved graph and workspace setting: block and exit ids, positions, wires, hidden exits, Flow-local exits,
  Revisit instructions, Waits, Human steps, Continuations and Conditions with their rule ids, names and thresholds, exactly as saved. An
  unfinished draft keeps its gaps, such as a Wait without a duration or a rule with `"fromArrival": null`.
- Each distinct Agent the blocks use is bundled once, keyed `agent-1`, `agent-2`, … in the order the blocks first place it. An Agent block
  carries a required `agentKey` instead of a local Agent id: a bundled Agent's key, or `null` when the block has no Agent or its Agent is
  missing or removed. There is no fallback to local ids or names.

Export refuses, with the reason, a file another installation could not import: an Agent or Flow whose save request exceeds 2 MB, or a file
over 16 MiB.

**Format versions.** Import reads versions 1 and 2, each with its own strict reader. Version 2 is version 1 plus the Condition block; a
version-1 file holding a Condition is rejected at that block as an unknown block kind, as before. Files exported before version 2 import
unchanged. A newer version is refused and asks to update Factory. Writing version 2 for every export is an intentional compatibility break:
an installation that reads only version 1 (release 0.6.0 and earlier) refuses every newly exported file, even an ordinary Agent or a Flow
without a Condition, and asks to be updated before it can import it. Stored definitions, revisions and Run history are not affected.

### Import

**Import** on the Agents list and on the Flows list opens a chooser for a `.json` file; either list accepts either kind of file and the file decides
what is created. Studio sends the file's bytes to `POST /api/imports/review`, which validates it and writes nothing, then shows the review dialog:

- a trust notice: imported instructions (Agent prompts, and for a Flow file Continuation prompts and Revisit instructions) run with the user's T3
  capabilities when a Run that uses them starts, and importing does not start a Run;
- for a Flow file, the workspace in full: the project checkout, or a new worktree from the default branch or from the exact custom ref;
- the instruction inventory, never instruction text: each Agent's name, prompt length and exit count and, for a Flow file, each Continuation's
  block name and prompt length and each non-empty Revisit instruction's block name and length;
- one row per Agent labelled **Matched**, **Ambiguous** (naming the candidates), **Unmatched** or **No model in file**, with its model hint
  and the reason as text, and a picker of the live Worker catalog for the connected environment, limited to reporting-capable providers, with
  the chosen model's thinking options. A Matched row starts with the matched model, which can be kept, changed to any listed model or set to
  **Needs a model**; every other row starts as **Needs a model** with nothing preselected. The row lists the hint's options that the chosen
  model does not accept and recomputes them whenever the choice changes.

The review matches each hint against the connected environment's live catalog. Candidates are reporting-capable provider instances of the
hint's `driverKind` that offer its exact `modelId`. The candidate with the hint's `providerInstanceId` wins; otherwise a single candidate wins;
several candidates leave the Agent Ambiguous and none leaves it Unmatched. A hint without `driverKind` matches only a reporting-capable instance
with the same `providerInstanceId` and `modelId`, with no single-candidate fallback. Factory never matches across driver kinds or takes the
first listed candidate, and matches nothing while the catalog is unavailable. A match uses the connected environment's id and keeps the hint's
options the model accepts; the model's other options take their defaults and the hint's remaining options are dropped. Picking a model in the
review applies the same option rule.

Names, prompts, exits and the Flow's graph and workspace arrive exactly as exported; the review offers no other edits. **Cancel** writes nothing. **Confirm import** is always
enabled, also when some or every Agent needs a model, and also with T3 disconnected (the picker is then empty and every Agent is imported without a
model). Confirm sends `POST /api/imports` with the document, the reviewed selection per Agent key (complete settings or `null`) and a request id
the dialog generated for this import. The commit validates the document again, applies the ordinary Agent save rules to the selections and saves
exactly what was reviewed, without matching or changing options. It creates new Agents with new ids at revision 1 and their exported names and, for a
Flow file, the Flow at revision 1 with each `agentKey` replaced by the new Agent's id, all in one transaction. It never reuses or updates an
existing Agent or Flow and never starts a Run. A block whose `agentKey` is `null` arrives without an Agent, which readiness reports as a
missing Agent reference. The commit publishes the same live definition change as a create, so every open Studio lists the new
definitions. On success Studio opens the imported Flow, or the Agent of an Agent file, once its live lists hold it; an unrelated Flow draft with unsaved
changes still asks **Keep editing** / **Discard changes** first.

- If a chosen provider is listed by T3 but has lost Factory reporting support, the whole commit is refused, the affected Agents are named and
  their rows return to the review for another choice. A provider T3 does not list, including while the catalog is unavailable, never refuses a
  commit.
- Every Confirm in one dialog reuses its request id. When the answer is lost, Confirm again returns the original result instead of a copy; the
  same id with different content is refused as a conflict. Choosing a file again starts a new import, so two deliberate imports create two
  independent copies. See [import receipts](foundation.md#persistence-model).

Validation runs in order: the `format` marker and `formatVersion` first, then the Agent count, unknown or missing fields at every level, closed
references (well-formed, unique keys; an Agent file holds exactly one Agent; in a Flow file every `agentKey` is a bundled Agent's key or `null`
and every bundled Agent is used by a block), then the Agent and Flow validators and each definition's prospective save request against 2 MB.
The distinct rejections are:

- not JSON (the file is not UTF-8 JSON);
- not a Factory export (no `t3-factory/definitions` marker);
- unsupported format version N, which asks to update Factory when N is newer;
- an invalid definition, field-addressed (for example `agents.0.prompt` or `flow.graph.blocks.2.position`) and naming the Agent or block;
- over a limit, HTTP 413: an import request or file over 16 MiB, more than 500 bundled Agents, or a definition over 2 MB.
- not received completely (`document_unreadable`): the upload broke off before its body arrived. Only a body over the limit is reported as too large.

Every rejection writes nothing, never repeats prompt text and keeps the chosen file in the dialog for **Try again**.

## Validation contract

`PUT /api/flows/:id` and `POST /api/flows/validate` take
`{name, expectedRevision, graph, workspace}`. `workspace` is `{mode: "checkout"}` or
`{mode: "worktree", base: {kind: "default"} | {kind: "ref", ref}}`; a custom ref is trimmed and
must be 1–255 characters without whitespace, control characters or a leading `-`, and its
issues use `workspace.*` paths. A save that omits `workspace` keeps the saved setting.

`POST /api/flows` accepts a name and optional `graph` and `workspace`. Creation validates the supplied graph and workspace and stores them atomically as revision 1; a rejected creation leaves no Flow or revision. Without a graph it creates an empty Flow, and without a workspace it uses a new worktree from the default branch. Studio's **New Flow** sends only the name; [Factory MCP authoring tools](t3-integration.md#authoring-tools) can create a Flow with its graph and workspace in one call.

### Graph shape

Blocks have stable IDs, position and name. On create or save, positions are optional for every block and the Flow input. If any position is omitted, the backend arranges the whole graph with the same ELK layout as [Auto-arrange](#automatic-layout-and-canvas-view), replacing even the supplied positions. Fully positioned graphs are saved as given. Saved graphs always include all positions; Studio sends them all, so its saves preserve the draft's layout.

An Agent block adds `agentId`, `hiddenExitIds` (inherited exit IDs it hides), `localExits` and `revisitInstruction`, its
[Revisit instruction](../GLOSSARY.md#revisit-instruction): plain text up to 120,000 characters, optional on create and save, stored trimmed,
and empty when omitted or whitespace-only. Readiness never requires it or warns about it, even on a block that cannot be revisited. A Human block has
no exit fields. A Wait block adds `duration`: `{amount, unit}` with any finite number as `amount` and `unit` `minutes`,
`hours` or `days`, or `null` while the draft has none; a Continuation adds `prompt` (stored trimmed, up to 120,000 characters, empty only in a draft). Each has one fixed, unnamed exit with ID `output`. An exit is `{id, name, description, messageRequired}`, with IDs scoped to their block; runtime consumers enforce a non-empty message when
`messageRequired` is true. A Condition adds `rules`, an ordered array of `{id, name, fromArrival}`, and
`otherwise: {id: "otherwise"}`. A rule `name` is stored trimmed and may be blank in a draft; `fromArrival` is a whole number from 1 to
9,007,199,254,740,991, the largest integer JSON numbers and the stored definition hold exactly, or `null` while the draft has none. Its
outputs are the rules in order, then **Otherwise**; a rule ID is unique within the block and never `otherwise`. Connections identify source block, exit ID and target block: a Human block's exit is `approve` or `request-changes`, a Wait's or Continuation's is `output`, a Condition's is a rule ID or `otherwise`, and an Agent block's
exit is resolved against its Agent by readiness, not by the save. No block execution settings or prompt overrides are accepted.

#### Flow input block

Every graph carries exactly one `flowInput`: a canvas `position` and the `targetBlockIds` of the Agent blocks it feeds (each at most once). It has no work execution state; on a Run's [execution canvas](runs.md#execution-canvas) the Flow input card may carry the Run's [title generation](runs.md#run-title-generation) line, which describes the Run's title, not Block work, and Studio's Flow editor shows nothing of it. Targets are distinct Agent blocks; Human, Continuation and Condition targets are rejected. A Wait target saves but is a readiness gap (`flow_input_wait`): a Wait never starts a Run. Every path a Run can take into a Continuation or Condition therefore passes an Agent. A new Flow has no Flow input targets; removing a block also removes its target reference. Reachability starts at every Flow input target. Initial activations are independent, are not Handoffs and receive the same prompt; a failed or uncertain activation creates its own Problem while other branches can continue.

### Validation

Structural failures return `Result` errors with `code`, `path` and `message`: invalid or duplicate IDs and names,
positions, Flow input targets, dangling or duplicate edges, a Human or Wait connection from another exit, malformed exits, hide entries or Wait durations (an amount that is not a finite number, an unknown unit), and unknown block, exit, graph or Flow input fields, including Agent fields on a Wait. A Condition is refused, never coerced, rounded or reordered, for a threshold that is not a number, not whole, below 1 or beyond the largest exact integer (`invalid_condition_threshold`), a repeated rule ID or one equal to `otherwise` (`invalid_condition_rule_id`), a missing or altered Otherwise (`invalid_condition_otherwise`), extra rule fields and a wire from an output it does not have. A `revisitInstruction` that is not a string, is longer than 120,000 characters after trimming, or is on a block other than an Agent block is refused at that block's `revisitInstruction` path. Limits: 500 blocks, 100 local exits and 100 hide entries per block, 100 exits per Agent, 5000 connections, coordinates −10000 to 10000, bodies up to 2 MB.
A Condition has no rule or output quota of its own and does not borrow the Agent exit limit: it counts as one block, each actual wire
from any of its outputs, including fan-out and Otherwise wires, is one connection, unwired outputs cost nothing, and its rule IDs,
names and thresholds count toward the 2 MB body.

Unfinished names, unset Agents, an unconnected Flow input, blocks without exits, local exit name or ID collisions and wires from hidden or removed exits can be saved.
Readiness reports these gaps (`flow_input_required`: connect the Flow input to at least one Agent; `agent_model_required`; `continuation_prompt_required`; `exit_name_conflict`, `exit_id_conflict`, `exit_hidden`, `exit_missing`), a Wait
without a duration (`wait_duration_required`) or outside 1 minute to 7 days inclusive after converting its unit, including a zero or negative amount (`wait_duration_range`), a Wait Flow input target, missing saved
Agents, blocks unreachable from the Flow input,
a Condition rule without a name (`condition_rule_name_required`) or with the name of another of its outputs, Otherwise included
(`condition_rule_name_duplicate`), without a threshold (`condition_threshold_required`), never selected because an earlier rule
already matches from an equal or lower arrival (`condition_rule_shadowed`), or from arrival 1, which leaves Otherwise unreachable
(`condition_threshold_first_arrival`), each at its rule row, and every directed cycle through a Condition made only of Conditions
and Continuations, whichever outputs its wires leave by (`condition_cycle`, at the Condition, naming the cycle): a Continuation may
already pass messages straight through, so such a loop could circle without work. A ready Condition's thresholds therefore
strictly descend and are at least 2; one with only Otherwise is ready. Readiness resolves each block against the current saved Agents. Of an Agent's execution settings readiness learns only whether
they are present, never their live availability, so one Agent never reports both `agent_model_required` and the `settings_unavailable` Start gate. Hide entries for exits the Agent no longer has are ignored. A
terminal exit needs no edge; other cycles, including loops through an Agent, Human step or Wait and loops of Continuations alone, self-loops and independent fan-out are allowed. Graph readiness does not claim T3 capability or live execution readiness.

Readiness depends only on the graph and the saved revisions of the Agents it places, because an Agent's exits and former exit names are fixed per revision. Validating unsaved content
(`POST /api/flows/validate`, Studio's **Check readiness**) therefore also answers `agentRevisions`: the saved revision of each placed Agent by id, `null` for a missing one, against which that
readiness was resolved, so a client can compare it with the Agents it shows.

### Revisions

Each successful create or save appends one immutable Flow revision whose name, graph and
workspace setting are stored as rows owned by that revision; Studio reads the latest revision of each Flow that is
not removed, and `revision` is that revision's number. An update compares the expected revision
atomically: a stale or invalid request returns an error and appends nothing, and an accepted save
advances the revision exactly once. Within a revision, connections reference blocks of the same
revision, and the Flow input targets blocks of that revision.
Agent references are resolved against saved definitions at read time, so a draft may still name a
missing Agent. Stored shapes follow the
[stored-data migration rules](foundation.md#sql-migrations). Start references the current
revision and freezes the referenced Agents' revisions; Auto-arrange and input-port presentation do not change
validation semantics. [Removing a Flow](#removing-a-flow) keeps the revisions Runs reference.
