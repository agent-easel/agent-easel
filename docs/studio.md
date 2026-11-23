# Studio

Studio is the modal authoring surface for Flows and reusable Agent definitions, each global or owned by one Project ([Ownership](#ownership)), and the [Triggers](#triggers) that start Flows automatically. It opens over the current Run or the Run composer and leaves that screen mounted, so closing it returns
there with its draft intact. Settings holds connection, Agent reporting and keyboard preferences and does not list Agents or Triggers.

## Shell

Studio is a [full-window inset dialog](design-system.md#components-and-interaction) with a Settings-style header (**Studio / Flows**, **Studio / Agents** or **Studio / Triggers**, an Escape hint and **Back to Runs**) and no logo. On a list, Esc closes Studio. On an open Flow, Agent or Trigger, Esc returns to the page it came from: the Flow or Trigger it was opened from, otherwise its list (the Agents list with no Agent open). Unsaved changes go through the leave dialog. While Esc returns to a list, the header hides the Escape hint because **Back to Runs** still closes Studio.
The 192 px sidebar (144 px narrow) has an **Author** group with **Flows** and **Agents**, each with its
definition count, and an **Automate** group with **Triggers**. Its count is the number of Triggers, or, in red, the number
in Error while any Trigger is ([Trigger attention](#trigger-attention)). The Studio header breadcrumb carries the full path to the open item. Select a parent segment to go back. Pages use that breadcrumb for back navigation. Studio and Settings share a short opacity-only transition that reduced motion disables; the underlying sidebar title area stays mounted.

While Studio is open, its Flow, Agent and Trigger lists, the Agents' runtime summaries and saved-Flow usage
counts, the sidebar counts and the Flow editor's Agent library follow every committed create, save,
duplicate, removal and import live, whichever client or Factory MCP made it, and each Trigger's checks, with no navigation or
retry. A failed subscription shows the list's error until the automatic retry succeeds. Both editors read their definition from these lists and follow its
saved revisions ([Following saved revisions](#following-saved-revisions)).

Leaving a Flow with unsaved changes, whether for a list, Agents, Triggers, another Flow or by closing Studio, opens the centred dialog **Discard unsaved changes?** (“*Name*” has changes that aren’t saved) with **Keep editing**, which stays on the Flow, and **Discard changes** (browser Back follows the same
rule; reload uses the browser's leave warning). Agent and Trigger edits are guarded the same way when leaving their page. A Flow opened from a Trigger keeps the Trigger draft underneath.

**Return from cross-surface links.** A link from the Flow editor to another surface opens its target over the editor: the block settings' **Open Agent** and **New Agent** (in the library and on the readiness issue) open the Agent with the breadcrumb **Studio / Flows / *Flow* / *Agent*** (or **New Agent**). The Flow's editor and its unsaved draft stay mounted underneath, along with the Trigger and its draft if the Flow opened from a Trigger. The breadcrumb then reads **Studio / Triggers / *Trigger* / *Flow* / *Agent***. **Esc**, the header's **Back to Flow** (✕) or the Flow crumb returns to it. After **Create Agent** the editor returns to the Flow, where the new Agent appears in the library; it is not wired automatically. Opening Settings from an editor with unsaved changes neither discards nor prompts either; the leave dialog applies only when the user leaves the editor for another Studio page.

The header breadcrumb carries the full path: an opened Flow reads **Studio / Flows / *Flow name***, and the editor has no back link of its own.

| Destination | Browser URL |
| --- | --- |
| Flow list | `/studio/flows` (`/studio` and `/flows` also open it) |
| Opened Flow | `/studio/flows/:flowId` (`/flows/:flowId`) |
| Agent list | `/studio/agents` (`/settings/agents`) |
| Opened or new Agent | `/studio/agents/:agentId` (`new` creates; `/settings/agents/:agentId`) |
| Trigger list | `/studio/triggers` |
| New GitHub Issues Trigger | `/studio/triggers/new/github-issues` |
| Opened Trigger | `/studio/triggers/:triggerId` |

Runs start only from the composer: the Flow editor has no Start Run. Direct Studio links remember the last Run or composer and restore it on close, also when browser storage is
unavailable; a fresh session opens `/runs/new`. `/settings` and `/settings/connection` open the connection dialog and `/settings/skills` redirects to `/studio/flows`. Routing is described in
[Application foundation](foundation.md#ui-routes).

## Keyboard shortcuts

The [keyboard shortcuts](keyboard-shortcuts.md) topic is the authoritative reference for
platform defaults, customization, migration and every registry command. Canvas zoom keys
are listed there under **Canvas**; defaults can be changed in **Settings → Keyboard
shortcuts**.

While Studio or Settings is open, the Run composer and detail underneath are **inert**.
Run actions, sidebar navigation and the cheat sheet are blocked. New Run and Studio
shortcuts remain available through the existing unsaved-change guards; Settings opens over
Studio, and Esc or ✕ returns to it with its draft kept. Nested dialogs and menus block them. **Mod+/** opens the read-only shortcuts cheat
sheet from the same registry grouping as Settings. Escape closes only the topmost layer
(palette, nested dialogs, the block settings panel, then the open Flow, Agent or Trigger as above, then Studio). Switching from a dirty Flow
by shortcut or palette uses the same Keep editing / Discard changes guard. Palette navigation stays available while
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
draft and saved revision N side by side as read-only text, with added, removed and moved lines tinted.
The text includes each Block's settings for a Flow and the full Worker settings for an Agent.
When Studio does not hold N yet, as
after a refused save, the comparison opens once it arrives; if the list fails to load meanwhile,
the editor says **Could not load the latest revision. Try again.** From the comparison, loading N
discards the edits, while keeping the draft against N sends nothing and leaves it unsaved against
N: keeping requires another explicit Save, which writes it as N+1 and can conflict again. Both act
only on the revision shown: when N+1 arrives the comparison moves to it, an action for an older
revision does nothing, and a removal dismisses the comparison.

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

## Ownership

Every Flow and Agent is a [global Flow or global Agent](../GLOSSARY.md#global-flow--global-agent) or is owned by one
Project, referenced by its Factory Project identity, so two clones of one repository are distinct owners and a rename or move
in T3 keeps ownership. The owning Project belongs to the definition, not to its revisions: a save appends a revision and never
changes it, and Runs capture revisions without an owner. The [ADR](adr/0001-project-ownership-instead-of-per-project-flow-overlays.md)
records why a per-project variant is an independent copy rather than an override of a shared Flow.

- **Create.** Flow and Agent create take an optional `projectId`: a Factory Project id, or `null` (the default when omitted)
  for a global definition. A Project Factory never discovered is refused (`project_not_found`), and so is one unavailable for
  new Runs, with its availability reason (`project_<availability>`, as [project readiness](projects.md#identity-and-api)
  names it). Studio's **New Flow** and **New Agent** choose the owner, and Import and Duplicate a target
  ([Owners in Studio](#owners-in-studio)).
- **Duplicate and Import targets.** Flow Duplicate, Agent Duplicate and Import take a target: `projectId` naming a Factory
  Project available for new Runs, or `null` for Global. Flow Duplicate preview and Agent Duplicate default to the source's
  owning Project, Import to Global; a Flow Duplicate commit names the plan's resolved target explicitly.
  A target unavailable when the copy is committed is refused with its availability reason, as for create, so an unavailable
  default must be changed before commit.
- **Flow Duplicate** copies the source's latest saved revision (name, graph, positions and workspace) into a new Flow at
  revision 1, named `<name> copy` unless a name is given. `POST /api/flows/:id/duplicate/preview` with an optional
  `projectId` answers a plan and writes nothing: the source revision, the resolved target, the default name, each distinct
  placed Flow the target may not place (in traversal order, always copied into the target as `<name> copy`, including
  cyclic placements without looping), and each distinct Agent placed directly or through copied Flows, with its revision,
  owning Project, `choice` (`keep` or `copy`) and whether that choice is `changeable`. A global Agent defaults to keep and
  may be copied into the target; a Project Agent the target may not place is always copied; an Agent of the target Project
  itself is always kept; global and target-owned placed Flows stay kept. `POST /api/flows/:id/duplicate` commits the plan
  in one transaction with the plan's `projectId` (required; Change owner appends no revision, so an omitted target could
  otherwise follow a later owner change), `expectedRevision`, every planned Agent's choice and `flows` (the planned copied
  Flows with their revisions and owners): each copied Agent and Flow is created once from its latest saved revision in the
  target, and every block placing it is retargeted to the copy. A block whose Agent or Flow is unset, missing or removed is
  copied unchanged and stays missing. A source revision, Agent or planned Flow revision or owner that changed since the
  preview, or a different set of Agents or Flows, is refused as `stale_duplicate_plan`; changing a fixed choice is refused
  as `duplicate_choice_not_allowed`. The answer holds the new Flow, its Agent `copies` and its `flowCopies` by source Flow.
  The source Flow and its placed definitions never change, so duplicating out of an unavailable Project into another Project
  or Global rescues a Flow and its dependencies.
- **Placement rule.** Any Flow may place a global Agent or global Flow, and a Project Flow may also place Agents and Flows
  of its own Project, never another Project's. A create or save whose graph breaks the rule is refused with an
  `agent_scope_mismatch` or `flow_scope_mismatch` issue per block, naming the block and definition, and stores nothing;
  readiness reports the same issue, which blocks Start. Factory MCP and every other client go through the same check.
- **Change owner.** `PUT /api/flows/:id/owner` and `PUT /api/agents/:id/owner` take `{expectedProjectId, projectId}`: the
  owning Project the client last saw and the new one, each a Factory Project id or `null` for global. The move appends no
  revision and changes nothing else: no other definition is edited, copied or made global, and Runs keep what they captured.
  It does advance the definition's `updatedAt`, always strictly, because live updates send only differences: a move away and
  back between two reads still reaches every open Studio, whose editors then follow the owner it shows.
  It is refused when the definition's owner is no longer `expectedProjectId` (conflict, `stale_owner` at
  `expectedProjectId`), when the new owning Project is unknown or unavailable (`project_not_found` or
  `project_<availability>` at `projectId`, checked in the committing transaction), and when the placement rule would no longer
  hold for the latest revision of a current Flow (conflict, one `owner_change_blocked` issue at `projectId` per blocking
  definition, naming it and its id):
  - a Flow moves only if the new owner may place every Agent and Flow it places, and every current Flow that places it may
    still place it under the new owner;
  - an Agent moves to global always; it moves to a Project only if no current Flow outside that Project places it, so a
    move from one Project to another is blocked by the old Project's Flows that place it.

  The answer is the definition with its new owner, and Studio's live definition updates deliver it. Moving a definition out of
  an unavailable Project follows the same rule.
- **Saves expect the owner.** Flow and Agent saves carry `expectedProjectId` beside `expectedRevision`. A save after Change
  owner moved the definition is refused (conflict, `stale_owner`), appends nothing and keeps the editor's draft. Studio's
  editors follow owner changes live ([Owners in Studio](#owners-in-studio)).
- **Unavailable owner.** Definitions of a Project no longer in T3 (removed, or belonging to another environment) stay listed only to be moved with **Change owner…** or removed. They sit at the bottom of each list under the Project name and a neutral **Not in T3** tag, with no path. They are not opened from the list, run or used, and a Trigger there offers only **Remove…**. A missing repository folder is not this state: that Project stays a normal group and its Flows read **Not ready** with the reason. A lost T3 connection is the ordinary offline state and marks no row. Owner pickers, the Owner filter and the composer never offer a Project gone from T3. An Agent already open when its Project leaves T3 becomes read-only like the Flow editor: the Worker picker and Save are disabled, the form is inert, and one Warning card, **“*Project* is no longer in T3”**, offers **Change owner…**. Removing an Agent is still refused while the
  latest revision of any current Flow places it (`agent_in_use`), whatever that Flow's owner or availability. Removing a Flow is refused while a Trigger starts it (`flow_in_use`).
- **Export** carries no Project. **Import** creates every bundled Agent new in the single import target, never matching an
  existing Agent by name, so an imported Flow can always place its Agents.

Ownership adds no model or environment restriction: a Project Agent's execution settings are checked as any Agent's.
Only a global Agent has [Project overrides](#agent-definitions). Change owner to a Project is refused while it has any
(`owner_change_overrides`), and an Agent Duplicate or a Flow Duplicate copy into a Project takes the settings that
Project's override chose, without overrides; a copy into Global keeps them. Export and Import carry no overrides.

### Owners in Studio

- **Grouped lists.** Flows, Agents and Triggers share one list. The header is the title, the total loaded count (hidden while loading), **Import** on Flows and Agents, and **New Flow**, **New Agent** or **New Trigger**. Search sits at the left of the toolbar (**Search Flows**, **Search Agents**, **Search Triggers**); Flows and Agents add the Owner filter, and Triggers do not, so the search field stays put. Switching lists does not move the title, the buttons, the toolbar or the first group heading. Groups are **Global** first (Flows and Agents; a Trigger always belongs to a Project), then Projects still in T3 by title, then Projects gone from T3. Each present Project group shows its title and repository path; when two Projects still read
  alike, its environment and endpoint are added, then an id suffix. A Project whose folder is missing stays in that order, and its Flows read **Not ready** with **Repository unavailable** even when the graph is ready. A lost T3 connection does not mark a row or make a Not-in-T3 group. Every row has an always-visible ⋯ menu: Flows and Agents offer **Change owner…** and **Remove…** (Duplicate stays in the editor), and Triggers offer **Check now**, **Edit** and **Remove…**. Flows and Triggers also show › and open their page; Agent rows do not, because the editor opens beside the list. A Flow row's meta is its block count and revision, and the first readiness reason wraps in full under it beside **Ready** or **Not ready**. The Agent editor shows no owner of its own: the group heading in the list beside it names the owner, and on
  the Agents list a Project group's name carries the placement rule as its tooltip (**Only *Project* Flows can place this
  Agent.**, or **these Agents** for several). The open Agent stays listed under its owner while the search or the Owner
  filter would hide it. The Flow editor's toolbar shows an owner badge for a Project-owned Flow only (none for a
  Global Flow).
  The Project catalog comes from the same live delivery the Run composer uses, so availability changes appear without reload.
- **Owner menus.** Like the Run composer's picker, the Owner filter and every owner menu below offer Global and the available
  Projects only, so they never offer a Project T3 has removed. The catalog keeps references to Projects T3 no longer
  lists, or that belong to another environment, for history; such a Project appears in a menu only while it is the chosen value,
  disabled with its reason, and its definitions stay reachable through their **All** group.
- **Owner filter.** **Owner: All**, **Global** or one Project filters both lists together. It starts at All whenever Studio
  opens and never follows the Run composer's selected Project. A Project shows global definitions and that Project's.
- **Choosing an owner.** **New Flow** and **New Agent** always show the owner choice: **Global** or **Project** with an
  **Owning Project** menu of the available Projects. The default comes from the filter (All
  or Global gives Global, a Project gives that Project); an Agent added through the Flow editor's **New Agent** defaults to that Flow's owner, also when the Flow is global. An unavailable default stays chosen, with its reason,
  and blocks Create until another owner is chosen; it is never replaced silently. The owner is part of the create, not of the
  draft's unsaved changes, and a saved definition's owner is not edited here.
- **Flow editor.** The block library offers only the Agents this Flow may place under the placement rule, grouped under
  **Global** and the owning Project's name with a count; blocks already on the canvas keep resolving every saved Agent. A
  Project Flow whose folder is missing on this machine shows **Not ready** with that reason and no Block marker. When the
  owning Project leaves T3 while the editor is open, the editor becomes read-only: the owner badge carries a **Not in T3**
  tag, the library and canvas are inert, Save and the Workspace control are disabled, and one Warning card under the toolbar
  offers **Change owner…**.
- **Change owner….** The Agent editor's **More actions** menu and the Flow editor's **More Flow actions** menu open **Change owner of
  “*name*”** with a **New owner** menu of Global and the available Projects; the current
  owner stays chosen until another is picked, and an unavailable chosen owner blocks the change. A refusal turns the dialog
  into **Can’t make “*name*” *owner* *kind*** with the placement reason and the blocking Flows (for an Agent) or Agents (for a
  Flow), each with its owner and, for a Flow, the blocks placing the Agent; a listed one opens in Studio. Its **Duplicate to
  *owner*…** opens Duplicate with that target instead. The editor's own move
  needs no acknowledgement, also when Studio delivered it before the reply; a later delivery naming another owner, including the former one, is followed like a move elsewhere,
  because live updates can coalesce a move back.
- **Duplicate….** Flow Duplicate (the Flow editor's **More Flow actions**) asks for a **Target owner**, and Agent Duplicate
  (the Agent editor's **More actions**, saved Agents only) for a **Name** (`<name> (copy)` until edited) and the **Global** /
  **Project** owner cards; both default to the source's owning Project, and an unavailable default stays chosen with its reason
  and blocks Duplicate until another target is picked. Agent Duplicate copies the saved revision: from an editor with unsaved
  changes one card reads **Copies saved revision *N*** — "Your unsaved changes aren’t included." Flow Duplicate also takes the new name (the plan's
  `<name> copy` until edited) and shows **Agents in this Flow** from the preview: each global Agent offers **Keep shared** or
  **Copy**, a Project Agent the target can't place reads **Copied into target**, and an Agent of the target itself reads
  **Kept**. Changing the target previews again, a summary names what is created, and a stale plan is previewed again with
  the reason and never committed blindly. Flow Duplicate copies the saved revision (unsaved edits are named as left out) and
  opens the new Flow once Studio lists it; Agent Duplicate opens the copy.
- **Import target.** The import dialog chooses **Global** or **Project**, then an **Owning Project** among the available Projects, starting at Global. **Import** creates every definition in the chosen target and stays disabled, with the reason beside it, while an unavailable Project is chosen.
- **Owner changed elsewhere.** An open editor follows its definition's owning Project from Studio's synchronized lists, which
  appends no revision. Without unsaved changes it simply shows the new owner. With unsaved changes it keeps them, shows
  **This *kind* is now owned by *owner*** (or **is now Global**) and disables Save until **Acknowledge new owner**; the next
  save then expects the new owner. A save refused as `stale_owner` before Studio delivered the move keeps the draft, shows
  the refusal and waits for the new owner, then asks for the same acknowledgement instead of a revision comparison; when Studio
  already shows an owner other than the one the save expected, it asks at once. Moving
  back to the acknowledged owner needs no acknowledgement. After such a refusal the editor reads the definition once: if
  it already names the acknowledged owner again, the edits can save at once; otherwise only a state written after the one
  read can release the wait, so a delivery read before the refusing move, even one queued until then, keeps the draft
  waiting. If that read fails, no delivery naming the acknowledged owner releases the wait: Studio's next delivery reads
  again, a read that completes is checked against what Studio delivered meanwhile, and a delivery naming another owner
  asks for acknowledgement as usual.

## Agent definitions

Open **Studio → Agents** (`/studio/agents`) to create, edit or duplicate reusable definitions; an existing one opens at `/studio/agents/:agentId` and a new one at `/studio/agents/new`. A
definition stores a name, plain-text prompt, optional execution settings (T3 environment, provider, model and thinking options) and its exits. There is no runtime-mode, permission or tools field: T3 chooses launch
defaults. An Agent is global or a Project Agent ([Ownership](#ownership)); Runs supply project context.

**Exits.** An Agent declares the exits its worker can finish with, managed in a compact table under the Prompt with the columns **Name**, **Description (optional)** and **Message required**: exit names use the sans font, **Message required** is a switch and each row's remove control is an icon button named **Remove exit *name***. **+ Add exit** adds a row; **Save** stores the edited exits in a new Agent revision. Each exit has a stable ID; names
are distinct and non-empty. The editor checks this live: a duplicate or empty name shows the Error border and a **Duplicate** or **Required** tag in its field, one Error card explains it (**Two exits are named “…”**) and **Save** stays disabled; the server check remains the backstop. A new Agent starts with one exit, `done`, which needs no message. Every Flow block of the Agent offers its current exits, so an exit edit reaches open Flow editors through Studio's saved definitions without changing their graphs, while a Run keeps the exits of the Agent revision it captured. Renaming an exit keeps its ID and therefore every wire; removing a wired exit makes those Flows not ready, marked in their editors (see
[Saving and readiness](#saving-and-readiness)). Agents saved before Agent exits existed have none: their blocks kept their former exits as Flow-local exits.

Under the shared Studio header, a 300 px list sits beside the editor ([Owners in Studio](#owners-in-studio)). Entering Agents with no Agent in the URL selects the first listed Agent, skipping a Project gone from T3. Returning to the list from an open Agent (Esc, the **Agents** crumb, **Back to list**, or removing the open Agent) leaves no Agent open. An empty list shows **No Agents yet** and no editor, unless the URL is a new-Agent draft or already names an Agent. **Import** is its own button ([Import](#import)); **New Agent** in the header is outline while that draft is open, because **Create Agent** is the primary. Each row shows the Agent's name, a runtime summary such as **Codex · GPT 6.1 Sol · High**, and **1 Flow** or **Unused** (distinct saved Flows, excluding Runs and unsaved
drafts); the name and summary wrap, and narrow screens stack list and editor. The Studio breadcrumb ends with the opened Agent: **Studio / Agents / *Agent name***, or **Studio / Agents / New Agent**; a new Agent opened from a Flow editor's **New Agent** reads **Studio / Flows / *Flow* / New Agent**, and **Create Agent** or Esc returns to that Flow. The editor header is the shared header's Stacked layout: the name with the Worker picker (see **Worker settings** below), a ⋯ **More actions** menu and **Save** (**Create Agent** for a new one), then one status line: **✓ Saved · Revision *N* · Used in *N* Flows** (**Unused** for none), **Unsaved changes · Revision *N* · …** while the draft is dirty, **Not saved yet** for a new Agent, or **Removed elsewhere**, the last three with the attention dot. It has no owner line ([Owners in Studio](#owners-in-studio)). **Save** follows the [one Save rule](design-system.md#components-and-interaction); **Create Agent** stays neutral and disabled while the name is blank, with no error text. The menu exists after the first save and holds **Duplicate…**, **Change owner…**, **Export JSON** (see [Definition export](#definition-export)), **Remove worker** while a Worker is saved, and **Remove…**; focus returns to ⋯ when an item's dialog closes. A new Agent shows **New Agent** and no menu. Below the header, one card per problem (saving, a revision or removal elsewhere, an owner change, exit names, Project overrides, Needs a model, reporting, a Project gone from T3) sits above the form: the name, the owner choice for a new Agent as the **Global** and **Project** cards, the
Prompt, which starts short enough to keep the exits visible and keeps its resize, and the exits. Leaving an edited Agent asks **Discard unsaved changes?** with **Keep
editing** or **Discard changes**.

**Worker settings.** The header's Worker picker names what the Agent runs on:
**Provider · Model · Effort** (the effort is the model's first option, its default included, by its label such as **High**),
with a chevron and an accessible name such as **Worker: Codex · GPT 6.1 Sol · High**. Open, it has the indigo border. The
picker opens a popover with focus inside; Escape closes only the popover and returns focus to the picker, and every change in
it is a draft edit (Unsaved changes, **Save**, the leave guard). The popover's **Worker** is one bordered group of rows, each a
label and its control: **Environment**, **Provider**, **Model**, then the model's options (**Reasoning effort**, …), with
**Fast mode** and every other on/off option as a switch. The choices come from live T3 capabilities (`orchestrator_capabilities`)
for the chosen environment, never a Factory allowlist. When T3 offers a model without a display name, Studio shows its model ID
in the picker, Worker summaries and revision comparisons. A field stays disabled until its parent is chosen, and with no model no
option rows are shown. There are no step numbers or helper lines.

A saved environment, provider, model or option T3 no longer offers is cleared from the draft when the editor opens (a gone
environment clears the whole selection, a gone provider or model clears it from there, and options the model no longer offers
are dropped), so the editor reads **Needs a model** until a model is chosen; pickers never list a gone choice. The stored Agent
changes only when the user saves. While T3's capabilities are unavailable nothing is known to be gone and the saved settings
stay as they are.
Availability is separate from verified execution support. A provider without Factory reporting support ([Reporting installation](t3-integration.md#reporting-installation) lists the drivers that have it) sits at the bottom of the provider menu
as a disabled row tagged **No Factory reporting**, so it cannot be chosen. New Agents default to the first provider with reporting support; when T3 offers none, no provider is preselected. Saved settings always carry their thinking-option list, empty when none is chosen; malformed lists are rejected. Factory launches each Block worker with these saved settings
([Run execution](runner.md#current-execution-contract)); the API's `execution` field holds the worker settings. Agent reads return the saved settings without contacting T3; Studio judges their availability against the capabilities it loads.

The Worker is optional. **Remove worker** in **More actions** is the deliberate way back to Needs a model. When the draft has Project overrides, the action asks to remove them with the Worker. Confirming removes both from the draft, and **Save** stores those changes in the next revision. A save whose environment, provider or model is not chosen stores
no execution settings rather than a partial one, so an Agent can be saved before T3 offers a supported provider. Such an
Agent shows [**Needs a model**](../GLOSSARY.md#needs-a-model) in the Agent list, in the block library, on the block
inspector's worker line (which links to the Agent) and as a neutral tag on its Flow canvas blocks, never presented as an
execution state; its Worker picker reads **Needs a model** in the attention color with the attention border, one Warning card
reads **Needs a model** — "Flows that use this Agent can’t start until it has one.", it opens
with nothing preselected and Duplicate keeps it model-less. Every Flow that places such an Agent is not ready (`agent_model_required`, one issue per block,
"{block}: {agent} needs a model."), so a Run never starts with it; choosing a model in the Agent editor makes those Flows
ready without saving them again. In the API `execution` is
`null`; create and save require the `execution` key, as complete settings (`environmentId`, `providerInstanceId`, `modelId`
and a `modelOptions` list) or an explicit `null`, so an omitted key or a partial object, including one without
`modelOptions`, is a validation error. A `null` execution skips the reporting-support check.

**Project overrides.** A global Agent's Worker picker lists **Project overrides** under the Worker settings
([Project override](../GLOSSARY.md#project-override), [ADR](adr/0002-project-overrides-of-global-agent-execution-settings.md)):
one row per Project, its name in brand cyan (the attention color while the Project is unavailable), its display summary and a
remove icon button. A row opens the override in its dialog to edit it, and the remove button takes it out of the draft.
**Override for a Project…**, one left-aligned row with its plus icon, opens a centred dialog with the same label/control rows,
**Project** first (only when adding) among the available Projects without an override, starting from the Agent's own settings,
and **Cancel** / **Apply**; **Apply** puts the row in the draft and **Save** stores it in the next revision like any other edit.
Runs in that Project launch with the override; every other Project uses the Worker. The dialog stays open when the popover
closes. **Override for a Project…** is disabled until the Agent has its own Worker or while every available Project already has
an override, and a Project Agent's picker has no such section. A new Agent whose owner choice changes to a Project keeps its overrides in the draft under **Project overrides
left out**, and **Create Agent** saves it without them; choosing Global again before Create keeps them. The revision
comparison lists each override's Project and settings on both sides. When another client moves a saved Agent to a
Project while this draft holds Project overrides, one Warning card reads **Project overrides can’t be kept** after the new
owner is acknowledged, and Save waits until **Remove override(s)** or Change owner… back to Global. The Agent list row adds **+N Project overrides** to its runtime summary. In the API, `projectOverrides` is a list
of `{projectId, execution}` with complete settings; save requires the key (send the saved list unchanged to keep it, `[]`
for none), while a create may omit it for none. A save is refused when a Project Agent has overrides
(`override_global_only`), when overrides exist without the Agent's own settings (`override_requires_execution`), when a
Project appears twice (`duplicate_project_override`), when an override's provider lacks reporting support, or when a newly
added override names a Project unavailable for new Runs; an override already saved stays while its Project is unavailable.

The list and editor show the provider's [reporting installation status](t3-integration.md#agent-reporting) only when it needs
attention: the row's summary line gives way to an attention tag such as **Reporting not configured**, and the editor, following
the current provider choice, gives the picker the attention border and shows one Warning card with **Open Agent reporting**.
Settings opens over the editor, and Esc or ✕ returns to it with the draft kept. Installed reporting, and reporting still being checked,
show nothing.
Installed configuration does not establish full execution readiness or live report visibility; Start still checks those gates.

**Saving.** Each accepted create or save appends one immutable Agent revision holding the name, prompt, settings and exits; a stale or invalid save returns an error,
appends nothing and keeps local edits under one Error card, **Couldn’t save the Agent** — "Your changes are kept.", which also carries the server's validation message. Duplicate creates a variant with a new identity from the saved revision in the chosen [target](#owners-in-studio); `POST /api/agents/:id/duplicate`
takes an optional `name` and [target](#ownership) `projectId`. Create and save bodies may be up to 2 MB, enough for a 120,000-character prompt.
A save response arriving after leaving refreshes the list without reopening the editor. Mention skills directly in the prompt (for example `$review-code`); there is no skill field or interpolation.

**Revisions saved elsewhere.** An open Agent editor reads its Agent from Studio's saved definitions instead of loading it once and follows the
[shared revision rules](#following-saved-revisions). A newer revision shows one Warning card, **Revision *N* was saved
elsewhere**, and Save waits until **Compare latest revision** has been used. The comparison is a wide dialog, **Compare with
revision *N***: **Your draft** beside **Revision *N*** in display names (Worker, Project overrides, exits, prompt), changed lines
tinted. **Keep my edits** keeps the draft against revision N; **Load revision *N*** replaces the draft at once. A newer revision
arriving meanwhile moves the comparison to it, and a removal dismisses it.

**Create outcome unknown.** Repeating a Create whose reply was lost could make a second Agent, so the new-Agent form keeps its
draft and disables Create while Factory looks up the original request by the Agent ID that request would have created.
The lookup finds the Agent even if its revision or owner changed. **Open Agent** opens its current revision.
Factory reserves the request ID before the browser sends Create and bounds its write window using the host's monotonic clock. **Create again** is offered only when Factory confirms that no Agent was created and the original request can no longer write. A restart ends unused reservations and the lookup still finds committed Agents.
If Factory cannot confirm the result, **Check again** repeats the lookup. The new-Agent form otherwise ignores other Agents' changes; after its Create, or after
**Duplicate…**, the opened Agent follows these rules even before Studio has delivered it.

A Create or Duplicate answer bridges only the wait for its first appearance in Studio's current
lists. After that appearance, reopening its URL uses the saved lists; an old answer cannot reopen
a definition removed elsewhere.

**Removing.** **Remove…** in the list and in **More actions** confirms by name (**Remove “*name*”?** — "Runs that used it keep
the revision they started with.", **Cancel** / **Remove Agent**) and removes the Agent from Studio, Flow references and Start selection with no restore; its saved revisions are kept and later saves to it are rejected. It
rejects Agents placed in the latest revision of any current Flow. The dialog then lists those Flows with their owner and a **Not in T3** tag where it applies, and each entry opens that Flow; the backend checks those blocks at removal time even if the usage count is stale, while removed Flows and Runs never block
removal. An unsaved Flow draft may still reference a removed Agent and needs repair before running. Runs keep the Agent revision they started with, and removing an absent or removed Agent succeeds.
Factory MCP's [`factory_remove_agent`](t3-integration.md#authoring-tools) performs the same removal; open Studio lists drop it at once.


**Removed elsewhere.** If an Agent already open in Studio is removed by another client, its URL and
editable draft stay open, even when the draft was clean. A persistent Warning card, **This Agent was removed
elsewhere** — "Your draft is kept.", replaces revision notices, the status line reads **Removed elsewhere** and the row leaves
the list. Save and **More actions** are disabled, and their handlers refuse further writes. An unsubmitted Remove
confirmation closes; an already submitted Remove completes normally through the idempotent removal
and returns to the list without another discard prompt. Saves that reach a removed Agent are still
rejected by the backend and never recreate it.

**Copy as JSON** recovers the current name, prompt, execution settings, exits and Project overrides, including unfinished
edits, in the create API's shape without identity, revision or status fields. Studio confirms a
successful clipboard write; if clipboard access fails, a read-only selectable JSON box remains
available. Leaving or closing Studio asks **This Agent was removed elsewhere. Discard the retained
draft?** with **Keep editing** and **Discard**, even for a clean draft. Ordinary unsaved-change prompts
stay unchanged; browser close and reload use only the browser's standard warning. A fresh link to
an absent Agent shows **Agent not found** and **Back to list**; a failed read instead offers Retry.

See [T3 integration](t3-integration.md) for authorization and capability reads.

## Flow authoring

Open **Studio → Flows** (`/studio/flows`), choose **New Flow** (or **Import**, see [Import](#import)) and save a name; the editor opens at `/studio/flows/:flowId`. **Create Flow** stays neutral and disabled while the name is blank, with no error on the field. Any other cause, such as an owner that cannot be used, shows its reason beside the action. A failed create shows one error card, **Couldn’t create the Flow**, and leaves the name as typed. A Flow is global or a Project Flow
([Ownership](#ownership)); the composer's project selection never assigns one, and no connection or project is needed to author. Block and exit IDs, positions, graph, name and revision persist across restarts.

Factory installs no built-in Flow and assumes no development process: the blocks, exits and wires you connect are the
whole process. For example, a bounded review loop wires a reviewer Agent's changes-requested exit to a Condition whose
rule **From arrival 3 onward** leads to a Human step and whose Otherwise returns to the implementing Agent, so the third
request for changes escalates to you instead of looping again ([Condition](#canvas-and-block-configuration)).

### Canvas and block configuration

The editor's toolbar holds the owner badge (Global or the owning Project), the Flow name as an inline field, the save status
(**Saved**, **Unsaved changes**, **Saving…**), then **Workspace**, ⋯ **More Flow actions** and **Save**.

The editor has a block library on the left (**Human step**, **Wait**, **Continuation**, **Condition**, **Join**, saved Agent definitions and placeable saved Flows) and the canvas. The library's
**Search steps and Agents** field and its **Collapse library** icon (collapsed, **Expand library**) share one row and stay pinned while the library scrolls; the
search filters steps, Agents and Flows by name and says **No matching steps or Agents** when nothing matches. Headings are **Steps**, **Flows** (placeable Flows under the placement rule, with any Flow that would form a cycle disabled with its reason and Flows without a reachable ending tagged **No reachable ending**), and each owner's name (**Global**,
the Project) with a count. Names and descriptions wrap instead of being cut, and an Agent row shows its display summary, such as **Codex · GPT 6.1 Sol · High**.
An Agent without a model is listed last in its group, disabled, with a **Needs a model** tag. With no Agent to place, the library's group is
headed **Agents** whatever the Flow's owner and shows **No Agents yet** with a **New Agent** link; when Agents exist but none has a model, the group keeps its
disabled rows and shows only the **New Agent** link under them. Add a block by activating the row or drag the row onto the canvas (a ghost shows the drop
position; dropping elsewhere adds nothing); undropped additions fill a three-column grid right of the Flow input and are selected. Drag a block's header to move
it; wires follow live and the draft changes once, on drop. Escape cancels any drag.

Selecting a block (click, or focus + Enter) docks its settings panel at the editor's right (360 px): the canvas narrows and pans the least distance that keeps
the selected block and the next block it connects to in view. The panel's header holds the kind icon and name, **Esc** and ✕ (while it is open the Esc chip
shows on the panel only), and its footer **Remove block**. It holds no explanatory text or position fields. An Agent block's panel holds **Name**, the
**Agent** picker with the Agent's model summary and **Open Agent**, **On revisit** (**Keep context** or **Fresh context**), **Revisit instruction (optional)**, **Exits** with each exit's targets and **Hide** /
**Show**, and **Local exits** with **Add local exit**. The picker lists only the Agents this Flow may place, those without a model disabled at the bottom.
Prompts, execution settings and exits belong to the Agent, and two blocks may share a definition. Besides Flow-local and hidden exits, a block's
one override is its optional [Revisit instruction](../GLOSSARY.md#revisit-instruction): two blocks sharing a reviewer Agent can play different loop roles, such as a single check and a
correction loop, without duplicating the Agent and letting the copies drift apart. It is deliberately narrow: there is no first-visit block prompt and no execution, model or exit-definition
override, so any other variant is a new or duplicated Agent. Clicking empty canvas, ✕ or Escape closes the panel. Blocks show kind, Agent, an input port and one port per exit with the exit's
name in the secondary text colour, and multiple incoming connections each anchor to their own
input port (Flow input first, at least 18 px apart).

An Agent block's panel always shows **On revisit** (**Keep context** by default, or **Fresh context** to start each revisit in a fresh provider session without earlier context) and the optional **Revisit instruction** plain-text field, edited like a Continuation's prompt (up to 120,000 characters; surrounding whitespace is
dropped on save, and whitespace alone saves as empty). The field never cuts input short: longer text stays in the draft and Save reports the error at the block's field. It is sent on every visit to the block after the first, with the incoming message; the Agent prompt still applies,
and the instruction decides that visit's scope but never waives the Agent's criteria, a required check or a defect with evidence. Edits are unsaved draft changes like any other. A block with a
non-empty instruction or **Fresh context** shows a small neutral tag in its canvas header (**Revisit instruction**, **Fresh context**, or **Fresh · Revisit instruction**), never the text and never styled as an execution state. New Agent blocks start empty with **Keep context**, and swapping
the block's Agent or copying the Flow's graph keeps both values. Delivery is described in the [Runner](runner.md#revisit-instructions).

A **Continuation** block is configured with only a name and a required **Prompt**; it has no Agent, settings or exits to configure. Its canvas block reads
**continues *Agent*'s thread**, naming the nearest Agent on its incoming paths (walking back through Human steps, Waits, Conditions and Continuations), or **the incoming Agent's thread** when
several Agents can reach it. It has one output (**response**). Its panel holds **Name**, **Prompt**, **Continues** (the thread) and **Output** with its targets. The
first message sends the prompt to that conversation and waits for its response, messages arriving meanwhile wait, and every later message passes through unchanged
([Runs](runs.md#continuations)). Returning to the Agent's conversation is shown as this text, not as an extra wire.

Every Flow has one **Flow input block** (**FLOW INPUT** / **Flow input** / **Run prompt**): one output port, no input or exits, and it cannot be removed; selecting it
opens its settings with a **Starts** target select. The Agent blocks it connects to start a Run, each with the same prompt in its own session; no block is marked "entry".

A Flow can also have one **Finish block** (**FINISH** / **Finish** / *N* endings). It is optional: **Finish** in the library's Steps adds it
while the Flow has none, at the drop point or, when activated, right of the other blocks, and selects it. It is moved like a block, and
**Remove block** in its settings removes it with its endings and their wires; ⌘Z restores them. A Flow without one has no endings. Each [ending](../GLOSSARY.md#ending) is a row with its own labelled input port on the
left edge, in ending order: the one exception to one input port per incoming wire, so several wires converge on their ending's port. Without
endings the block reads **No endings** with the hint **Add endings in its settings**. Selecting it opens **Finish** settings: a short
explanation, one card per ending with **Name**, **Description**, **Output** (**None**, **Optional** or **Required**), **Output desc.** (hidden
for None) and **Incoming**, which lists each wire as *Block* → *exit* with a **Message required** tag where that exit must carry a message, or
the **Not connected** tag and "No exit leads to this ending yet.". **Remove ending *name*** removes the ending and its wires in the same edit,
without confirmation; ⌘Z restores both. Renaming keeps the wires. **+ Add ending** appends an unnamed ending with Output None and focuses its
name; at 100 endings it is disabled with **Up to 100 endings** beside it. Endings keep their order and cannot be reordered. With none the panel
shows **No endings yet** — "Without endings, the Run ends as it does today, when its branches stop. Add an ending to give the Run a result." A
note, **Reaching an ending ends the Run**, says that the first ending reached sets the Run's result and stops other branches at once while
their workspace edits stay. Long wires into the Finish block are drawn as they are.

**Connections.** Dragging from an exit's output port (right edge dot) onto a block is the primary way to connect: any block, including earlier blocks and the source
itself, and one exit may be dragged to several blocks, each drop adding one connection (independent fan-out). A dashed preview snaps
to the highlighted target's input port and the draft changes once on a valid drop; dropping on empty canvas, the port itself, an already connected block or pressing
Escape changes nothing. Drag from the Flow input port (**Connect Flow input**) the same way; while doing so only Agent blocks highlight their input port and other
blocks dim. Ports take no keyboard focus. The keyboard path is the **→ target** select on each exit and output row of the settings panel, and on the Flow input's
**Starts**: a multi-select that lists only valid destinations (for the Flow input, Agent blocks), marks connected blocks with ✓ and adds or removes one connection on
each choice; the closed select names every target (**→ Approve scope, Code review**). Exit and output selects also list each ending as **Finish → *ending*** after the blocks; the closed select names it **Finish · *ending***, and
dragging a wire onto an ending's row on the Finish block connects to that ending. The Flow input reaches no ending. Under an exit wired to an
ending, its row reads **Ending expects: *output description*** for a Required ending or **Ending takes an optional message: *…*** for an
Optional one, and an exit wired straight to a Required ending shows **Message required**, in this Flow only. Click a wire to select it (the block panel closes); each wire is also a keyboard button (**Connection *exit* from *source* to *target***). With a
connection selected, Delete/Backspace (outside form controls) or the **Delete connection** button removes it. Removing a block or exit removes its connections.

Hover a block or Flow input with a mouse or trackpad, or give one of its controls keyboard focus, to see its direct
outgoing wires above the others and a dashed frame around the source. Incoming wires, later hops and destination cards
keep their resting style. The preview adds no labels and leaves selection and block settings unchanged. Finish and touch
taps show no preview. One preview follows the latest pointer or keyboard interaction. Pointer leave has a brief grace
period. A drag to move or connect, a covered canvas or a Flow change clears the preview immediately. Pan and zoom keep it
while the same source remains under the pointer or holds keyboard focus.

Hovering a wire, or giving it keyboard focus, draws it thicker above the other wires. Both endpoint cards get the dashed
frame, including the Flow input and Finish. The source exit port and the target input port, or the Finish ending row's
port, are filled in primary text colour. Several wires into one Join row or one ending accent that shared row while only
the hovered wire thickens. A chip shows the source output only on wire hover, keyboard focus or selection. Flow input
wires have no chip. Hidden exits show their name struck through, and removed exits show their stored ID struck through.
A wire beats a block preview, and cards take the pointer over wires beneath them; where wires overlap, the topmost one responds. Each wire takes the pointer
about 12 screen pixels wide at any zoom. Hovering never selects: clicking still selects the wire, press-drag on it stays
inert, and a selected wire keeps its indigo stroke. A selected wire's chip hides while a block or another wire is
previewed and returns when that preview ends. Keyboard focus never pans the canvas, and a focused wire stays drawn after
it leaves the view. A port that marks a readiness problem keeps its error border under the accent, so the fill shows the
preview and the border still shows the problem. The read-only preview inside an expanded Subflow does not respond.

**Exits.** An Agent block offers its Agent's exits, minus those hidden in this Flow, followed by its Flow-local exits; inherited exits cannot be edited in a Flow. Hiding exits and adding
Flow-local exits are stored with the Flow revision. **Exits** shows the inherited exits' names, each with its targets and **Hide** / **Show**.
Hidden rows remain visible in the panel but are absent from worker choices and cannot start new connections; they still reserve their names and IDs against local exits. Hiding a wired exit preserves its connection and reports a readiness issue until the exit is shown or the wire removed.
Wired hidden or removed exits keep a separate, unavailable canvas endpoint whose name is struck through, so their wires never appear to leave a usable exit.
Agent blocks resolve against Studio's saved Agents as they arrive: an Agent saved or removed elsewhere updates block Agent names, exit ports and the missing-Agent state at once, without
changing the draft or its unsaved state, block positions or the view. A wire from an exit the Agent no longer has stays as such a broken wire; Studio never repairs the graph or deletes a connection.
**Local exits** offers editable name, description and **Message required** cards with their targets, and **Add local exit**. Removing a local exit removes its connections.
Flows upgraded from per-block exits show those exits as local. A Human step has the fixed, locked
exits **Approve** and **Request changes**, which carries a **Message required** tag; each row shows its consequence as its targets. An unconnected exit stops its branch there.

**Wait.** A Wait holds each arrival for a fixed duration, then passes its message on unchanged. Its panel sets the
Flow-local name and **Wait for** a number and a unit (**minutes**, **hours** or **days**) in one row, such as 1.5 hours; an empty amount saves a draft without
a duration. It has one input and one output (**after the wait**) whose **Output** row holds its target select. A Wait has no Agent, prompt, execution settings, reports or worker, and the Flow input cannot connect to
it.

**Join.** A Join waits until every block wired into it has sent something, then forwards their messages together through its
one output; its library row reads **Join · Waits for every source**. On the canvas it reads **Join · *N* sources** and draws one
row per source block, in the Flow's block order, each with its own input port: every exit of that block wired into the Join lands
on its row, which reads ***N* exits**, so a reviewer's **Approve** and **Request changes** fill one slot. Dragging a wire from a
block not yet wired in adds its row; before any is wired, one hint row (**Connect the blocks to wait for**) holds the port. Below
the rows sits its one output row (**output**). Its panel holds **Name**, the read-only **Sources · *N* blocks** (each block with its
connected exits, such as **Approve · Request changes**; a Wait's or Continuation's reads **Output**) and **Output** with its target
select; sources change only by wiring. **Needs 2 sources** marks its source ports and **Not connected** its output row and port in
the error colour, with the issue in the readiness list. The Flow input cannot connect to it. The rules are in
[Validation](#validation).

**Subflow.** A [Subflow](../GLOSSARY.md#subflow) places another saved Flow by its `flowId` (`kind: "subflow"`). Its exits are the referenced Flow's Finish endings by ending ID, so renaming an ending keeps every wire while removing an ending leaves a repairable broken wire (`subflow_exit_missing`); it has no Flow-local exits, hidden exits, Revisit instruction or workspace override (the top-level Run workspace applies). On the canvas, an expandable Subflow renders as a [`SubflowGroup`](design-system.md#which-component-for-which-pattern): a read-only in-place preview of the referenced Flow showing its inner Flow input (**Incoming message**) wired to its targets, its inner blocks and Finish, drawn-only ending routes to the outer right border, interactive outer left and right ports and a **Collapse** control in its header. Collapsing turns it into a compact block card with **Expand** and **Open Flow**; cyclic, over-budget, missing or unset Subflows auto-collapse with an error badge. Selecting a Subflow opens its settings panel with **Name**, the **Flow** picker (placeable Flows with cycle candidates disabled), **Open Flow**, read-only disclosures (**Workspace**, **Revision**, **Blocks inside**), **Exits** with target selects and ending expectations, **Broken wires** (one-click **Remove** repair) and **Issues inside** (linking directly to each affected nested Flow). The **Flow input** may connect to Subflows as well as Agent blocks, and Subflow exits may connect to any block or parent Finish ending. Removing a Flow is still allowed when another Flow places it: referencing parent Flows report `subflow_flow_missing` and keep their repairable wires.

**Condition.** A Condition routes each arrival by its arrival number at that block: an ordered list of rules
**From arrival *N* onward → *output***, each with its own stably identified, named output, followed by the fixed, mandatory
**Otherwise** output, which cannot be renamed, removed or reordered. The first rule the arrival number reaches selects its
output; when none does, Otherwise is selected, as the normal route rather than an error. A Condition with no rules passes every
arrival on through Otherwise, and a new Condition from the library starts that way. A Condition cannot end a branch: every output,
Otherwise included, needs a wire before the Flow is ready, while an unconnected exit of an Agent or Human step, and an unconnected
Wait or Continuation output, still stops its branch. A Condition has no Agent, prompt,
execution settings, reports or worker, and the Flow input cannot connect to it. A Run routes through it as the [Runner](runner.md#condition-arrivals) describes.

Every message reaching the Condition gets the next number in the Run, counted together over all its incoming connections and starting
at 1; rules are checked from the top and the first whose number is reached (≥) selects its output, and the number never resets within
the Run. Its panel holds **Name** and **Outputs**: each rule row edits its output name and **From arrival *N* onward**, offers **Move rule
up**, **Move rule down** and **Remove rule** and its target select, then **Otherwise** with its target, and **Add rule** appends a rule
with a blank name and no arrival number. Renaming or moving a rule keeps its output and wires; removing it removes its wires in the same
edit. An empty arrival number stays empty (none) rather than defaulting. An entry that is not a whole number from 1 to
9,007,199,254,740,991 is shown as typed and marked invalid, never rounded or saved as another value: **Save** stays unavailable until it
is corrected or cleared, and leaving the Flow asks first like any unsaved change. An output that is not connected shows **Not connected**
on its rule row (or on Otherwise) and in the error colour on its canvas row and port. The canvas row of each output reads **from arrival *N*
onward** with its name, and Otherwise **when no rule matches**. A Condition has no rule
quota of its own, so within the [2 MB definition limit](#validation) it may hold tens of thousands of rules: the panel renders only
the rule rows near its visible part as it scrolls, and the canvas draws a port for every wired rule, Otherwise and the first eight
unwired rules, so the block stays a usable size; a later unwired rule is connected after moving it up.

### Automatic layout and canvas view

**Auto-arrange** lays out the draft left to right (Flow input leftmost, correction edges returning left, including disconnected blocks and loops, with orthogonal routes) and fits the
result. Progress is shown; an error, the 15-second limit, an edit or a drag leaves the draft intact. Positions are draft changes persisted by **Save**; routed wires are transient and recomputed
on load only when the saved positions can be preserved, so blocks never move on reload. Manual edits return to normal wire paths.
Studio and backend authoring share the [layout geometry](adr/0003-share-flow-canvas-geometry-with-auto-layout.md).

The canvas shares the Run canvas toolbar: icon-only zoom, **Fit Flow**, **Auto-arrange** and keyboard shortcuts, each with its tooltip, and no hint text. Scale is 20%–200%; **+**/**−** zoom around the viewport center and **0** fits (bare keys leave browser zoom alone; bindings in
[Keyboard shortcuts](keyboard-shortcuts.md)); pinch or **Mod**+wheel (Command on macOS, Control elsewhere) zooms at the pointer, including Safari pinch; plain scroll, arrow keys and dragging
empty canvas pan. Drag, drop and wire gestures follow the zoom level. The canvas opens readable: at 100 % with the Flow input at the left edge, then moved by the
minimal-shift rule of the [Run canvas](runs.md) while keeping the Flow input in view so every block is either fully visible or fully outside. It is never fitted on
open or on resize; the view is preserved across edits, resizes and a switch to a revision saved elsewhere, and selecting a block only pans to reveal it. Zoom and pan
never change saved positions. Such a switch closes a selection or the settings panel only when its block or wire
no longer exists.

The Flow editor and the Run canvas draw only the blocks and wires near the view, half a view beyond each edge, so a Flow of hundreds
of blocks and thousands of connections stays responsive ([ADR 0005](adr/0005-draw-only-what-reaches-the-canvas-view.md)). Positions and
wire routes come from the whole graph, so a block that returns to view and a wire crossing the view between two blocks that are away sit
where the whole Flow puts them. Blocks and wires with keyboard focus stay drawn, as do blocks held by a drag or connection gesture.
**Fit Flow** draws every block.

### Workspace setting

The toolbar's **Workspace: *value*** control holds the Flow's [workspace setting](../GLOSSARY.md). Its menu offers **Project checkout** and **New worktree**,
whose **Base** submenu holds **Default branch** (the Project repository's `origin/HEAD`, such as `origin/main`; no branch name is assumed across projects) or **Custom ref** (a
branch, tag or commit such as `develop`, typed in the ref field inside the submenu). The control then reads **Workspace: New worktree · default branch** or
**… · *ref***. New Flows use a new worktree from the default branch; Flows saved before the setting existed keep the project checkout. A changed
setting is part of the unsaved draft: it is checked for readiness again and is saved, compared on conflict and retained like the graph. Studio does not check the ref, because a
global Flow runs in any Project; Start resolves it against the selected Project ([Runs](runs.md#starting)).

### Saving and readiness

The toolbar's ⋯ **More Flow actions** menu holds **Duplicate…**, **Change owner…** ([Owners in Studio](#owners-in-studio)), **Export JSON** (see
[Definition export](#definition-export)) and **Remove…** (see [Removing a Flow](#removing-a-flow)). A disabled item shows its reason under its label, and
focus returns to ⋯ when an item's dialog closes.

**Save** follows the [one Save rule](design-system.md#components-and-interaction). It
accepts structurally valid incomplete graphs, increments the revision and shows **Saved** separately from readiness. There is no autosave. **⌘Z** (Ctrl+Z
elsewhere) undoes the last structural removal until Save. It restores a removed block, Finish block, ending or wire. A wire from an Agent exit that was
already unavailable returns with its unavailable endpoint. Undo keeps later edits, including a change that made an exit unavailable after the removal.
**Keep my edits** retains undo history, and a text field keeps its own undo.

Readiness is live: an unsaved draft is checked through the backend shortly after each change, with no Check readiness button, and again after a newer saved
revision, keeping the local draft against one, a change to an Agent or Flow in its transitive closure or a change of the Flow's owner. A check result applies only to the
content, baseline revision, owner, placed Agent revisions and transitive Flow/Agent closure it was requested for: an answer arriving after any of them changed, or resolved against
definitions Studio does not show yet, is discarded, and edits never wait for a check. A clean draft shows the readiness Studio received with its saved revision
and the definitions shown. For compositions with Subflows, readiness validates transitively across the whole reachable Flow closure: missing referenced Flows (`subflow_flow_missing`) and cycles (`subflow_cycle`) are reported first, and composition budgets (2,000 expanded blocks, 10,000 expanded connections, 64 MiB canonical capture bytes) are checked only for complete finite acyclic graphs and carry structured contributor evidence. Findings are bounded per code with cursor pagination (`GET /api/flows/:id/findings` / `POST /api/flows/:id/validate/findings`) and **Load more** in the readiness panel; nested findings name their placement path and offer **Open Flow**. The budgets count a Finish block only when it is present, including a Finish with no endings. Start rechecks readiness for the saved composition when accepting the Run. The summary at the canvas's top-left is a **Ready** badge, or **Not ready** with **N issues** and a chevron that opens one row per issue.
Each row selects its block and opens its settings at the affected field; a Condition rule issue also scrolls to that rule and focuses its name or arrival
number, and a Finish ending issue selects the Finish block and focuses that ending's name. The issue text is the one the Flows list and the composer show. A block with an issue, the Flow input and the Finish block included, shows an Error outline and a short tag
(**No duration**, **Not connected**, **Needs a model** and so on); a selected one keeps the outline with the selection ring outside it, and the affected
settings field shows the Error border and the same tag. When no placeable Agent exists, the issue **Connect the Flow input to at least one Agent** offers
**New Agent**. Actionable issues: a Flow input connected to no Agent, a missing Agent reference, block and local exit names, a block without exits, a local exit
sharing a name or ID with any current Agent exit, including hidden exits (also when the Agent adds that exit later), a wire from an exit hidden in this Flow or
no longer on the Agent, a block whose Agent Needs a model, a block whose Agent this Flow's owning Project may not place, a Wait without a valid duration, a
Continuation without a prompt, a Condition rule row that cannot run, an unconnected Condition output or a loop through only Conditions and
Continuations, unreachable blocks, and a Finish ending with a blank or repeated name or no incoming wire. These issues never block a save. Ready covers graph and saved-Agent requirements only; live connection, Agent settings
availability, project and reporting installation are separate Start gates ([Runs](runs.md)).

Page-level problems are one card each under the toolbar: **Couldn’t save** (Error, the edits kept and the refusal's issues each selecting its block), **Save
outcome unknown** (Warning), **Revision N was saved elsewhere** (Warning, Save disabled), removed elsewhere (Warning), owner changed elsewhere (Info, with
**Acknowledge new owner**) and the owning Project leaving T3 (Warning, with **Change owner…**).

When another client, tab or Factory MCP saves the open Flow, the editor follows it by the [shared revision rules](#following-saved-revisions). A clean draft's switch to the newer revision waits while a block or library item is dragged, a wire is drawn, Auto-arrange runs or a draft field has focus or text
composition, and happens afterwards only if the draft is still clean; a draft with unsaved changes names the newer revision at once. **Compare latest revision**
opens a wide dialog with **Your draft** beside **Revision N** as name, workspace, block and connection lines, the changed lines tinted. **Keep my edits** keeps the
draft against revision N (Save is enabled again) and **Load revision N** replaces the draft at once, without a second confirmation.

### Removing a Flow

**Remove…** in the Flow list and in the Flow editor's **More Flow actions** menu removes the editable definition from Studio and the Run composer after a confirmation that names the Flow, says existing Runs remain and warns about unsaved changes. A Flow a Trigger still starts cannot be removed: the dialog lists those Triggers, and one whose Project is still in T3 opens that Trigger. The same refusal answers `DELETE` and [`factory_remove_flow`](t3-integration.md#authoring-tools) (`flow_in_use`). Success returns to
the Flow list, also when another view already removed it: removing an absent or removed Flow succeeds. Runs, their captured revisions, shared Agents and T3 threads are unaffected: active Runs continue, Run canvases show the revision each Run started with, and
removal is not Archive. Its saved revisions are kept, but there is no restore. Removal needs no revision match; a save that reaches a removed Flow errors, keeps the local draft visible for copying and never recreates it. New Runs cannot select a removed
Flow. Factory MCP's [`factory_remove_flow`](t3-integration.md#authoring-tools) performs the same removal; open Studio lists drop it at once.


**Removed elsewhere.** A Flow already opened in Studio keeps its URL and editable draft when another
client removes it, even if it was clean or an interaction is in progress. The persistent **This Flow
was removed elsewhere. Your draft is kept.** notice replaces revision notices and dismisses comparison
and unsubmitted Remove confirmations. Save and every **More Flow
actions** item are disabled with an explanation; their handlers also refuse these actions. An already submitted Remove
completes normally and returns to the list without another discard prompt. Removal wins over a late
save reply, and the retained draft stays editable while that reply is pending. The backend still
rejects saves and Starts targeting removed Flows and never recreates them.

**Copy as JSON** exports the current `{name, graph, workspace}`, including unfinished edits, block
and exit IDs, Agent references, connections and positions, without identity, revision or readiness.
Clipboard success is confirmed; clipboard failure shows the same bounded, selectable read-only JSON
fallback as the Agent editor. Its content follows further edits.

A retained removed Flow has a discard guard even when clean. Leaving it for any other Studio page
or closing Studio asks **This Flow was removed elsewhere. Discard the retained draft?** with
**Keep editing**, which stays on the Flow, and **Discard**. Ordinary unsaved-change prompts stay unchanged;
browser close and reload use the standard browser warning. A fresh link to a missing Flow shows
**Flow not found** with **Back to list**; transport failures instead remain retryable.

## Triggers

**Studio → Triggers** (`/studio/triggers`) manages the [Triggers](../GLOSSARY.md#trigger) that start Flows for a
Project's GitHub issues. What a check reads, admits and starts, and the decisions behind it, are described in
[Starting from a Trigger](runs.md#starting-from-a-trigger). Approved clients have the same full management as the
host; readiness, review and checks always run on the Factory host with its `gh` login.

The header breadcrumb identifies the form as **Studio / Triggers / New GitHub Issues Trigger** or
**Studio / Triggers / *name***. Select **Triggers** in the breadcrumb to return to the list.

**List.** Triggers are grouped by Project, with **Search Triggers** and **New Trigger** even when the list is empty. Each row shows the name, **GitHub Issues · Project → Flow · schedule** (for example `every 5 min`, `every 2 hours` or `manual`), an enable switch, a ⋯ menu (**Check now**, **Edit**, **Remove…**) and ›. **Check now** is disabled until the Trigger is on. A problem that stops checks shows a **Problem** badge and the problem's message on its own wrapping line; a healthy Trigger shows no badge. After **Check now** the meta line reads **Checking…**, then **Started N Runs** (one Run opens it and leaves Studio; several open a menu of `#number title`) or **Nothing ready to start**. **Enable and check** from the row's switch shows its progress in the review, whose button reads **Checking…** until the Trigger is enabled and checked; the row's meta line then shows the same result. That line lasts for the visit only. A check that returns a problem keeps the route meta and shows the badge. The list shows no prompt, issue list, check history, Off pill or active-Run counts. With no Triggers it shows **No Triggers yet** and nothing else.
Turning a switch on opens the [review](#reviewing-what-starts); turning it off saves at once.

**Creating.** **New Trigger** opens the GitHub Issues form directly at
`/studio/triggers/new/github-issues`. The form has:

- **Name**, unique among current Triggers regardless of case. Studio checks the name as you type. A removed Trigger's name can be reused.
- **Project**, chosen from the Projects available in T3. The Project must be local to the Factory host. Save refuses a Project that has left T3 or belongs to a different T3 environment. Factory detects the Project's GitHub repository through `gh`
  and shows it as **Detected**; saving confirms it. A Trigger never reads another repository. When an opened
  Trigger's Project folder later names a different repository, its checks stop with a repository mismatch and the
  form shows that repository as **Detected now** with **Confirm**. Confirming changes the draft's
  repository, which widens what can start, so saving it goes through the review and **Apply and check**. Factory
  accepts a changed repository only while it is the one the Project's folder names at save time.
- **GitHub issue query**, prefilled `label:factory:ready author:@me`. It must contain exactly one positive `label:`
  qualifier, shown below the field as the [ready label](../GLOSSARY.md#ready-label) that the worker removes when it
  claims the issue, together with the login `@me` resolves to right now. Save refuses a query without exactly one
  usable label, with a comma list, negation or `no:label` as the ready label, with OR or parentheses around it, or with a
  scope qualifier (`repo:`, `org:`, `user:`, `is:`, `state:`, `type:`, `project:`); Factory always adds the
  repository, issue type and open state. A query GitHub rejects also blocks saving. Removing the author filter on a
  public repository warns rather than refuses.
- **Flow**, a global Flow or a Flow of the chosen Project, as New Run offers them; save refuses another Project's Flow
  (`flow_project_mismatch`), and choosing another Project clears a Flow it may not start. Not-ready Flows appear disabled at the end of their group. If the selected Flow becomes not ready, **Open Flow** opens its editor. Esc or ✕ returns to the Trigger with its draft kept. Every Start uses the Flow's
  current saved revision, like New Run.
- **Run on a schedule**, with a number and minutes or hours (1 minute to 24 hours, default every 5 minutes). When off,
  the Trigger checks only when **Check now** is chosen.
- **Max active Runs**, 1 to 10, default 1.

The repository and Flow fields show their own readiness. A problem with `gh` has a card with
**Check again**. The pinned footer holds **Save**, which creates the Trigger off and opens its edit
page, and **Review and enable**, which stays neutral; Save follows the
[one Save rule](design-system.md#components-and-interaction). When another Trigger already watches the same repository, the
form warns before saving, from the warning the backend's readiness answer carries for the repository the form shows: the Project's repository, or the edited Trigger's confirmed one while the Project's remote has moved and the Trigger is not retargeted; the edited Trigger is never named. The review's warning comes from the backend preview, with the same wording. Saving is still available.

**Editing.** The header shows the enable switch and a **status strip**. The strip shows the latest
check, its health, started Runs, issues waiting for a slot, and the next scheduled check, or the
current problem and its repair guidance. **Check now** is available for an enabled Trigger with
no unsaved edits. Runs started by that action can be opened from the strip. A failing Trigger
keeps checking. Factory keeps the latest check and problem.

The pinned footer has **Save** only. Saved-revision and removal notices appear as cards above it.

Triggers follow the [saved-revision rules](#following-saved-revisions) of the other editors: **Updated to revision
N**, **Revision N was saved elsewhere** with **Compare latest revision**, **Load revision N** and **Keep my edits**, and
**This Trigger was removed elsewhere** with the edits kept but no longer savable. Leaving a Trigger with unsaved changes
asks to **Keep editing** or **Discard**, like an Agent. Each settings save and each off-to-on enable advances a
Trigger's revision; disabling, enabling an already enabled Trigger and checks do not.

### Reviewing what starts

Enabling a Trigger, and saving an edit that widens what an enabled Trigger can start, first opens a review: the matching
issues a check would start now, oldest first, each marked **Starts now** or **Waits** for a slot, issues the Trigger
already started left out, a warning when another Trigger watches the repository, and any problem
a check would hit. The backend preview raises that warning for any Project, disabled Triggers included and the edited Trigger excluded, so Studio and [Factory MCP's preview](t3-integration.md#trigger-tools) warn identically. The warnings come from the previewed repository, so they also show when a problem stops the check before it reads issues. Nothing starts before confirming. **Enable and check** enables the Trigger and runs
its first check at once; **Apply and check** saves the edit and checks. Each confirms exactly the settings the review
showed: the preview reports the saved revision it evaluated and enabling names that revision, refused if another
revision was saved meanwhile, in which case nothing is enabled and the review opens again on the current settings; an
edit saves against the revision it started from, so a revision saved elsewhere meanwhile refuses it as a conflict.
Turning a Trigger on advances its revision, so an edit begun while it was off, which needed no review then, is refused
the same way and must be reviewed against the enabled Trigger. **Check now**, **Enable and check** and **Apply and check** then run
only the revision on screen: **Check now** sends the revision it shows, the other two the revision the enable or save returned. A check
refused because another revision was saved meanwhile starts nothing. In the Trigger editor, **Check now** and **Apply and check** show it as the saved-elsewhere notice a stale save shows, unless the editor already follows the newer revision. **Check now** in the list and **Enable and check** open the review again on the current settings as **Check “name”?**, with **Revision N was saved after the revision you checked, so nothing was checked**; after **Enable and check** the Trigger stays on. That review's **Check now** only checks the revision it shows and never turns the Trigger on: a Trigger switched off meanwhile is refused with **Enable this Trigger before running a check** and nothing starts. What a check from a list row started, including one confirmed in that review, replaces the row's earlier result. While creating, the review also offers **Save**, which saves the Trigger off. A later saved revision of the Flow or its Agents applies to the next Start without another review, as in
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
refused. Factory MCP's [Trigger tools](t3-integration.md#trigger-tools) list, read, preview, create, save, enable, disable, check and remove Triggers through the same operations.

| HTTP | Purpose |
| --- | --- |
| `GET /api/triggers/readiness?projectId=&flowId=&triggerId=` | Check `gh`, the Project's repository and the Flow. `repositoryWarnings` carries the same-repository warning, leaving out `triggerId`, for the Project's repository and the confirmed repository of `triggerId` |
| `GET /api/triggers` | List Triggers |
| `POST /api/triggers` | Create a Trigger, saved disabled |
| `GET /api/triggers/:id` | Read one Trigger |
| `PUT /api/triggers/:id` | Save settings against `expectedRevision` |
| `PUT /api/triggers/:id/enabled` | Disable, or enable the `reviewedRevision` a preview showed |
| `POST /api/triggers/:id/run` | Run one check now. The JSON body may carry `expectedRevision`: a Trigger saved or enabled since is refused as a stale-revision conflict, starting nothing. A request without a body checks whatever is saved; a body that is not a JSON object is refused. The reply is the revision checked, with the check's record and started Runs, even when a save or removal landed meanwhile |
| `POST /api/triggers/preview` | Review what a new Trigger would start; starts and saves nothing |
| `POST /api/triggers/:id/preview` | Review what a Trigger, or an edit of it, would start; starts and saves nothing |
| `DELETE /api/triggers/:id` | Remove a Trigger |

A save body may leave out `github.repositoryNodeId` to keep the Trigger's saved repository; with the same Project and query it then saves without calling GitHub. A save that names a repository, even the saved one, is refused with the repository-mismatch issue unless the Project's folder names that repository at save time, and a node id that is not a string, `null` included, is a validation refusal.

A preview body may leave out `github.repositoryNodeId` to evaluate the repository the Project's folder names now. The reply carries the evaluated repository as `repository`. It returns `null` when GitHub could not identify it or when the folder names a different repository from the one requested. A preview of a saved Trigger or edit reports the first blocker in check order, so a Flow or T3 launch blocker takes precedence over a repository mismatch. For a new draft that names a repository, a mismatch takes precedence so the preview cannot offer a repository the user did not review.

## Definition export

**Export JSON** in the Agent editor's **More actions** menu downloads the Agent's latest saved revision, and **Export JSON** in the Flow editor's **More Flow actions** menu downloads the
Flow’s latest saved revision and its complete composition. Factory reads the latest saved revision of the root, every placed Flow and every placed Agent in one transaction, including definitions referenced from unwired blocks and branches a Run may never visit. Source Project availability does not affect the export. The JSON file is named after the definition (for
example `code-reviewer.agent.json` or `reviewed-change.flow.json`); the desktop app saves the same file. A never-saved Agent cannot be exported;
a Flow is saved when it is created. With unsaved changes Studio first asks "Export the saved revision? Unsaved changes won't be included."
(**Export saved revision** / **Keep editing**); either way the editor and its draft are unchanged. `GET /api/agents/:id/export` and
`GET /api/flows/:id/export` answer `{document, driverKindOmitted}`.

Every export writes portable document format version 7, whatever the definition holds:

```json
{
  "format": "t3-factory/definitions",
  "formatVersion": 7,
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

A Flow document has `kind: "flow"`, a `rootFlowKey` and a `flows` list beside `agents`. Each Flow entry has a `key`, `name`, `graph` and `workspace`. Flow keys and Agent keys use the same pattern and have separate namespaces. Each definition appears once. The writer gives the root `flow-1` and numbers the rest in depth-first order of first placement in the saved block lists. It assigns `agent-1`, `agent-2`, and subsequent keys in first-placement order across those Flows. A Flow without Subflows exports one Flow entry and keeps the same Agent order as version 4.

A draft Flow without Finish can be exported as follows.

```json
{
  "format": "t3-factory/definitions",
  "formatVersion": 6,
  "kind": "flow",
  "factoryVersion": "source",
  "exportedAt": "2026-11-21T10:00:00.000Z",
  "rootFlowKey": "flow-1",
  "flows": [
    {
      "key": "flow-1",
      "name": "Review draft",
      "graph": {
        "blocks": [],
        "connections": [],
        "flowInput": { "position": { "x": 0, "y": 0 }, "targetBlockIds": [] }
      },
      "workspace": { "mode": "checkout" }
    }
  ],
  "agents": []
}
```

An Agent block uses `agentKey` and a Subflow block uses `flowKey`. The key names the bundled definition or is `null` when that reference is unset, missing or removed. Flow input can target a Subflow. A Subflow wire's `exitId` is the child ending ID. A wire to the parent Finish also carries the independent `targetEndingId`, which must name an existing parent ending. Renaming a child ending preserves its wires. Deleting it leaves broken wires, even if a new ending shares its name. Drafts with broken child wires, missing references, cycles or no reachable ending remain drafts after import. Readiness identifies where they need repair in the composition.

The file and import request each have a 16 MiB UTF-8 limit. A file can bundle up to 500 unique Flows (including the root) and 500 unique Agents. Each prospective definition save can use up to 2,000,000 bytes, measured with new IDs substituted for keys. A Flow can hold 500 ordinary blocks with no Finish or with an empty Finish or 499 with a nonempty Finish, and up to 5,000 connections. For an existing Flow at the former block limit, Studio still allows edits at that size. Export names the limit and affected definitions if it cannot produce a complete file. These limits apply to portability. Start has its own capture and expansion budgets.

**Format versions.** Import reads versions 1–7 with strict rules for each version. Flow files from versions 1–4 hold a single `flow` and reject Subflow blocks and version-5 fields. Version 2 added Conditions. Version 3 added Finish and its ending connections. Flows from versions 1–2 arrive without Finish. Version 4 added `revisitContext`. In versions 1–3 it defaults to `"keep"`. Version 5 added bundled Subflows and requires Finish on every Flow. Version 6 makes Finish optional in the bundle. Version 7 adds Join blocks, which versions 1–6 reject as an unknown block kind. New exports require a Factory that reads version 7. A newer version asks the importer to update Factory before retrying. The file retains its decoded format version for matching existing receipts.

### Import

**Import** on the Flows list and on the Agents list opens a chooser for a `.json` file; either list accepts either kind of file and the file decides
what is created. Studio sends the file's bytes to `POST /api/imports/review`, which validates it and writes nothing, then shows **Import “*file*”**:

- **Global** or **Project**, and an **Owning Project** when Project is chosen. No helper line. An owner that cannot be used disables **Import** and shows its reason beside the action;
- A warning that imported prompts run with the user's T3 permissions, followed by an inventory of Agent prompts, Continuation prompts and Revisit instructions by Flow and placing block, with character counts.
- **Flows** lists each definition once, with the root first and marked **Opens after import**. Each row gives the block count and every parent Flow and block that places it. Repeated Flow names are numbered in file order throughout the review.
- **Workspace** shows the root workspace used by the Run, including for its Subflows, and each child’s workspace when started on its own.
- **Agents** shows one row per definition with its model select and thinking options. An Agent without a selection shows **Needs a model** and can still be imported.

While the file is read, the dialog shows **Reading the file…**. A file that cannot be imported shows one error card and **Choose another file**.

The review matches each hint against the connected environment's live catalog. Candidates are reporting-capable provider instances of the
hint's `driverKind` that offer its exact `modelId`. The candidate with the hint's `providerInstanceId` wins; otherwise a single candidate wins;
several candidates leave the Agent Ambiguous and none leaves it Unmatched. A hint without `driverKind` matches only a reporting-capable instance
with the same `providerInstanceId` and `modelId`, with no single-candidate fallback. Factory never matches across driver kinds or takes the
first listed candidate, and matches nothing while the catalog is unavailable. A match uses the connected environment's id and keeps the hint's
options the model accepts; the model's other options take their defaults and the hint's remaining options are dropped. Picking a model in the
review applies the same option rule.

Names, prompts, exits, graphs and workspaces arrive as exported. The review lets the importer choose an owner and models. **Cancel** writes nothing. **Import** remains enabled with missing models or when T3 is disconnected. It sends `POST /api/imports` with the document, a reviewed selection per Agent key (complete settings or `null`), a request id and an optional target `projectId` (Global when omitted).

Factory validates the document again and applies the ordinary Agent save rules to the selections. It allocates fresh identities for all definitions before writing graphs and saves every copy at revision 1 in a single transaction. All copies have the chosen owner. Project overrides are dropped. The graph uses IDs from those copies, including shared children and back-references to the imported root. Studio opens the new root or the imported Agent once its live lists hold it. Factory MCP exports, reviews and commits through the same operations ([authoring tools](t3-integration.md#authoring-tools)). An unrelated unsaved Flow draft still asks **Keep editing** or **Discard changes** first.

- If the chosen provider is listed by T3 but has lost Factory reporting support, Factory refuses the commit and names the affected Agents. A provider T3 does not list, including while the catalog is unavailable, never refuses a commit.
- Every Import in one dialog reuses its request id. Retrying after a lost answer returns the original result, including IDs of definitions removed since. The same id with different content or another owner conflicts. A replay still works after the target Project becomes unavailable. Choosing a file again starts a new import, so two deliberate imports create two
  independent copies. See [import receipts](foundation.md#persistence-model).

Factory checks the format and version, then Agent count and Flow count, then unknown or missing fields. It checks well-formed, unique keys in each namespace, verifies that every key resolves, and requires a known root, reachability of every bundled Flow and use of every bundled Agent. Ordinary definition validators run next, followed by the 2,000,000-byte prospective save limit. Rejections distinguish these cases.

- not JSON (the file is not UTF-8 JSON);
- not a Factory export (no `t3-factory/definitions` marker);
- unsupported format version N, which asks to update Factory when N is newer;
- an invalid definition, field-addressed (for example `agents.0.prompt` or `flows.1.graph.blocks.2.position`) and naming the Agent or block;
- over a limit, HTTP 413: an import request or file over 16 MiB, more than 500 bundled Agents or Flows, or a definition save over 2,000,000 bytes.
- not received completely (`document_unreadable`): the upload broke off before its body arrived. Only a body over the limit is reported as too large.

Rejections write nothing and never repeat prompt text. A rejected review offers **Choose another file**.

## Validation contract

`PUT /api/flows/:id` and `POST /api/flows/:id/validate` take
`{name, expectedRevision, expectedProjectId, graph, workspace}`; `expectedProjectId` is the owning Project the client last
saw, or `null` for a global Flow ([Ownership](#ownership)); both refuse a stale one with `stale_owner`, so a readiness answer
is always judged under the owner the client sent. `workspace` is `{mode: "checkout"}` or
`{mode: "worktree", base: {kind: "default"} | {kind: "ref", ref}}`; a custom ref is trimmed and
must be 1–255 characters without whitespace, control characters or a leading `-`, and its
issues use `workspace.*` paths. A save that omits `workspace` keeps the saved setting.

`POST /api/flows` accepts a name and optional `graph`, `workspace` and `projectId` ([Ownership](#ownership)). Creation validates the supplied graph and workspace and stores them atomically as revision 1; a rejected creation leaves no Flow or revision. Without a graph it creates an empty Flow, and without a workspace it uses a new worktree from the default branch. Studio's **New Flow** sends only the name; [Factory MCP authoring tools](t3-integration.md#authoring-tools) can create a Flow with its graph and workspace in one call.

### Graph shape

Blocks have stable IDs, position and name. On create or save, positions are optional for every block, the Flow input and the Finish block. If any position is omitted, the backend arranges the whole graph with the same ELK layout as [Auto-arrange](#automatic-layout-and-canvas-view), replacing even the supplied positions. Fully positioned graphs are saved as given. Saved graphs always include all positions; Studio sends them all, so its saves preserve the draft's layout.

An Agent block adds `agentId`, `hiddenExitIds` (inherited exit IDs it hides), `localExits`, `revisitInstruction` and `revisitContext`. `revisitInstruction` is its
[Revisit instruction](../GLOSSARY.md#revisit-instruction): plain text up to 120,000 characters, optional on create and save, stored trimmed,
and empty when omitted or whitespace-only. `revisitContext` is `"keep"` (the default when omitted) or `"fresh"`, choosing whether later visits continue the existing provider session or start a fresh session on the worker thread without earlier context. Readiness never requires either or warns about them, even on a block that cannot be revisited. A Human block has
no exit fields. A Wait block adds `duration`: `{amount, unit}` with any finite number as `amount` and `unit` `minutes`,
`hours` or `days`, or `null` while the draft has none; a Continuation adds `prompt` (stored trimmed, up to 120,000 characters, empty only in a draft). Each has one fixed, unnamed exit with ID `output`. An exit is `{id, name, description, messageRequired}`, with IDs scoped to their block; runtime consumers enforce a non-empty message when
`messageRequired` is true. A Condition adds `rules`, an ordered array of `{id, name, fromArrival}`, and
`otherwise: {id: "otherwise"}`. A rule `name` is stored trimmed and may be blank in a draft; `fromArrival` is a whole number from 1 to
9,007,199,254,740,991, the largest integer JSON numbers and the stored definition hold exactly, or `null` while the draft has none. Its
outputs are the rules in order, then **Otherwise**; a rule ID is unique within the block and never `otherwise`. A `join` block (`kind: "join"`) carries no field beyond `id`, `name` and `position`: it is configured by its name only, has one fixed, unnamed exit with ID `output` and allows ordinary fan-out, and its sources are derived from the connections that enter it. Each distinct block wired into it is one **slot**, and every exit or output of that block that is wired in fills that one slot, so mutually exclusive exits never deadlock it; slots are ordered by the Flow's block array, not by wire order. Start freezes the Flow revision, so a later rename changes neither the slots nor their labels in a Run. A Join waits for every slot. A `subflow` block carries `flowId` (a saved Flow ID or `null` in an unfinished draft) and no Agent, Wait, Continuation or Condition fields; its exits are the referenced Flow's Finish endings by ending ID, and `flowInput.targetBlockIds` admits both Agent blocks and Subflows. Connections identify source block, exit ID and target block, and for a wire into the [Finish block](#finish-block) also the ending (`targetEndingId`): a Human block's exit is `approve` or `request-changes`, a Wait's, Join's or Continuation's is `output`, a Condition's is a rule ID or `otherwise`, a Subflow's exit is resolved against its referenced Flow's Finish endings by readiness, and an Agent block's
exit is resolved against its Agent by readiness, not by the save. No block execution settings or prompt overrides are accepted.

#### Flow input block

Every graph carries exactly one `flowInput`: a canvas `position` and the `targetBlockIds` of the Agent blocks it feeds (each at most once). It has no work execution state; on a Run's [execution canvas](runs.md#execution-canvas) the Flow input card may carry the Run's [title generation](runs.md#run-title-generation) line, which describes the Run's title, not Block work, and Studio's Flow editor shows nothing of it. Targets are distinct Agent blocks; Human, Continuation, Condition and Join targets are rejected (a Join with `flow_input_join`). A Wait target saves but is a readiness gap (`flow_input_wait`): a Wait never starts a Run. Every path a Run can take into a Continuation or Condition therefore passes an Agent, a Subflow or a Join; only an Agent's result is bound to a worker thread ([readiness](#validation)). A new Flow has no Flow input targets; removing a block also removes its target reference. Reachability starts at every Flow input target. Initial activations are independent, are not Handoffs and receive the same prompt; a failed or uncertain activation creates its own Problem while other branches can continue.

#### Finish block

A saved graph carries at most one `finish`: a canvas `position` and its ordered `endings`, each
`{id, name, description, output, outputDescription}` ([Ending](../GLOSSARY.md#ending)). `output` is `none`, `optional` or
`required`; `outputDescription` says what the output should contain and is empty when unset. A wire into an ending is
`{sourceBlockId, exitId, targetBlockId: "finish", targetEndingId}`; the API uses `targetEndingId` to distinguish an ending
from an ordinary Block target, including a Block whose ID is `finish`. Any exit or output may enter an ending, including Human **Approve** and **Request changes**, Wait and
Continuation outputs and every Condition output with Otherwise, several wires may enter one ending, and a rename keeps the wires
because they enter by ID. A create or save that omits `finish` saves the Flow without a Finish block, so wires into endings are refused;
a `finish` without a `position` is placed one layer right of every block, level with the Flow input. A save that adds a Finish block counts it toward the 500-block limit, so a Flow
already at 500 blocks cannot add one. Upgrading hides legacy Finish blocks without endings and preserves their stored positions. A top-level Flow can be ready without endings. A Flow placed as a Subflow needs a reachable ending. Reaching an ending ends the Run ([Reaching an ending](runner.md#reaching-an-ending)). Studio edits the Finish block as described in
[Canvas and block configuration](#canvas-and-block-configuration).

### Validation

Structural failures return `Result` errors with `code`, `path` and `message`: invalid or duplicate IDs and names,
positions, Flow input targets, dangling or duplicate edges, a Human, Wait or Join connection from another exit, malformed exits, hide entries or Wait durations (an amount that is not a finite number, an unknown unit), and unknown block, exit, graph or Flow input fields, including Agent fields on a Wait. The Finish block is refused for a missing,
blank or repeated ending ID (`invalid_ending_id`), an ending name over 200 characters after trimming, a description or output
description over 4,000 characters, an unknown output setting, extra Finish or ending fields, a wire into Finish without one of its
ending IDs or a `targetEndingId` on a wire into a block (`invalid_connection`), two wires from the same exit into the same ending
(`duplicate_connection`) and a Flow input directed to Finish (`flow_input_finish`) or to a Join (`flow_input_join`). A Condition is refused, never coerced, rounded or reordered, for a threshold that is not a number, not whole, below 1 or beyond the largest exact integer (`invalid_condition_threshold`), a repeated rule ID or one equal to `otherwise` (`invalid_condition_rule_id`), a missing or altered Otherwise (`invalid_condition_otherwise`), extra rule fields and a wire from an output it does not have. A `revisitInstruction` that is not a string, is longer than 120,000 characters after trimming, or is on a block other than an Agent block is refused at that block's `revisitInstruction` path. A `revisitContext` that is not `"keep"` or `"fresh"`, or is on a block other than an Agent block, is refused at that block's `revisitContext` path. Limits: 500 blocks with a Finish block counted as one, 100 endings, 100 local exits and 100 hide entries per block, 100 exits per Agent, 5000 connections, coordinates −10000 to 10000, bodies up to 2 MB. See [portable definition limits](#definition-export) for legacy files and Flows at the former block limit.
A Condition has no rule or output quota of its own and does not borrow the Agent exit limit: it counts as one block, each actual wire
from any of its outputs, including fan-out and Otherwise wires, is one connection, unwired outputs cost nothing, and its rule IDs,
names and thresholds count toward the 2 MB body.

Unfinished names, unset Agents, an unconnected Flow input, blocks without exits, local exit name or ID collisions and wires from hidden or removed exits can be saved.
Readiness reports these gaps (`flow_input_required`: connect the Flow input to at least one Agent; `agent_model_required`; `agent_scope_mismatch`, which a save also refuses; `continuation_prompt_required`; `exit_name_conflict`, `exit_id_conflict`, `exit_hidden`, `exit_missing`), a Wait
without a duration (`wait_duration_required`) or outside 1 minute to 7 days inclusive after converting its unit, including a zero or negative amount (`wait_duration_range`), a Wait Flow input target, missing saved
Agents, blocks unreachable from the Flow input,
a Condition rule without a name (`condition_rule_name_required`) or with the name of another of its outputs, Otherwise included
(`condition_rule_name_duplicate`), without a threshold (`condition_threshold_required`), never selected because an earlier rule
already matches from an equal or lower arrival (`condition_rule_shadowed`), or from arrival 1, which leaves Otherwise unreachable
(`condition_threshold_first_arrival`), each at its rule row, every unconnected Condition output (`condition_output_unconnected`, at
its rule row or, for Otherwise, at the Condition, naming the output), and every directed cycle through a Condition made only of Conditions
and Continuations, whichever outputs its wires leave by (`condition_cycle`, at the Condition, naming the cycle): a Continuation may
already pass messages straight through, so such a loop could circle without work. A Join needs wires from at least two distinct blocks
(`join_sources_required`: several exits of one block still fill one slot) and a wire from its output (`join_output_unconnected`), each at the
Join. A directed cycle that contains a Join and consists only of Joins, Conditions and Continuations, self-loops included, is not ready
(`join_cycle`, at the Join, naming the cycle); `condition_cycle` keeps its own meaning for cycles without a Join. A Continuation is refused
(`continuation_worker_required`, at the Continuation) when any message that can reach it has no worker thread: a Join's output is unbound
and an Agent's result is bound, while a Wait, Condition or Human step passes on what it received, and through a Subflow each child ending
is followed separately by whether the message that reaches it came from an Agent or from a Join. Each Finish ending needs a name
(`ending_name_required`), a name no other ending has (`ending_name_duplicate`; duplicate ending names are a readiness gap, unlike
local exit names) and at least one incoming wire (`ending_unconnected`), each at its ending row. A ready Condition's thresholds therefore
strictly descend and are at least 2, and each of its outputs is wired; one with only a wired Otherwise is ready. Readiness resolves each block against the current saved Agents. Of an Agent's execution settings readiness learns only whether
they are present, never their live availability, so one Agent never reports both `agent_model_required` and the `settings_unavailable` Start gate. Hide entries for exits the Agent no longer has are ignored. An
Agent or Human step exit, a Wait output and a Continuation output need no edge: unconnected, they stop the branch without warning; other cycles, including loops through an Agent, Human step or Wait and loops of Continuations alone, self-loops and independent fan-out are allowed. Graph readiness does not claim T3 capability or live execution readiness.

Readiness depends only on the graph, the Flow's owning Project and the saved revision and owning Project of each Agent it places, because an Agent's exits and former exit names
are fixed per revision while its owner is not part of a revision. Validating unsaved content (`POST /api/flows/:id/validate`, Studio's live readiness check) resolves it under the saved
Flow's owner and therefore also answers `agentRevisions`: `{revision, projectId}` of each placed Agent by id, `null` for a missing one, against which that readiness was resolved, so a
client can compare it with the Agents it shows and discard an answer after an owner change that appended no revision.

### Revisions

Each successful create or save appends one immutable Flow revision whose name, graph and
workspace setting are stored as rows owned by that revision; Studio reads the latest revision of each Flow that is
not removed, and `revision` is that revision's number. An update compares the expected revision
and owning Project atomically: a stale or invalid request returns an error and appends nothing, and an accepted save
advances the revision exactly once. Within a revision, connections reference blocks and Finish endings of the same
revision, and the Flow input targets blocks of that revision. Start captures the Finish block and its endings with the rest of the
revision, so a later save never changes the endings a Run uses.
Agent references are resolved against saved definitions at read time, so a draft may still name a
missing Agent. Stored shapes follow the
[stored-data migration rules](foundation.md#sql-migrations). Start references the current
revision and freezes the referenced Agents' revisions; Auto-arrange and input-port presentation do not change
validation semantics. [Removing a Flow](#removing-a-flow) keeps the revisions Runs reference.
