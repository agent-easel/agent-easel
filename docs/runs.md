# Starting and observing a Run

## Starting

Open **New Run (+)** (`/runs/new`; the Flow editor's **Start Run** opens a fresh composition with its saved Flow selected). Choose an
available project, a ready Flow that may start there (a global Flow, or a Flow
[owned by](studio.md#ownership) that Project) and a required initial prompt. Factory checks the project and connection, the Flow's
[readiness](studio.md#saving-and-readiness) against the current saved Agents, every referenced Agent's settings, reporting
installation and explicit-call API compatibility before accepting Start.
Failures explain recovery and keep the draft. Start collects setup problems for every referenced Agent,
including later branches, labels each cause with its Agent and offers reporting, Studio or connection
repair actions. Agent checks and launch capability inspection use the same Start preflight; no worker
is launched on rejection. For a Flow whose [workspace setting](studio.md#workspace-setting) is a new worktree, Start
resolves the base in the selected Project's repository on the Factory host: the default branch from `origin/HEAD`, or the
custom ref verified as a commit, read through bounded `git` calls without a shell. A missing ref, an unset default branch or
a T3 endpoint that is not on this computer rejects Start with a `workspace.*` issue and the **Open Studio → Flows** repair
action; no Run, Task or worker is created. Correct configuration, accepted Start and accepted Block result are separate
levels of evidence. A configuration check alone proves neither execution nor report acceptance.

- **Ownership.** Start refuses a Project Flow in any Project but its owner (`flow_project_mismatch` at `flowId`) and,
  in its owner, while that Project is unavailable for any reason, with the Project's availability reason
  (`project_<availability>` at `projectId`, such as `project_directory-unavailable`). A placement the
  [placement rule](studio.md#ownership) forbids is a readiness issue (`agent_scope_mismatch`), so Start refuses it too.
  Factory checks the Flow's and every placed Agent's owner again inside the acceptance transaction: an owner change
  while Start was validating refuses it with a conflict. No refusal creates a Task, Run or worker. Ownership adds no
  model or environment check; every other Start gate applies unchanged.

Worktree Runs require T3 to advertise the boolean `workspaceStrategy.startFromOrigin` option.
Update T3 before using worktree Flows with this Factory version. If its launch schema lacks
that option, Factory rejects Start with `launch_unsupported`. Project-checkout Flows do not require it.
T3 owns the fetch and checkout during [worktree preparation](runner.md#run-workspace), after Start is accepted.

- **Screenshots.** Pasting images (Ctrl+V/Cmd+V) at the prompt caret or dropping image files on the prompt field attaches
  them and inserts a clickable reference to each at the caret (a drop uses the last caret position, or the end of the
  prompt). **Attach images** attaches files without inserting references. Images are PNG, JPEG, GIF or WebP files, up to 8
  images of 1 byte–10 MiB each, sent unchanged (no recompression or resizing). The field shows thumbnails with remove
  controls; a thumbnail or reference opens a full-size preview. A reference shows the image name with its size and points
  to the attached image itself, so references to different images with the same name stay distinct. Each unsupported,
  oversized, excess or unsavable file is rejected with its name and reason; valid files and existing attachments stay.
  Identical bytes attach once: pasting or dropping them again inserts another reference to the attached image without
  using another slot. Different files with the same name stay separate images. Removing a thumbnail removes that image
  and every reference to it; deleting a reference from the text keeps its image attached and delivered. Start still
  requires prompt text: references alone do not count, and a line holding only references does not supply the automatic
  title. At Start the composer uploads every image Factory does not
  hold yet, then sends the request; Factory accepts it only with every image uploaded and attaches them to the Run in
  order. Each Flow-input worker receives the same original images with its first message, named `image-N-<name>`, and
  the Run's input text spells each reference as `[Image N: name]` in place and ends with `Attached images:` listing every
  image, referenced or not. Later Blocks, revisits and Request report turns remain text-only. Every worker, including
  during later user conversations, can discover the initial images and retrieve relevant originals through
  [read-only Factory MCP access](t3-integration.md#run-image-reads). The immutable image labels keep the same meaning
  across visits. An image Start needs a T3 that accepts uploaded
  launch attachments; otherwise it is rejected with "update T3 or remove the images" and nothing is created. Images are
  part of the Run's input and stay with it after Settle and Archive.
- **Task and Run.** Each Start creates a new Task and its Run, both named with the draft's chosen title: a manual title, or
  else its first non-empty line of prompt text limited to 500 characters. Start also carries the draft's creation time, which becomes
  the Run's creation time; the Run's start time is when Factory accepted it. Factory rejects a blank or over-500-character
  title (after trimming) or a creation time not in `Date.toISOString()` form (for example `2026-11-07T08:00:00.000Z`),
  and creates nothing.
- **Title provenance.** Start also carries how the title was chosen, and the Run keeps it: automatic for a draft never
  renamed, manual for a renamed draft, even when its title equals the prompt's first line. A draft or pending request
  saved before provenance existed submits legacy rather than a guess, as does a request that omits it. Start rejects any
  other value, including generated, and creates nothing. Run detail and navigation expose the provenance.
- **Title generation.** With **Generate Run titles** on, Start decides once, when it accepts a Run, whether
  [Run title generation](#run-title-generation) applies; the decision never refuses or delays Start.
- **Idempotency.** A draft's id is its Start request key, so one draft yields at most one Run. A confirmed rejection
  records nothing, so the corrected draft is sent again with the same key. Retrying an accepted request returns the same Run,
  even after a lost response or restart, with its original title provenance; reusing the key with changed content,
  including title, a change between manual and another title provenance, creation time or the images' bytes, order,
  names or positions, conflicts. Automatic and legacy requests keep the identity requests had before provenance existed,
  so a pending request or `factory_start_run` accepted then still recovers its Run with its stored provenance. An unknown response keeps the
  submitted fields and images read-only (previews still open) and offers **Check same request**, which uploads missing
  images again and repeats the same request; only confirmed success clears the prompt and opens the Run. If Factory
  reports an image missing at acceptance, the composer uploads it again and retries once automatically; a further
  failure keeps the request locked for another check.
  The submitted request is saved in browser storage before it is sent, so reloading or reopening the client during an
  in-flight or unknown Start offers the same check instead of a fresh request. It is kept with its draft, so each draft has its
  own pending request, and per selected Factory server (a desktop client never checks it against another server); it is
  removed after a confirmed acceptance or rejection. When
  storage is blocked, the unknown-outcome notice says the request survives only while the window stays open.
- **Concurrency.** Every Start creates its own Task, so Start never waits for, reuses or is blocked by another Run. Checkout
  Runs work concurrently in the shared project checkout; each worktree Run works in its own worktree. A Run stays Active, including unresolved work, until it
  [settles](#settled-runs) or is [archived](#archive).
- **Captured definitions.** The Run keeps its immutable input and references the Flow revision it started with, including
  its workspace setting, and the revision of every Agent that Flow references, frozen at Start. Every read and every later activation, also after restart,
  uses those revisions: the full graph and each Agent's prompt, settings and labels, a global Agent's settings being its
  [Project override](../GLOSSARY.md#project-override) for the Run's Project when it has one. Captured execution settings are always
  complete: Start rejects a Flow that places an Agent that [Needs a model](../GLOSSARY.md#needs-a-model) through its
  readiness (`agent_model_required`), and a launch or recovery never reads a model-less revision. Agent edits need no Flow save: the next
  Start uses the current saved Agents. Later edits and removals affect only future Runs, and so do later owner changes
  and the owning Project becoming unavailable. Captured definitions carry no owner, so Run detail and the Run list
  show none.
- **Launch.** Factory launches one top-level worker per Agent block visit, using that Agent's saved provider, model and
  options. Agents connected to the Flow input start in parallel and independently (no Agent is told about the others). There
  is no Run conversation. A lost launch is searched for by its saved title and verified thread evidence; Factory does not
  launch a second worker for it. A definitive rejection is an error. Other workers keep going.
  Factory works in the Run's workspace: the project root, or for a worktree Flow one worktree that all of the Run's
  workers share ([Run workspace](runner.md#run-workspace)). It omits `runtimeMode` and leaves execution permissions to T3
  and its OAuth grant, so effective autonomy is not guaranteed by Factory. Use a repository you are willing to let agents
  change.
- **Composer.** Project and Flow choices are remembered locally per selected Factory server, like drafts. One card under the
  box explains the single blocking condition; the field that causes it shows only its border and a short tag, and nothing
  sits under the box while Start can run. An empty prompt leaves Start disabled, and ⌘↵ does nothing. The Project picker
  keeps searchable paths, **Recheck projects** and **Add repository**; unavailable references stay visible in history but
  cannot be selected for a new Run. With no saved T3 address the card is **Connect Factory to T3** (**Open T3 connection**),
  Project and Flow are disabled, and the sidebar footer shows no connection dot or status. A connection that was saved and
  then lost is **T3 is disconnected**: the draft is kept, Project and Flow show their last known values, and Start returns
  when Factory reconnects. When the browser loses Factory the card is **Factory offline** and keeps the draft, without a T3
  settings link. A connected catalog with no available Project reads **No projects in T3** and its card offers **Refresh
  projects** and **Open T3**. A rejected Start's card body is **No Run was created.**, with one row per cause.
- **Flow picker.** The Flow picker is disabled until a Project is chosen. With a Project it lists ready global Flows
  under **Global**, then ready Flows owned by that Project under its title; a chosen Flow that stops being ready stays
  listed and marked **Not ready**. Switching Project keeps a global Flow or a Flow of the new Project and clears a Flow
  owned by another Project. Clearing the Project clears the Flow, and neither New Run nor choosing a Project again
  restores it. These clears are silent: the composer shows no notice or label, and the prompt and images always stay.
  The Flow editor's **Start Run** on a Project Flow selects its owning Project; on a global Flow it uses the remembered
  Project, or with none shows the Flow in the disabled picker until a Project is chosen. Start stays disabled for a Flow
  the selected Project may not start.
- **Drafts.** Typing a prompt with a non-whitespace character or attaching an image creates a Run draft; removing all
  text and images removes it. A draft with images but no text is listed as **Untitled draft** and cannot Start. Image
  bytes are kept in the browser's IndexedDB per selected Factory server and draft, saved before the draft refers to them;
  opening the composer deletes bytes no draft references, and discarding a draft or a confirmed Start deletes its images.
  Drafts save silently while typing, without a T3 connection or ready choices, and the current composition is restored after a
  reload or reopening the client. A draft keeps the exact prompt and Project/Flow references only; Start resolves the current
  saved Flow and Agents. Drafts live in browser storage per client and selected Factory server; tabs sharing a profile share
  them, and the last save wins, except that another tab's unresolved Start is never overwritten or removed: the stale tab
  reopens that draft instead. If storage is blocked the composer says the draft lasts only while the window is open.
  **New Run** (button, shortcut or palette) opens an empty prompt with the remembered choices and keeps earlier drafts; the
  Flow editor's **Start Run** does the same with its Flow. Project and Flow choices update live; while they are
  synchronizing or offline the last choices stay visible, the draft is kept and Start is disabled. A Start issued while
  current still sends its image uploads and request if a catch-up begins meanwhile; going offline stops it. A selected Project
  is cleared when a current live delivery no longer lists it or lists it as unavailable for a reason other than the
  connection being down, and a Flow when current choices no longer list it or show that another Project owns it, including
  in a restored draft, which keeps its prompt and images. A connection outage keeps the last known Project and Flow. A
  non-current or failed delivery changes nothing, and choosing a just-created Project or Flow waits for the delivery that
  lists it. A draft awaiting a Start outcome is never cleared: its sidebar row shows the Idle ring and no Draft label until
  T3 confirms, **Check same request** sends the submitted request unchanged, and Factory
  resolves it by request key and content before any ownership, availability or readiness check. Confirmed Start removes the draft and opens its Run; a confirmed
  rejection keeps it editable. A draft's title follows its first non-empty prompt line until it is renamed; a manual title
  survives prompt edits, reload and other tabs' saves, and a title or selection alone never creates a draft.

### Run title generation

**Generate Run titles** is an installation-wide setting, off on new and upgraded installations. Turning it on needs a T3
provider instance and model, with options, that the live T3 catalog offers (a provider whose harness cannot report to
Factory is refused); an unknown instance, model or option is rejected and the setting is unchanged. Turning it off keeps
the chosen model. Only the Factory host changes it (`PUT /api/settings/run-titles`); approved clients read it, with its
latest diagnostic (`GET /api/settings/run-titles`).

**Settings → Run titles** holds the setting. The host can switch generation On before choosing a model.
The Worker rows unlock, and the header shows **Not saved yet** until the host chooses a provider.
Factory selects that provider’s first model and saves the setting. Switching Off keeps the Worker and
disables its rows. Choices come from the live T3 catalog. A choice T3 no longer offers is cleared from
its field and shows **Needs a model**. The latest diagnostic appears as an Info card with the Run,
outcome, time and **Technical details**. Approved clients see read-only values under **Managed on the
Factory host**. The section reads the setting each time it opens.

The shared Start operation, used by the composer, by `factory_start_run` and by a confirmed
[Chat control](chat-control.md#actions) Start, makes the decision, so every Start path behaves the same. A Run is eligible only when the setting is on at acceptance and its title provenance is automatic; manual and
legacy Runs record no generation. An eligible Run captures the provider instance, model, options, built-in prompt version
and an absolute deadline 30 seconds after acceptance, and records its generation in the acceptance transaction:

- **pending** when every check passes: T3 is connected and authorized, the catalog offers the provider instance, model
  and options, launch is supported and Factory MCP is installed for that provider (an instance disabled in T3 has no
  [reporting installation](t3-integration.md#installation-actions), so it fails here);
- **skipped** with that check's reason when one fails; the reason also becomes the setting's latest diagnostic, with the
  Run and outcome, until a later diagnostic replaces it or a generated title is applied;
- **skipped** without a diagnostic when the prompt has no letter or digit, counting `[Image N: name]` labels as text, or
  when the setting changed between these checks and acceptance while staying on.

The checks run beside the other Start checks; their failure never refuses Start. A replayed Start returns its Run with
the original provenance and generation and decides nothing again. A Run generates at most once and only at Start; there
is no regenerate, and later setting changes, including turning it off, affect only future Runs. Run detail and
navigation, including live navigation, carry the generation's state with a short reason, captured model label, deadline,
automatic title, generated title and T3 thread link, or none.

A pending generation launches one [title thread](t3-integration.md#title-threads) beside the Flow: the Flow input
targets dispatch as they would without it, and the title thread never gates or delays them. Just before the launch
Factory runs the eligibility checks again; a failure records **skipped** with that check's reason as the setting's
diagnostic and launches nothing. The model submits a title with `factory_set_run_title`, and the generation ends with
exactly one outcome:

- **applied** when the first valid title arrives before the deadline while the title provenance is still automatic: the
  Run takes it and its provenance becomes generated;
- **dropped** when the Run is renamed first, even to its automatic title; the owner's title stays;
- **timed out** when the deadline passes first, also when Factory was not running then or the launch's outcome is
  still unknown;
- **cancelled** when the Run is archived or confirmed for manual settlement first, in the transaction that closes its
  handoff gate, whether or not the launch was sent;
- **failed** when T3 definitively rejects the title thread's launch, or the title thread finishes without a valid title
  before the deadline.

Every outcome but applied keeps the current title, and a later submission is refused without changing the outcome.
Automatic settlement is not an outcome, so a title can still land on a Settled Run before its deadline; turning the
setting off cancels nothing. Once an outcome is recorded Factory stops the title thread if it may still be running and
settles it in T3 once it finished, best effort; the [Runner](runner.md#run-title-generations) owns the deadline,
cancellation, restart and cleanup rules. Restart never launches a title thread twice.

Applying a generated title is like Rename: it is not Run activity and moves no row. It also
clears the setting's diagnostic, because it shows the setting works. A timed-out or failed outcome records its reason as
the setting's latest diagnostic in the transaction that records the outcome; dropped and cancelled are owner actions
and record none. Like every outcome they are quiet, raising no Problem or attention. The title thread is not a
Block or worker: it never counts toward settlement, Needs input, attention, Problems, missing reports or Block
readiness, so a Run can settle while its title is still pending.

The Run shows its generation without treating it as Flow work:

- While it is pending, **Generating title…** pulses next to the title on the Run's sidebar row and in the top bar. Any
  outcome or Rename removes both, and nothing stays next to the title afterwards.
- On the [execution canvas](#execution-canvas) the Flow input card of a Run whose generation was launched or skipped
  carries one read-only line for the life of the Run: ✦ **Title**, its state, then the applied title or the outcome's
  reason (for example **Title · applied · Exact matches first in search**). It has no port, visit or exit; manual,
  legacy and setting-off Runs show none. Pending uses the working color, applied the success color and every other
  outcome the neutral stopped color, never the error color.
- Pressing the line shows the **Run title** in the Run inspector: state and reason, model, deadline,
  automatic and generated titles, and **Open in T3 ↗** once the title thread is known. It selects no Block,
  highlights no Block timeline rows and leaves **Follow active** as it was; the card takes a lighter inspected outline
  instead of the selected-Block border. Escape, the breadcrumb or close button returns to the overview, and selecting a
  Block shows that Block.
- The timeline records **title generation started** when the title thread's launch is sent, then exactly one outcome
  event; a skipped generation records only its skipped event. These rows name the Run, marked ✦, as the actor and link
  the title thread once it is known, including a thread bound after the outcome. They are not Run activity.

**Decision: Run titles are generated by an installation-level T3 thread outside the Flow; status is shown on the Flow
input card.** Factory has no LLM connection of its own, so a short-lived T3 thread with a cheap model writes the title.
Keeping it outside the Flow leaves Flows, captured definitions and Studio unchanged, lets the Flow start at once and
keeps a cosmetic step out of settlement, attention and Problems. Its status belongs with the Run's prompt, so the Flow
input card carries it rather than a Block.

### Starting from a conversation

A T3 conversation on the Factory host, including one driven from a phone, can start a text-only Run through the [Run Start tools](t3-integration.md#run-start-tools), normally by the user invoking the [`factory-start-run` skill](installation.md#optional-skills). It shares the composer's Start operation, readiness gates, captured definitions, workspace behavior and idempotency; its title is the prompt's first non-empty line with automatic provenance and its creation time is when Factory first accepted the request. It has no draft, images or per-Run workspace override. Unless the skill has seen **Generate Run titles** reported off, its review adds one line saying the title may be replaced by a generated title; the receipt still reports the accepted automatic title, and generation then applies as for any automatic Run.

The receipt carries the Run id and number but no link, and the conversation has no Block id, so it cannot use the Block
runtime tools to watch progress. Open the Run in Factory, or read it on the host with `GET /api/runs/:id`
([Run HTTP API](#run-http-api)).

### Starting from a Trigger

A [Trigger](../GLOSSARY.md#trigger) starts Runs for a Project's GitHub issues without anyone composing them.
It is set up and managed in [Studio → Triggers](studio.md#triggers); this section describes what a check does.

- **Check.** A check of a GitHub Issues Trigger first confirms that its Project is still host-local, its Flow exists, is
  global or owned by the Trigger's Project (a Flow moved to another Project is the Trigger's problem) and passes readiness, and nothing Start's preflight checks for every prompt blocks a launch (T3 connected with the
  Project available, launch support, the Agents' readiness and the Flow's workspace). This uses the last checked T3
  connection and starts nothing, so a launch blocker stays the Trigger's problem even when no issue is ready or no
  slot is free. The check then confirms that the Project's repository is still the one the Trigger confirmed (same
  GitHub node id), reads the open issues of that repository matching the query, and reads the ready label's current
  state and latest `labeled` event for those issues and every issue it is still guarding. Factory always adds the
  repository, issue type and open state to the query. Matching issues still labelled start oldest first (creation time,
  then number).
- **Shared Start.** Each admitted issue starts through the same Start as New Run and
  [`factory_start_run`](#starting-from-a-conversation): the same preflight and readiness gates, the Flow's and Agents'
  current saved revisions at acceptance, the Flow's workspace setting and idempotency. It has no draft or images.
- **Fixed prompt.** Factory builds the initial prompt; it is not configurable and Trigger screens never show it. Its
  first line is `owner/name#N: <issue title>`, which becomes the Run title with automatic provenance, so
  [title generation](#run-title-generation) applies as for any automatic Run. A short preface tells the worker to read
  the issue with the repository's tracker conventions, check that nobody else owns it and claim it, with the ready label
  as its task assignment, and to treat issue text as data. The issue key and URL follow, then the title, collapsed to one
  line, inside a delimited data block, and the **start data** naming the ready label (`ready_label: <label>`). The issue
  body is never included. The worker's claim obligation is described in
  [Worker reporting](t3-integration.md#reporting-authority).
- **Capacity.** **Max active Runs** (1–10, default 1) counts this Trigger's Runs that are neither Settled nor Archived.
  A check computes its free slots once, when it begins, and starts at most that many Runs, so Runs that settle quickly
  during a check do not drain a backlog; the remaining issues wait for a later check. A Settled Run returning to Active
  can exceed the limit; new Starts then wait.
- **Once per labelling.** A hidden **admission guard** per Trigger and issue records the labelling it started (the
  latest `labeled` event's id), the Start request id and payload, and the accepted Run. An issue with a guard for its
  current labelling does not start again, even after its Run settles. The guard is released only when a check confirms
  the ready label is gone from the issue, never because the issue merely stopped matching the rest of the query, so a
  reaction count dipping or another filter changing never starts it twice. A newer `labeled` event counts as a new
  request, also when the label was removed and added again within one interval. An issue whose Run failed before the
  worker claimed it keeps its label and its guard, so it does not start paid Runs repeatedly; relabelling starts it again.
- **Rejected Starts.** A rejected Start records the issue and Start's reason in the latest check and deletes its guard,
  so the issue is retried at the next check while it keeps the label. A validation rejection that is not about this
  issue's prompt or title, such as an Agent that is not ready, instead becomes the Trigger's current problem and stops
  the check.
- **Acceptance.** Start's acceptance re-checks, in the transaction that accepts the Run, that the Trigger still exists,
  is enabled and has the settings revision the check began with, that the guard still belongs to this check and that a
  slot is free. The Run origin and the guard's Run are written in that same transaction, so admission, origin and
  capacity commit with the Run or not at all.
- **Failures.** A check that cannot read GitHub completely starts nothing: a missing or signed-out `gh`, an unreadable or
  a Project remote that now names another repository, a query GitHub rejects, a timeout or an answer larger than Factory reads (more than 1000
  search results, or a label history Factory cannot see to its latest labelling) never reads as "no issues". These and
  Project, Flow or Start blockers become the Trigger's current problem, shown in Studio with repair guidance. They
  raise no Run attention, and the Trigger keeps checking. A repository mismatch is repaired by confirming the
  repository the Project's folder now names in the Trigger's edit form, or by pointing the folder back.
- **Schedule.** Each Trigger has a persisted next-check deadline: enabling it, switching its schedule on or changing the
  interval sets it one interval ahead, and each scheduled check sets the next one to its completion plus the interval
  (1 minute to 24 hours, default 5 minutes). Factory runs exactly one overdue check after a restart or sleep and never
  replays missed checks. **Run** performs one check of an enabled Trigger whether or not its schedule is on, obeys
  every limit and leaves the deadline unchanged. Checks of one Trigger never overlap; disabled Triggers never check.
- **Recovery.** A guard is written before Start is called and gains its Run inside the acceptance transaction, so after
  a crash a guard without a Run that no check holds was never accepted. The next check deletes it, without calling Start,
  and starts the issue again if it is still labelled; an accepted Start is never repeated.
- **Removal.** Removing a Trigger deletes it with its schedule, latest check, problem and guards. A check in flight is
  fenced by the acceptance re-check, so no Start is accepted afterwards. Runs it already started keep running and keep
  their origin.

**Started from.** A Trigger-started Run stores its [Run origin](../GLOSSARY.md#run-origin) when Start accepts it: the
Trigger's name and id, the repository, the issue's number, id and URL, and its title as captured at Start. The top bar
meta line shows **Started from Trigger “name” · repo#N** (the repository name without its owner), the Run overview in the inspector has a **Started from**
section with the Trigger name and the issue linked to its stored URL, and the sidebar hover card adds the same line.
These are copies: they keep the Trigger name after a rename or removal and never show the issue's live state, labels or
assignee. Run detail and navigation carry the origin as `origin` (`null` for every other Run).

#### Trigger decisions

- **Read-only polling with `gh`, no AI, no stored token.** A check is a deterministic read of GitHub through the host
  user's existing `gh` login, run without a shell, with fixed argument arrays, bounded time and output, and the host's
  credentials only. It calls no model, so a check costs nothing beyond the Runs it starts. Factory stores no GitHub token
  and Trigger settings carry only typed fields (Project, query, Flow, schedule, limit), never commands, flags, paths or
  environment, so an approved client configuring a Trigger cannot run host commands. Factory still never writes to
  GitHub; polling, rather than webhooks, needs no public endpoint. Triggers call `gh` directly because T3 offers
  Factory no GitHub issue search or label reads.
- **The label is the request; the worker's claim consumes it.** Admission is tied to the ready label rather than to the
  query: the guard holds while the label stays and is released only when the label is confirmed gone. Because Factory
  does not write to GitHub, the worker's tracker claim removes the label ([`setup-factory`](installation.md#optional-skills)
  writes that claim), and adding the label again is the only restart action. A labeller-permission check was considered
  and rejected; the query's author filter (`author:@me` by default) is the control on public repositories, where issue
  templates can add labels for anyone.
- **A narrow Run–issue association.** [#269](https://github.com/alimek/t3-factory/issues/269), which introduced the worker's
  tracker claim, decided that Runs carry no issue association. Trigger-started Runs reverse that narrowly: the Run origin records which Trigger and issue caused
  the Run, because the Trigger chose the issue rather than the user. It is an immutable record, not a claim: it has no
  marking state, is never updated from GitHub and is absent from every other Run. Ownership of an issue is still decided
  by the tracker claim.

### Run workspace lifecycle

The Flow's [workspace setting](studio.md#workspace-setting) applies to every Run of that Flow; Start has no per-Run
workspace or base override. To start from another base, change the Flow's **Base** (or save a copy of the Flow with it)
before Start.

- **Creation.** For a worktree Flow, the first Flow-input worker's T3 launch creates one worktree from the resolved base,
  on a new branch named `factory/run-<Run number>-<first 8 characters of the Run id>`. The name is fixed and not
  configurable; T3 rejects the launch if that branch already exists. Details are in the [Runner](runner.md#run-workspace).
- **Sharing.** Every other worker of the Run joins that worktree on its first visit, so parallel Blocks of one Run edit
  the same files. Separate Runs get separate worktrees.
- **After the Run.** Settling or archiving a Run leaves the worktree and branch in place, and Factory never removes
  either: T3's own worktree cleanup applies. Remove one yourself when its work is merged or abandoned, for example
  with `git worktree remove <path>` and `git branch -d <branch>` in the Project repository. A later message to a worker
  of a Settled Run whose worktree was removed lets T3 recreate a missing managed worktree at turn start; do not remove
  a worktree while its Run is still Active.

### Run HTTP API

The Factory UI uses these routes; any client that can reach the host-local listener, or an approved client, can call
them with the protocol headers described in [Protocol compatibility](desktop-and-clients.md#protocol-compatibility).
Mutations also need `X-Factory-Request: 1` ([Configuration and storage](installation.md#configuration-and-storage)).

| HTTP | Purpose |
| --- | --- |
| `GET /api/runs?projectId=` | List Runs, optionally for one Project |
| `GET /api/runs/archived-search?query=` | Find Archived Runs by title or exact Run number |
| `GET /api/runs/:id` | Read one Run's detail, as the Run screen shows it |
| `POST /api/runs` | Start a Run, as the composer does |
| `PATCH /api/runs/:id` | Rename a Run |
| `POST /api/runs/:id/settle` | [Settle](#settled-runs) a Run |
| `POST /api/runs/:id/archive` | [Archive](#archive) a Run |
| `POST /api/runs/:runId/request-report` | [Request report](#reports-and-attention) for one Block |
| `GET /api/runs/:runId/conditions/:blockId/arrivals` | Read a [Condition](#conditions)'s arrivals |


## Live viewing

The Run screen and sidebar update live, including reports, attention, timeline and
navigation membership. Shared T3 connection status and the composer's Project and Flow
choices also update live. The selected Run
and the sidebar share one view subscription; switching Runs refreshes that view with the
new Run, keeping the previous one until the view next subscribes again, as [live delivery](foundation.md#live-delivery)
describes. Live updates preserve the canvas viewport and
selected Block.

Project descriptions and the comparison with the current saved Flow load on screen entry.
Edits in another window need not update those values until the Run is reopened or the page
is reloaded; the Run's Captured definitions stay unchanged.

During reconnect or **Synchronizing**, retained information stays visible and mutations
are disabled until active scopes have fresh snapshots and any catch-up those snapshots
needed, and again while a failed read is retried. The open Run and the sidebar share one
subscription and show one commit's changes together. Browsing and navigation remain
available; no command is queued for later. Hidden browser tabs and minimized or closed
desktop windows detach live delivery; returning obtains current snapshots. A visible
unfocused window keeps updating. These visibility changes never stop the Runner.
The [foundation contract](foundation.md#live-delivery) describes consistency and delivery limits.

## Execution canvas

Opening a Run shows the Flow revision it captured at Start on a read-only canvas (labelled **Flow revision**). Positions, exits,
connections and Agent labels come from the captured revisions, even after the Flow or its Agents are edited or removed or the
project is unavailable; a later edit or removal is labelled (**Flow edited since**, **Flow removed since**), never substituted.
Only a read that finds the Flow gone shows **Flow removed since**; any other failed read shows no comparison label.
A block's exits are its captured Agent revision's exits minus those the Flow hid, plus its Flow-local exits. Reports and handoffs
keep the exit they recorded; Human steps upgraded from earlier releases show their exits as **Approve** and **Request changes**, the
fixed Human exits their old exits were mapped to.

- The **Flow input** block shows the Run's truncated prompt and has no state or details panel; its Run
  [title generation](#run-title-generation) line opens the Run title in the Run inspector instead. With images it shows up
  to three prompt lines, each image reference as an **Image N: name** chip, the first three thumbnails and a **+N** control
  for the rest. A thumbnail or **+N** opens a gallery of every image in manifest order, titled **Image N of M** with
  its name, with a full-size preview and **Previous image**/**Next image** (also the arrow keys). Ordinals and names match
  the workers' `[Image N: name]` text. The canvas chips are labels, since the truncated prompt can hide them; the Run
  inspector's initial prompt shows the full prompt with clickable references and every image, opening the same gallery. Settled and Archived Runs keep their images ([persistence](foundation.md#persistence-model)).
  Images are read from the selected Factory server without thumbnails or transformation. Each load revalidates with the
  server by the image's digest, and image URLs carry a client revalidation key. Each opened view (a Run's prompt, its
  gallery, Settings → Run images) gets its own key, so it asks the server again even after this client loaded the bytes
  before, also when another client deleted them since. Views still open get a new key after a deletion attempt in that
  client's Settings, whatever its outcome; an image already shown in an open view is not rechecked for deletions made
  elsewhere until the view opens again. Missing or corrupt retained bytes show **Image unavailable** with
  the image's ordinal and name; the rest of the history stays readable, and a failed read is not retried in that view and
  creates no attention or state change.
- **Settings → Run images** lists stored images whose every Run is Settled or Archived. The header has
  the Project filter and the deletion action. The list summarizes stored images, size and affected Runs.
  An empty list shows **No Run images**. A list failure shows **Try again** in the header.
  - A tile opens an in-section preview with its position in the list and a **Used by** card. Each Run
    in that card has an **Open Run** action.
  - A tile’s delete icon or the preview’s **Delete image…** opens a centred confirmation for that image.
    **Delete N images…** confirms deletion for the current list. Both explain that the affected Runs keep
    their history and show **Image unavailable**. A filtered confirmation also accounts for shared
    images used by Runs in other Projects.
  - The server rechecks each image and deletes only its file. An image an Active Run now uses is kept. The result card explains the skip, and the retained tile offers only Preview.
  - Manifests, prompts and timelines stay. The image reads as missing everywhere, including Factory MCP reads and worker
    launches. It shows as unavailable in the deleting client's open views, also when the deletion's answer was lost, and
    in every view opened afterwards on any client, even where it was viewed before.
  - A Settled Run that returns to Active does not get deleted images back. A Start naming a deleted image gets the
    missing-images outcome; uploading identical bytes again, from any client, restores the image for every Run that uses
    it, shown the next time a Run view opens.
- Each started work block shows one status badge at its top right, where it never truncates the block name: **Working**,
  **Waiting**, **Needs input**, **Problem**, **Finished** or **Stopped** (the Run was archived or manually settled before it
  finished); a block not yet visited shows none. Needs input replaces Working or Waiting while the block asks for you. A
  [Continuation](#continuations) shows Working while its prompt is worked on and Finished once it passed the response on. A
  finished block reads its taken exit as an outcome, **→ *exit* · time**. Several blocks can be active at once; the canvas
  marks no "current step", percentage or taken path. Repeated visits update the same block; the timeline and executions keep
  the sequence. Connections use one neutral style, including never-run branches.
- Exit rows name each exit in muted text until a report, an answer, a Condition selection or a forward has chosen it; a
  chosen exit reads in primary text. Condition outputs keep their rule (**from arrival *N* onward**, **when no rule
  matches**); other exits carry no source label.
- A working block whose Agent reported `working` shows that message in place of its visit time; its details show the full
  message and offer **Request report** once the worker is idle.
- A [Wait](#waits) is not started before its first arrival, waiting while any arrival is pending, with **until** and the
  nearest deadline (and **N held · next until …** when there are several), and finished once every arrival has
  continued. It has no worker, thread or attention.
- A [Condition](#conditions) reads **Not visited** before anything reaches it, then its arrival total and
  **latest →** the output its most recent arrival selected (with the count still waiting for a number, if any); the
  latest selection is not all downstream work. Each output row shows when it is selected (**from arrival *N* onward**
  or **when no rule matches**). Routing, Otherwise and an unwired selection raise no attention; only a Condition
  integrity Problem shows on the block.
- **Needs input** and **Problem** use the same labels as the Run sidebar and are not cleared by selecting a block. A Human
  step or Agent that asks shows Needs input in its badge; a Problem shows in a footer unless the block itself failed. Stale observations say **Not live** and **Last known**; an unknown observation on a started
  block differs from stale; a block that never ran says **Not visited**.
- On entry, the view opens at 100% and is never fitted. It centers the combined bounds of the active Blocks (`working` or
  `waiting`, and a Continuation while its prompt is worked on, in place of the Agent whose thread works on it); with none, the
  most recently changed finished or stopped Block. With no such visit, it frames error-state Blocks if execution failed,
  otherwise the whole graph when it fits at 100%, or the Flow input. If a Block would
  be cut at the canvas edge, the view moves by the smallest shift that leaves every Block fully visible or fully outside it
  while the centered Blocks stay visible; of equally small shifts, the one showing more Blocks wins. Finished Blocks may sit
  outside the frame; pan or zoom to see them. Finished Blocks and their Progress rows show the outcome as
  **→ Exit name · time**. A visit stopped by Archive shows when it stopped.
- The view then follows that focus: when the active Blocks change, or execution fails with none active, it glides there in about 400 ms, framing the targets at up to 100%. A successful finish leaves the view where it is. Following is on each time the Run is opened and is never saved. Manual pan or zoom (wheel, pinch, buttons, keys) or **Fit Flow** turns it off and interrupts a glide; automatic moves never do. **Follow active** in the zoom controls, or its shortcut (default **.**) while the execution canvas is focused, turns it back on and moves to the current focus (the button glides; the shortcut jumps); it is disabled when nothing is active or failed. While following is off, a focus change marks the button with a dot instead of moving the view; there are no notifications. A hidden window or a Run covered by Settings or Studio stops any glide: on return, a following view jumps once to the current focus without replaying missed changes. With reduced motion, the view jumps instead of gliding.
- Pan, zoom, fit and **Auto-arrange** are local. Zoom ranges 20%–200% (**+**/**−**, **Fit Flow**, **0**, pinch or **Mod**+wheel
  at the pointer; plain wheel and arrow keys pan; bindings are in [Keyboard shortcuts](keyboard-shortcuts.md)). Auto-arrange
  lays out left to right, changes neither the Flow nor the captured revision and resets on reload. Apart from following, live Run updates and container resize preserve the Run viewport.
- The canvas shows exceptions only. **Flow edited since Start** (or **Flow removed since Start**) appears when the Flow's
  current revision differs from the Run's captured definitions; an open Run shows it as soon as the Flow is saved. A
  **Not live** badge with Factory's last observation time appears exactly while the top bar shows Not live. Zoom, fit,
  **Follow active** and **Auto-arrange** are icon buttons with tooltips; the keyboard button beside them opens the canvas
  shortcuts with their current bindings and a link to the cheat sheet. The Flow editor keeps its labelled controls and
  keyboard hint.
- One docked **inspector** beside the canvas shows the **Run overview** until a block is selected or the Run title is
  inspected: **Attention** while something is pending, **Progress** with each started block and its status on a second line
  that wraps (the counts sit beside the heading, as in **Progress  2 finished · 1 needs input**), branches (wrapping only at
  "/" or "-") and pull requests with their last known state, the initial prompt and block activations (**Name · Visit N** and **Open in T3 ↗**), then a
  closed **Resolved attention · N** row and project, Flow revision, workspace and work periods under a closed
  **Workspace & observation** section. Section headings are in sentence case. Selecting a block shows it in the
  same panel: its Needs input or Problem first (answers and Problem actions work here), its current visit and working report,
  the results handed off to an Agent block (**Received**), activations, the Agent block's
  [Revisit instruction](../GLOSSARY.md#revisit-instruction) as captured at Start (read-only, and only when it is non-empty;
  the execution canvas never shows it, and the exact composed turn stays in the worker thread), exits, **Open in T3 ↗**, and its T3 thread and
  execution ids under a closed **Technical details** section. Pressing the Flow input's
  [Run title](#run-title-generation) line shows the Run title there instead; it selects no block.
  **Esc** or the **Overview** breadcrumb returns from the block or the Run title to the overview. Selecting never answers
  or clears attention, and there is no editing here.
- The inspector toggle in the top bar (default **Mod+.**, see [Keyboard shortcuts](keyboard-shortcuts.md)) shows or hides the
  panel. The choice is kept per browser profile on this device across what is inspected, Runs and reload; until chosen, the
  inspector opens from 1280 px wide. While it is hidden, pending attention shows below the canvas.
- The Overview of a Settled Run shows each activation's result title and **Read result**. Other result cards in the
  inspector and timeline preview the result with its exit, deliveries and acceptance time. **Read result** opens the
  full Markdown result (CommonMark with GitHub tables and task lists). The reader header shows the Block, visit, exit
  and time, with **Copy Markdown**, **Open in T3 ↗**, **Esc** and close. Execution, completion, version and delivery
  facts live under **Technical details**. The Working report and Human context readers share the header pattern.
  **Esc** returns focus to the opener. Raw HTML in a result is shown as text and never runs, links open
  outside Factory and images appear as links, so a result never loads remote content. Copying needs a secure context
  (Factory's own window, loopback or HTTPS); over a plain-HTTP remote address the reader says copying is unavailable.
- Drag the inner edge of the shell sidebar (224–480 px) or of the inspector (280–640 px, at most half the area beside the
  sidebar) to resize it; with the edge focused, Left/Right step 16 px and Home/End jump to the bounds.
  Double-click restores the responsive default, which a saved width otherwise replaces. Widths are saved per browser profile
  on this device.
- The top bar shows the title and **#N · Project · Flow · Started …** (with a Trigger-started Run's origin; the
  Flow name opens it in Studio while it exists). Settled and Archived replace **Started** with the lifecycle and
  its event time, when recorded. A Snoozed Run shows **Snoozed · until new attention** after the title and keeps its
  work state on the row and Blocks. The top bar shows **Not live** with the latest observation while an Active Run's
  observations are stale or delivery is unavailable. It offers **Open in T3 ↗** for the conversation or first
  worker when the Project is available, then the inspector toggle and ···. The menu shares the sidebar row's
  availability and shortcuts: **Snooze** or **Restore**, **Settle**, **Rename**, and **Archive…** for Active Runs,
  and **Rename** and **Archive…** for Settled Runs. Archived Runs have no action menu. The timeline starts collapsed as one bar with the event count, such as **23 events**, and **Show timeline**. The inspector's **Workspace** section reads **Project checkout**, **Preparing workspace** with the base ref until T3 reports the worktree, **Worktree · branch · path**, or
  **Workspace failed** with the reason; an unconfirmed creator launch shows its recovery note. Retained Runs that queued a
  first visit on an idle worker prepared under the earlier contract still show **entered · prepared idle T3 thread**.
- Running worker work is ordinary progress; unavailable observations mark the Block **Not live**, preserving prior facts without creating a Problem.

Engine termination alone never settles a Run; automatic settlement needs every condition in [Settled Runs](#settled-runs).

## Run list

The shell sidebar lists Runs globally, newest created first, with equal creation times in ascending creation-key order;
opening, renaming and closing never change either. In the open list, Runs that need you lead: Needs input Runs first,
then Problem Runs, then the rest, each group in that order. When a Run opens, or the open Run changes, its row scrolls
into view at the nearest edge and keeps the neutral selected fill. Run drafts join the main list in the same order once you leave the New Run view, and an unresolved Start joins immediately. A draft that is not awaiting Start shows a **Draft** indicator; one awaiting Start shows the Idle ring and no chip or Draft label
(Settings and Studio open over it and do not count); a draft row reopens it in the composer, and editing never moves it.
A draft's creation key is its id, and its Start sends that id as the request key, which becomes the Run's creation key. With
the draft's title and creation time, the Run therefore replaces the draft row in place, also among entries created at the same
time. Runs created before drafts carried a creation time use their start time and Run id. Creation times come from the
client's clock. Active rows show the project icon and name, execution indicator and time since the last
Run activity, followed by the title. The [Run number](../GLOSSARY.md) appears as a `#N` pill after the project name in
active rows, before the title in compact rows and palette results, and first in the Run top bar meta line; Runs without a number show none.
A third line appears for known worker branches, linked PRs or attention:
one branch shows its name, several show a count, and a PR icon shows the number of distinct linked PRs.
Branches and PRs are independent; neither requires the other and missing data has no placeholder or Flow fallback.
The age advances from execution changes, accepted reports, Human answers, attention appearing, handoff release
and settling or returning to Active, not unchanged observations, viewing or renaming. It does not change creation-based ordering.
Missing projects keep readable history; an unavailable open Run stays open.

Hovering or focusing a row opens one information card to the right, aligned to the row and constrained to
the viewport. It shows the full title, project, captured Flow, a Trigger-started Run's
[origin](#starting-from-a-trigger), execution/attention, working messages and known repository metadata, even when the
title fits. Opening a row menu dismisses and blocks the card; hovering
menu items never opens a row preview.

- **Needs input**: a pending Human occurrence or native T3 question/permission, or an Agent to review in T3 (see
  **Conversation** below).
  **Problem**: a pending missing report, execution failure, report problem or Condition integrity Problem. Both can show. Stale observations or an unavailable
  project are not Problems and opening a Run clears no chip. A Run whose project T3 no longer reports shows a neutral
  **Not in T3** tag on its row and after the Project in the meta line. Its saved Run stays listed, and the Run page
  hides T3 thread links. An Active Run with finished work and nothing pending shows the green Finished check without
  a badge, and Progress says it is waiting for T3 to confirm workers finished.
- **Settled** (collapsed, with a count) holds Settled Runs as compact single-line rows with the project icon, number and title; details remain in the side preview. **Snoozed** sits above it. Both groups stay pinned below the open list, which scrolls on its own; an expanded group's rows scroll within a capped height so open Runs stay visible. On a short window the groups shrink and scroll together, leaving the open list room for at least one Run. Each group appears only after navigation loads and while it contains Runs; hiding it preserves its expanded state. With no Runs, the list is one muted line, **No Runs yet**, the search field stays, and both groups stay hidden. Opening a Run in a collapsed group expands that group and scrolls its selected row into view. Archived Runs are not listed.
  Case-insensitive title search shows one list of matching Runs and drafts in creation order, with a total match count and no group headers. Snoozed and Settled matches have muted titles and status icons unless selected. Drafts are titled from the first non-empty prompt line, or **Untitled draft**; Escape or × clears search.
- **Needs you (N)** filters the list to exactly the Runs the desktop
  [Dock badge](desktop-and-clients.md#notifications-and-dock-badge) counts: Active, not Snoozed Runs with a pending Needs input
  or Problem, leaving out Human steps and native requests during a confirmed Settle that is stopping or unresolved. A Dock click
  with no window open and several such Runs opens the list with it; it clears the title search, and typing a search or choosing
  the filter again shows the whole list. Rows keep their own chips, groups are hidden, drafts are left out, and with no such Run it shows
  **Nothing needs you**. It is a view of the Run list, not an Inbox.
- When Runs exist but none are open, the open list shows **Nothing open** / **You're all caught up.**
  Snooze and Settle focus the destination group toggle after it appears. Restore focuses the restored row; during search, all three actions keep focus on that row.
  A Settle still stopping workers focuses the row; when the Run settles later, focus moves to the destination only if it is
  still on that row, on that Run's detail settlement section, or was lost because the row left; focus the user moved elsewhere,
  including to the page, stays. A detail **Retry** that starts stopping moves focus to the settlement section as the button disappears.
- **Rename** changes that Run's or draft's title only (trimmed, non-empty, ≤500 characters) and makes its title provenance
  manual, dropping a pending [title generation](#run-title-generation); renaming never moves a row.
  The same shadcn/Radix row menu serves desktop and browser clients. Right click opens it at the pointer;
  Shift+F10 and the context-menu key anchor it below the focused row. Touch devices retain a ⋯ button;
  mouse layouts omit it. Closing the menu or Rename/Archive dialogs returns focus to the row when it remains visible. Rename
  in the menu shows the current binding from the shortcut registry (default F2). With a Run open in detail, the same
  **Rename Run** command runs from that binding; customization is in [Keyboard shortcuts](keyboard-shortcuts.md).
  Keyboard **Snooze or restore**, **Settle** and **Archive…** apply to the open Run under the same availability rules as
  these menu items and show registry hints on tooltips where present. While a Run action is running, every row menu
  disables Snooze or Restore and Settle and the busy row disables its menu; unavailable observations disable no Run action. Active and Snoozed rows offer Snooze or Restore and
  **Settle**; every Run row offers **Archive…**. Draft rows offer Rename and
  **Discard**, which removes the draft from this browser at once without confirmation; discarding the open draft leaves an
  empty composition with the same choices. While a draft's Start is in flight or its outcome is unknown, both are
  unavailable: the draft keeps its exact request until **Check same request** settles it.
- An automatically Settled Run returns to Active only when one of its Agents reports; a manually settled or Archived Run is
  never reopened or relaunched. To work on the matter again otherwise, start a **New Run**: it uses the current saved Flow and Agent definitions, not an earlier
  Run's captured revisions.

Authorized [Chat control](chat-control.md#finding-and-reading-runs) participants can also find and read any Run of the
Projects their Discord channel grants, including Runs started here. Reading in chat changes nothing about the Run, and its
views here and on approved clients carry no Discord identifiers. A Run started through a chat confirmation also has a
[status card](chat-control.md#status-cards) in its originating thread, which Factory keeps current from the Run's
facts, and [notices](chat-control.md#attention-notices) there for new Needs input and Problems. Lifecycle changes,
including Snooze, change only what the card shows.

### Branches and pull requests

Repository information is last known metadata from the Run's bound worker threads in T3. A Run can have
several branches and PRs; the same PR linked to multiple workers counts once. Branch names describe the
workers' T3 workspace metadata, not exclusive ownership of a branch by the Run. Factory does not infer
associations from conversation text or the project's current checkout, and it does not create or switch branches.

The side preview and the Run overview in the inspector show the full branch list with the corresponding worker names
and the distinct PR list. The Run overview links to those PRs; their states are last known in T3, not live GitHub checks.
Normal worker observations update the metadata; metadata-only changes affect neither the activity age nor list order. If an
observation fails, retained metadata stays visible as Not live. Settled Runs keep their recorded metadata;
expanding their group or hovering a row does not start background work or refresh T3. Older Runs have no
repository metadata until their workers are observed by this version.

### Snooze and Woke

**Snooze** moves an Active Run to **Snoozed** and changes only presentation: Agents, handoffs and attention continue. A newly
recorded Needs input or Problem identity, or a higher native pending-question count while questions are already pending,
wakes it (**Woke**). Ordinary progress, stale observations and re-reads of the same matter do not. Opening a Run clears only Woke;
**Restore** in either Run action menu returns it to the main list. Snooze state survives reload and restart. Settling or archiving a Run clears both;
Settled Runs cannot be snoozed. T3 reports only a count, so a replacement question with an unchanged count cannot be detected.

On every desktop installation a Snoozed Run is silent: it leaves the Dock badge, its delivered notifications are withdrawn, and
matters that are pending or appear while it is Snoozed never notify, also after Snooze ends. **Restore** returns it to the badge
without a notification; Woke notifies for the new matter as usual. See
[Notifications and Dock badge](desktop-and-clients.md#notifications-and-dock-badge).

## Reports and attention

For new Runs a worker calls `factory_update_block` with its Block id (stated in every Factory message to that worker):
`to: "working"` with a message and no exit when it starts a visit's work, and `to: "finished"` (one of the Block's exits and a
message, required when that exit requires one) when the task is complete. Questions and replies in between need no report.
A report from any turn of the worker's thread, including a user reply or a notification after delegated work, applies to the
Block's current visit. Factory returns acceptance only after saving it. The model supplies no report key or Run id.

- The newest finished report is the visit's result, so the user can continue the conversation and have the Agent report an
  updated outcome. Before hand-off a newer result replaces the held one and only it is passed on. Afterwards the same exit only
  updates the result and message without relaunching the next Blocks; a different exit also hands off to that exit's Blocks,
  while Blocks started from the earlier exit keep running. Repeating the block's latest report returns the original
  acknowledgement, also after settling; while a missing report or execution failure is pending, the repeat is accepted again
  and settles it. Repeating an earlier result after a working report makes it the result again.
- Acceptance holds every outgoing handoff until the worker thread is finished in T3: no active run, no native request and its
  delegated or background work settled ([rule](runner.md#worker-thread-completion)). The timeline shows **handoff held**, then
  **handoff released** (dispatch reserved); the recipient's launch or send acknowledgement is separate.
- A first visit launches the block's own top-level worker with its task; no T3 thread exists for a block before it is
  reached. In a worktree Run that worker joins the bound worktree ([Run workspace](runner.md#run-workspace)). Later visits
  queue independent turns on that same worker, each as its own activation. Two Reviewers returning corrections create two Worker turns, with no Join or agreement on a revision.
  Partial fan-out survives restart; an unresolved launch holds later arrivals to that block only.
- Block state, report, engine status and freshness are separate: a finished report can appear while T3 still works; a finished
  worker thread without a report is a **missing-report Problem**, also after a notification or reply turn; a worker waiting on
  delegated or background work T3 has not settled stays working. A failed, cancelled or interrupted latest run is a Problem until
  a later run of that thread completes or the Block reports; it does not return for that run, and a later failed run is a new
  Problem. Missing-report Problems persist across restart and renewed work;
  there is no automatic retry or dismiss-as-success.
- **Working**: an Agent on its task reports `to: "working"` with a message when the visit's work starts. The block stays
  working and shows the message on the canvas, in its details and in the Run row; it selects no exit, releases nothing and is
  not attention. It stays the visit's current report across later turns, including questions to you, your replies in T3 and
  waits for CI or review, so a finished worker thread is not a missing-report Problem. A later working or finished report
  replaces it. Reported after a result, when the Agent reopens the task, it shows the block working without withdrawing the
  result, and the Run stays Active until a later report.
- **Conversation**: an Agent that asks questions in chat ends its turn with them; reply in the worker's T3 thread. While an
  Agent block's worker thread is idle and the visit's current report is still `working`, the block and the Run show **Needs
  input**, and the overview has one card, **Review *Block* in T3**, with the working message and **Open in T3 ↗**. An Agent
  that stopped without reporting leaves the same evidence, so the card never says the Agent waits for a reply; only an
  explicit T3 request does. It is no attention matter: it neither notifies nor counts for the Dock badge, and the next block
  cannot start on unanswered questions. Factory never parses chat; a model may still omit or misuse a report. Earlier Agent questions recorded before this contract stay in Settled
  attention with their text, and an upgrade turned questions still pending into the visit's working report without resuming the
  worker. See [report acceptance](runner.md#report-acceptance).
- **Request report** on a missing-report Problem, or in the details of a block idle in working, starts one extra turn on the
  same thread asking the Agent to assess existing work and report. Eligibility is rechecked at acceptance (a newer run, an unfinished thread, changed authorization, accepted results
  and Archive make it stale); repeated clicks reuse the request. A successful linked recovery settles the original
  attention with a recovery reason and may let the Run settle; a failed one stays unresolved.
- **Rejected report**: a rejected report for a known Block appears as a separate Problem with the rejection
  code, reason and repair guidance. Missing report means no report was accepted; the worker may have attempted one.
  Correct the reported issue without repeating work. Any accepted report on that Block or confirmed linked recovery settles
  the rejection while preserving its history; progress alone does not. Unknown or missing Block ids stay in MCP/T3.
- **Attention** (per Run, optionally per block) lists pending matters only; resolved ones, with their reasons, chosen
  decision and time, move to the closed **Resolved attention · N** row. Native questions and permissions link to **Open in
  T3 ↗** and are answered there; Factory has no native answer controls. A fresh
  read showing none records `withdrawn`; unavailable reads keep matters pending and mark the observation stale.
- **Timeline** entries are plain sentences derived from recorded facts ("entered · new T3 thread", "handed off to Reviewer via
  Review", "finished → Approved", "result version 2 replaces the earlier result", "you answered → Approve", "settled by you",
  "reported · the Run is Active again", "archived"). The timeline shows **Key events** by default: T3 status changes Factory
  observed on a Block's executions collapse into one row per run of repeats, with their count, statuses and time span, which
  opens in place; any other entry ends the run. Every other entry, including handoffs, Needs input, Problems, results and
  lifecycle changes, is always shown. **All events** lists every recorded entry. The choice is kept per browser profile. Every
  result version keeps its exit, message and deliveries; an earlier version reads **Replaced by version N** and its cancelled
  handoffs **Cancelled**, and a same-exit update after hand-off says it was not handed off again. Activations show the current
  result, and the latest Agent visit shows the Block's current execution state. **Work periods** list each exact execution with
  its own state, the finished or working report (or a historical waiting report) accepted during it, and its T3 link; elapsed times are approximate observations.

Pending Needs input and Problems also drive each desktop installation's macOS notifications and Dock badge, which clear when
the matter resolves, never because a Run was viewed; see
[Notifications and Dock badge](desktop-and-clients.md#notifications-and-dock-badge).

## Human steps

Each arrival creates its own pending occurrence, including parallel arrivals and repeated visits. Answer under **Attention →
Pending** by choosing one of the fixed exits: **Approve** with optional text, or **Request changes** with a non-empty message
describing the changes. Submission settles only that
occurrence and atomically saves all outgoing handoffs: double submission cannot send twice and a competing answer conflicts. Agent
recipients get independent deliveries on the existing thread/queue rules; a Human recipient gets a new occurrence. The block stays
waiting until its last occurrence is answered. Context and delivery text survive restart, are cleared after settlement and
acknowledgement, and Settled keeps only metadata. Human steps have no T3 thread; an answer carries on the originating
worker of the message it answered. An authorized participant can also answer one occurrence through
[Chat control](chat-control.md#human-answer-proposals) after a complete review and their own confirmation.

## Waits

Each delivery released to a Wait becomes its own arrival: Factory keeps its message and the
[worker provenance](../GLOSSARY.md#worker-provenance) it carries (the T3 thread and, when known, the Block activation that produced it) and fixes an absolute deadline, counted from the
moment the incoming handoff was released, after the source worker's thread finished, not from the report. Parallel arrivals
and repeated visits keep their own messages and deadlines and never join. At its deadline Factory forwards the arrival on its
own, with no open window and no worker: every recipient of the Wait's output gets the unchanged message, and an unconnected
output ends the branch. Timing is best effort; the [Runner](runner.md#wait-arrivals) defines how deadlines survive restart and
downtime and how repeated deliveries and competing forwards resolve.

**Continue now** forwards one selected pending arrival immediately, without confirmation, exactly as its deadline would, and
disables its timer; other arrivals keep waiting. The Wait's details offer it beside each pending arrival, and the canvas block
offers it only while exactly one arrival is pending; like other Run actions it is unavailable while offline or synchronizing.
An arrival the timer already forwarded, or one cancelled by Archive or manual settlement, cannot be continued, nor can any arrival
while a confirmed **Settle** is stopping the Run's workers; an automatically Settled Run stays Settled.

The Wait's details list each arrival with its start, deadline, retained message and outcome, and say when you forwarded one
early. A forwarded arrival keeps its message only while its recipients still need it
([retention](foundation.md#persistence-model)); once it is cleared, or Archive or a cancellation clears it, the details say why. The timeline records **wait started · until …**, **wait elapsed → forwarded**,
**forwarded early by you** and **wait cancelled** with the Wait icon. A pending Wait is visible work, never
Needs input or a Problem, and does not wake a Snoozed Run. A Continuation after a Wait continues the thread of the worker
whose message waited.

## Conditions

Each delivery a [Condition](studio.md#canvas-and-block-configuration) accepts gets the next arrival number at that Condition
in the Run, whichever wire or worker it came from, and goes unchanged, with its worker, to every recipient of the output its
rules select ([Runner](runner.md#condition-arrivals)). Run detail carries one constant-size summary per Condition, not its
history: the arrivals numbered so far, the deliveries waiting there for a number, and the latest selection (arrival number,
selected output and acceptance time), which is the most recent route, not proof its recipients received it. The timeline
records one **arrival *N* → *output*** row per arrival with the Condition icon. A Run read carries only each Condition's
latest 50 selection events, chosen in the query, so a Condition with more arrivals shows its latest 50 in the timeline with a
note that the earlier ones are in its arrivals details below. An open Run keeps that window as the Condition advances: older
selections leave the timeline as newer ones arrive, as a fresh read would show. A Condition is never Needs input and its routing raises no
attention.

When Factory cannot trust a Condition's count, its captured rules and wires (as when they would no longer pass Start) or
its waiting delivery, or its next arrival number would pass
9,007,199,254,740,991, it numbers nothing and records one **Condition integrity Problem** on the Condition, with the
reason, as a Problem like any other: it shows on the Condition's block and in the Run's attention, wakes a Snoozed Run and
keeps the Run Active, also across restart. The Condition accepts no delivery while it is pending; its waiting deliveries
stay unnumbered, and other branches continue. No report, **Request report**, Retry or repair clears it. **Settle** or
**Archive** settles it and cancels the waiting deliveries without numbering them or changing the count
([Runner](runner.md#condition-integrity-problems)).

A Condition's evidence is a separate bounded read of one Run and Condition
(`GET /api/runs/:runId/conditions/:blockId/arrivals`, with optional `limit` and `cursor`), available to every client that can
read the Run. It lists numbered arrivals in ascending arrival number, each with its acceptance time, source block and producing
worker, matched captured rule (id and name) or Otherwise, selected output and each recipient of that output with its delivery's
current disposition: `pending` until delivered, then `acknowledged` or `cancelled`. An unwired selection lists no recipients.
Decisions never change; dispositions are read again on every page, so they are current rather than a snapshot from selection
time. A page holds 50 arrivals by default and `limit` accepts whole numbers from 1 to 100; any other value is a validation error.
A first page fixes its window at the highest arrival number committed at that read (`highWater`), and its `nextCursor` continues
only that window, so arrivals numbered later never shift a page; reading without a cursor opens a new window that includes them.
A cursor is opaque, signed by the running server and bound to its Run and Condition: one for another Run or Condition, one
whose content was changed in any way (including a validly re-encoded window), one issued before the server restarted or one
beyond the committed arrivals is a validation error. Recipients are read only for the page's own arrivals, at most one per Block the
selected output is wired to. Deliveries still waiting at the Condition for their number are not listed; the summary counts them.

Selecting a Condition shows this evidence in the inspector: the latest selection, then its arrivals in ascending number,
each with acceptance time, source block and producing worker, the matched rule or **No rule matched** (Otherwise), the
selected output, and each recipient with its delivery's disposition when that page was read; an arrival whose output is
not connected says it ends there. A selection is only the route, so the list never shows a recipient as having received
it until its delivery is acknowledged. The first page opens once the Condition has an arrival; **Load more** continues
that window and **Refresh** opens a new one. When live Run updates count arrivals after the window, the list says so and
waits for **Refresh** rather than adding them. A failed read, including a cursor the server refuses, shows its error
with **Try again** and, for a later page, a refresh from arrival 1.

## Continuations

A Continuation continues the conversation of the worker whose message reaches it. The first message in a Run queues its prompt on that
worker's T3 thread, stating the Continuation's own Block id; after a Human step, also one whose answer first waited in a Wait, the
person's reply follows the prompt, labelled, because the worker has not seen it. The Continuation shows **Working**, with **In *owner*’s thread**, and the worker's own Agent block shows **Working** while the thread works on
it, without a new visit and without changing that block's result or firing its connections again. When the worker reports `finished` for
the Continuation and its thread is finished, the response leaves the single output and the Continuation shows **Finished**. Messages that
arrive while the prompt is pending wait (**Queued** in its details) and go out after the response, in arrival order. From then on every
message is forwarded unchanged with its own worker, also in loops and after a restart; the prompt is never sent again in that Run.

Its details list the prompt visit (input, prompt sent and response) and each pass-through visit, each with **Open in T3 ↗** for the
worker its message belongs to; Blocks that share a worker open the same conversation. Timeline rows for it use the Continuation icon. A missing
report after its prompt is a Problem on the Continuation, and **Request report** asks the same thread for it. Archive stops a pending
Continuation and cancels waiting messages; its worker thread is interrupted with the other workers.

## Settled Runs

A Run **settles** automatically when every visited Block's current visit has its worker's accepted final result and no later
working report, every Human step is answered, no Wait arrival is pending, no delivery waits at a Condition, no delivery, launch, handoff or send is outstanding, no attention is pending, and
a fresh read finds every worker thread finished in T3. Never-visited branches need not run. A report or T3 completion alone keeps
the Run Active. T3 reads are not an atomic cutoff, so direct T3 activity can arrive just before the Run settles; settling does not
certify result quality or one reviewed revision.

**Settle** settles an Active or Snoozed Run manually and ends its automatic work; every entry point (row menu, Run detail,
shortcut and desktop menu) uses the same rules. When fresh T3 reads confirm every bound worker thread finished, it settles at
once. Otherwise nothing changes until you confirm stopping every worker and ending the Run; cancelling or dismissing the
confirmation changes nothing and sends no Stop. An ordinary Settle request never interrupts a worker: the server answers that
confirmation is needed. A Run with workers, started under a T3 authorization Factory knows was since replaced, for example by
reauthorizing or connecting another endpoint, cannot be settled: **Settle** is refused with or without confirmation, also while
T3 is unavailable, and nothing changes; **Archive** remains available. A Settle confirmed while reauthorization is still
pending is accepted, but if the new authorization is not the Run's, it ends unresolved and only **Archive** remains.

Confirming holds the Run at once: nothing new is launched, sent, released or delivered, no Wait forwards (at its deadline or
through **Continue now**), and Human answers and **Request report** are refused. While settlement is stopping or unresolved,
Human occurrences stay pending until settlement succeeds, but their answer forms are replaced by a settlement note and the Run
shows settlement progress instead of **Needs input**. Refused answers explain that Factory is settling the Run and stopping its workers.
Factory then asks T3 to Stop each worker thread that is still unfinished, with its delegated and background work,
and settles only once fresh reads confirm every worker finished; a Stop acknowledgement is not enough. Until then the Run stays
Active and its settlement shows **stopping**, with each worker's progress. A worker shows **not resolved** when T3 does not
support or accept Stop, cannot show the thread in the Run's project, workspace and authorization, or still shows it unfinished
30 seconds after acknowledging Stop; the settlement then names the affected workers and what blocks them (a run in progress, a
native request, delegated work or a queued run). A worker whose launch T3 may have accepted without Factory receiving the reply
also keeps the settlement unresolved: Factory keeps searching for it and stops the worker it finds before settling. Factory sends
Stop only while the T3 authorization the Run started under is still live. **Settle** again retries with a new Stop request;
repeating it while stopping changes nothing. The hold stays, Factory keeps reading the workers and settles as soon as all read finished. An unresolved
settlement is not a lifecycle state: there is no Resume, and **Archive** remains available. Work T3 holds queued in a worker
thread keeps the settlement unresolved until it is removed in T3 or runs; Factory deletes nothing and does not stop a worker
that only queued work keeps unfinished.

A settlement pass that ends unresolved raises the Run's **Settle could not stop workers** Problem; a settlement that is only
stopping raises none. It is about the Run rather than one Block, so it appears in the Run's attention, not in a Block's. It
names the workers shown not resolved, and any lost launch still searched for, with what blocks each, and the recovery options:
**Settle** again, remove queued work in T3, or **Archive**. An unresolved episode has one such Problem: a retry keeps it pending,
and when the retry ends unresolved again the same Problem shows the current workers, without a new appearance. It settles with
the Run's other attention when settlement succeeds (`manual-settlement`) or the Run is Archived (`archived`). As ordinary
attention it wakes a Snoozed Run and reaches [Chat control attention notices](chat-control.md#attention-notices).

Settling cancels unsent launches, sends and handoffs (held or released), unsent Request report turns, pending Human occurrences
without inventing answers, pending Wait arrivals, deliveries waiting at a Condition for their number and messages waiting at a
Continuation; a cancelled Wait never forwards, also after restart. A Condition keeps the arrivals it already numbered, and their
selections, as history. Pending attention settles as `manual-settlement`, activated
Blocks without a Final result show stopped, and a send whose T3 reply was lost stays uncertain: Factory never resends it and
keeps no copy of its message. The Run moves to
**Settled**, Snooze and Woke clear, and Factory best-effort settles the worker threads in T3. The timeline records the
confirmation and each retry, each Stop request, each worker found stopped and the settlement. Each worker's last run keeps
the status T3 showed when it ended, such as interrupted, with its end time. Stopping raises no execution-failure Problem, and a
Problem recorded before Settle, such as a failed run, stays; only a settlement left unresolved raises its own settlement Problem. T3 Stop has no exact-run fence: a turn started directly in T3 around the Stop request may be stopped
too, or start after the Run settled; settling does not delete T3 conversations or roll back repository edits.

A manually settled Run's work stays ended: a later report from one of its Blocks, including a delayed one from stopped work, is
acknowledged as a success that changes nothing and tells the Agent to stop, and Factory no longer observes or drives the Run.
An automatically Settled Run differs: any accepted report from one of its Blocks (`working` or `finished`, including a repeat
of the current result) returns it to **Active**, and the timeline names the Block that reported. Chat in a worker thread without
a report leaves it Settled: Factory observes it only while it still owes a launch, handoff, send, Request report or Wait
forwarding, so later turns add no work periods or Problems. Human answers and Request report on it are accepted and dispatched without returning it
to Active. Runs settled before manual settlement stopped workers keep their open gate and behave like automatically Settled
Runs. History, input, captured definitions and events remain; no transcript or response-body archive exists.

## Archive

**Archive…** in either Run action menu asks for confirmation, names any pending Human decisions that will be cancelled
and tells you how to find the Run again by number or title. The Archived Run shows its lifecycle in the meta line.
Archiving closes the handoff gate, cancels unsent launches and handoffs, cancels pending Human steps without inventing answers,
cancels pending Wait arrivals so no deadline forwards afterwards, cancels deliveries waiting at a Condition for their number
(numbered arrivals stay history), clears every Wait and Condition arrival's message, settles pending attention
as `archived` and shows activated blocks that had not finished, including waiting Waits, as stopped. Factory then asks T3 once to
interrupt every worker thread, which also stops its delegated work, and does not wait for or confirm termination; in-flight or
uncertain deliveries keep their recorded state and are not retried.

An Archived Run leaves navigation and cannot be restored, settled or snoozed. Archiving the open Run returns to the composer.
Find an Archived Run by its number or title in the command palette. The **Archived** result opens its read-only history. Any later report from one of its Agents is
acknowledged as a success that changes nothing and tells the Agent to stop work on the Block; Human answers and Request report are
refused. Archive does not roll back edits or prevent new direct T3 chats; closing Factory or a browser tab is not Archive.
An authorized participant can also archive a Run through [Chat control](chat-control.md#archive-proposals), where a request to
stop a Run means Archive, after a complete review and their own confirmation. Runs
stopped by an earlier release are Archived after the upgrade, with their recorded Stop history.

## Restart and shutdown

History stays readable when T3 is unavailable. On startup Factory restores bindings and reconciles Active Runs, and automatically
Settled Runs that still owe an operation, before dispatching, then
observes periodically (no Resume button). A confirmed Settle keeps its hold across restart: Factory reads the workers again and
settles once they read finished, but never sends a Stop the earlier process had not, so a worker still unfinished is unresolved
until you retry. Missing or incomplete observations stay stale and keep the last known facts. An uncertain
launch or send replays only with the saved key and body under the same authorization context and a verified replay scope; otherwise it
stays unresolved and keeps the Run open (see [Runner](runner.md#ownership-and-restart)). One backend owns a database; another
fails startup. Shutdown neither archives a Run nor interrupts T3; reopening the same data home observes accepted work.

## Completed stages in T3

When native settle is supported, Factory best-effort marks a worker thread **Settled** in T3
once its Block's current `finished` result is confirmed by worker completion, even while the
Run continues. Run settlement remains the fallback for remaining threads. Factory never
unsettles a thread, and an attempted request is not repeated for the same thread and T3 run.
See [native thread organization](runner.md#native-thread-organization) for guards, failure
handling and the limits of this best-effort organization.
