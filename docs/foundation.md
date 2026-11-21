# Application foundation

## Workspace boundaries

Factory separates the browser UI, authoritative backend and desktop shell. Shared contracts
and validation have no application or I/O dependencies; clients may validate early, but the
backend remains authoritative. Shared contracts also declare the desktop bridge between the
renderer and the desktop shell. The desktop shell owns host lifecycle and client transport,
not business rules. T3 owns external execution; Factory owns Flow routing and Run state.

## Persistence model

Factory stores current definitions with revisions plus an execution log in SQLite. It is
neither full event sourcing nor a mirror of T3 conversations. Configuration, the database
and restricted OAuth credentials live outside project repositories.

- Agent and Flow definitions are editable. Saves compare revisions; stale writes conflict.
  Structural validity permits incomplete drafts, while readiness is a separate launch gate.
  Each Flow save appends an immutable relational revision and each Agent save an immutable
  Agent revision; removing either hides it from Studio and Start but keeps its revisions.
  The [owning Project](studio.md#ownership) is stored on the Flow and Agent identity, referencing
  the never-deleted Factory Project row, and is not part of any revision. Migration `103` added it
  with every existing Flow and Agent global, keeping ids, revisions, references, Runs and import
  receipts unchanged and needing no user action. Migration `105` records when each identity's owner
  last changed (empty for existing rows), so a definition's update time is its latest save or owner change.
- Start atomically records the Run input, references the current Flow revision and freezes
  the current revision of every Agent that Flow references, including blocks it may never
  visit; each Agent activation references that frozen revision. Runs keep no separate copy:
  execution, recovery and Run history read these revisions, so later edits and removals
  cannot rewrite history.
  External skill files are not frozen. Agent revisions hold the Agent's exits and Flow revisions
  hold each Agent block's hidden and Flow-local exits and its Revisit instruction, each
  Condition's ordered rules and the Finish block with its ordered endings, so a Run's block exits,
  Revisit instructions, Condition rules and endings come from the same frozen revisions. Migration `072` converted
  every stored Flow revision, including those Runs captured: Agents started with no exits, Agent
  block exits became Flow-local with the same IDs, and Human exits became Approve or Request
  changes by their feedback flag, with their wires, answers and handoffs following. Earlier Human
  exit names are not kept. Migration `081` gave every Agent block of every stored Flow revision,
  including those Runs captured, an empty Revisit instruction in place; other block kinds have
  none. Migration `116` added `revisit_context` (`keep` or `fresh`) to `flow_revision_blocks`
  under the same restored immutability guards, defaulting every existing Agent block to `keep` and
  leaving other block kinds null. Migration `094` made an Agent revision's execution columns nullable together (all present
  or all null, with the non-empty and JSON checks kept for present values), rebuilding the table under
  its restored immutability guards with every revision id, number and Run reference intact.
  Migration `098` widened the Flow revision block kinds to include Condition, rebuilding the block
  table under its restored immutability guards with every stored block unchanged and no Condition
  inferred, and added immutable Condition rule rows; a Condition's Otherwise output is implicit for
  the kind and not stored. Migration `099` added Condition arrivals, keyed by their incoming delivery, with a per-Run,
  per-Condition count and arrival numbers from 1 to 9,007,199,254,740,991, each selection naming only its matched captured
  rule (or Otherwise), and the Condition arrival on each delivery a selection creates; it changes no existing row and
  starts the count of any Condition a Run already captured at 0. Migration `101` adds an index for reading an arrival's
  recipient deliveries and changes no row. Migration `114` gave every stored Flow revision,
  including those Runs captured, an immutable empty Finish block 80 px right of its rightmost Flow
  input or block and level with the Flow input (within the canvas limit), added immutable ending
  rows, and rebuilt the connection table under its restored immutability guards so a connection
  enters exactly one block or one ending of its revision, with every stored wire unchanged.
  Migration `120` rebuilt `flow_revision_blocks` under its restored immutability guards to admit
  `kind = 'subflow'` and a nullable `flow_id` (required to be null for all other block kinds and
  with no foreign key to `flows`, so removed child Flows remain repairable in saved revisions and
  existing rows stay unchanged).
  Migration `124` marks legacy empty Finish blocks inactive, so they are absent from Flow and Run
  graphs. Each stored Finish row and its position are preserved under the restored immutability
  guard. Finish blocks with endings remain active.
- A committed [import](studio.md#import) writes an import receipt in the transaction that creates its definitions: the client's request id,
  a versioned SHA-256 fingerprint of the canonical document, the reviewed selections and the import target (JSON with object keys sorted at every level and array order kept, so a reordered file still replays; the decoded document keeps its file's format version, so a version-1 commit retried after an upgrade still matches its receipt), the created Agent ids by document key and, for a Flow file,
  the created root Flow id. Migration `122` adds ordered Flow identities by actual document key for bundled Flow files. The result includes `flows: [{key, id}]` for those receipts. Earlier receipts retain their root identity. A commit reads receipts before the T3 catalog and the target's availability, so a retry replays without T3 and after its target Project became unavailable: the same id and fingerprint return the
  original result, while another fingerprint under that id conflicts. Receipts are immutable and outlive restarts and the definitions they name; a replay returns a removed
  definition's id and never recreates it. Migration `095` adds the receipt tables and changes no existing data. Migration `104` records each
  receipt's fingerprint version: receipts written before it keep version 1, which covers only the document and selections of an import
  that was always global, so they replay as global imports and conflict with a retry naming a Project; new receipts are version 2.
- Run images are bytes on disk under `FACTORY_HOME/images`, named by their SHA-256 digest, with
  staging metadata in SQLite. Start attaches the ordered manifest to the Run, accepting only digests
  that are staged and still have their file; the prompt segments and manifest are immutable and the
  Run's input keeps the worker-readable text. Migration `071`
  gives every existing Run one text segment and no images.
- Each Run stores its title with an explicit title provenance (automatic, manual, generated or legacy) taken from
  the Start request and changed to manual by Rename; it is never derived from the title text. Manual provenance is part
  of the Start request identity; automatic and legacy keep the identity requests had before provenance existed.
  Migration `079` marks every existing Run legacy and changes no title.
- The installation-wide **Generate Run titles** setting is one SQLite row holding its on/off state, the chosen T3 model
  and options, a revision and the latest title generation diagnostic. Start acceptance records at most one title generation
  per Run in the same transaction as the Run, with its captured model, options, prompt version and deadline, and for a
  pending one the title thread's launch request, so the intent is durable before any dispatch. The generation later
  records when that request was sent, the thread T3 launched, when it reached its outcome and the claims for its one
  Stop and one T3 thread settlement. Migration `080` adds the setting off and gives existing Runs no generation. No
  other data changes.
- [Chat control](chat-control.md) keeps its state in SQLite: the On/Off switch and one row per Settings section
  (Language model, Discord connection, Access), each with its own revision so sections save independently, and
  Test or check evidence apart from runtime health. Secrets never enter SQLite: the model key and the bot token
  each live in an owner-only credential file the section's row names. A save stages the file durably, then
  commits the row in one transaction, so restart never mixes a configuration with another revision's secret,
  and files no committed row names are removed. Conversation memory, read handles and markers of handled
  Discord events or unfinished invocations belong to a conversation generation or expire, and clearing a
  conversation deletes them. Chat actions do not depend on conversation turns: proposals with their
  requester-bound consent and original expiry, attempts identified by the shared operation's request identity,
  the originating thread of each chat-started Run and owed Discord deliveries with their persisted intent and
  outcome survive clearing, Off and restarts. Human answers and Archives record the request they were applied
  under, so a chat action proves its own effect. Migrations `082` to `091` keep every existing row (rebuilt
  tables copy their values), start with Chat control Off and empty sections, give existing Runs no originating
  thread and post nothing about earlier Run activity.
  Chat control's state also records the Discord application its operating connection authenticated as, which
  owns the conversations, consent and messages; no Application ID is configured. Migration `092` carries a
  formerly configured Application ID over as that recorded application, turns a stored identity-mismatch check
  into a verified check of the application Discord reported, keeps a rejection for another application's token
  until Retry and keeps every other value. Migration `093` records the message carrying each new review's
  button, so its button can be shown disabled once unusable; existing proposals have none and are never edited.
  Migration `100` rebuilds the record of announced attention matters to admit Condition integrity Problems,
  keeping every row unchanged.
- [Triggers](runs.md#starting-from-a-trigger) are current definitions in SQLite, without revision history: the shared
  settings with a revision that saves compare, the kind (fixed at creation by the schema) and the GitHub Issues settings
  (the confirmed repository's host, name and node id, the query and its ready label), plus the persisted next-check
  deadline, the latest check with the issues that did not start, and the current problem with when it was first and
  last seen and how often. Each check replaces the latest check. A hidden admission guard per Trigger and issue holds
  the labelling it started, the Start request id, the frozen Start payload and, once accepted, the Run; it is written
  before Start is called and gains its Run in the acceptance transaction, which is how recovery tells an accepted Start
  from one that never was. A Trigger-started Run's origin is written in the same transaction; it copies the Trigger's
  name and id instead of referencing the Trigger and can be neither updated nor deleted, so it outlives renames and
  removal. Removing a Trigger deletes its settings, check, problem and guards. The table names carry a `run_` prefix
  so they do not read as SQL triggers. Migration `106` adds these tables and changes no existing row; existing Runs
  have no origin.
- Each Start creates a new Task, Run and threads. An automatically Settled Run returns to
  Active when one of its Blocks reports; manually settled and Archived Runs are never reopened.
- A Block reuses its worker conversation across visits. Exact execution identity, report
  status, engine status and observation freshness remain separate facts.
- External delivery records retain the exact request, target, key and authorization
  context needed to resolve uncertain outcomes. An acknowledgement is not completion.
  Each delivery also records the [worker provenance](runner.md#worker-provenance) of its message,
  and each Wait arrival is a durable obligation with an absolute deadline. A Condition delivery is recorded pending in
  per-Condition order, then numbered and routed in the same transaction.
- Reports name their Block by the Block id Factory issued; Run and Block identity never come
  from other model-supplied references.
  Attention settlement and the Run's Settled and Archived states remain separate, with cancelled Human work never
  represented as an answer.
- Every settlement records its reason: `automatic`, `manual` or `finish` on the Run's `run-settled` timeline event, and
  `manual` or `finish` on the confirmed stop-and-settle record that stops a Run's workers. The stop-and-settle
  takes its authorization (the user's confirmation, or the Flow) and its reason together, and a retry keeps the
  recorded reason. Migration `113` adds the reason to settlement records and backfills every existing one as
  `manual`, since only the user's confirmed Settle existed; no settlement history changes.
- A Run has at most one [Run result](runner.md#reaching-an-ending), recorded once and never updated or deleted, and
  each accepted delivery fixes at most one. Migration `115` adds that table and writes no row, so historical Runs have no
  result.

**Transactions and restart.** One backend owns a database. Start, reports, Human answers,
delivery reservations, settling and Archive have atomic durable boundaries before their effects
are acknowledged. Local mutations serialize per Run, and SQL transactions never span
network I/O. Restart reconciles open Runs before dispatching. Uncertain operations are not
new attempts, and failed Agent work is never retried automatically; see
[ownership and recovery](runner.md#ownership-and-restart).

**Retention.** History, input, revisions, events, deduplication metadata and closure evidence
are kept indefinitely. A Wait arrival keeps its message while it is pending or needed for
delivery: after forwarding, until no outgoing Handoff is pending and no current visit of an Agent
recipient reads it as that visit's input, and never past its cancellation or Archive. Its body is then cleared while
its outcome, deadline and deduplication identity stay. A Condition arrival follows the same rule once selected; while it waits
for its number its text stays only in the incoming delivery, and its number, selection, provenance and deduplication identity
stay. Other message payloads persist only while needed for pending Human context,
uncertain delivery or recovery, then are cleared while keys, fingerprints and references
remain. Initial input, including its images, revision prompts and the [Run result](runner.md#reaching-an-ending), which
keeps its text through Archive unless its ending's output is None, are intentional exceptions;
staged images no Run references are deleted after 24 hours. The only other image removal is manual
deletion from **Settings → Run images** of an image whose every Run is Settled or Archived. Factory
rechecks that rule at deletion and removes only the bytes; manifest, staging row and history stay. A
later Start naming the image gets the missing-images outcome, and uploading identical bytes restores
it. There is no transcript archive, and neither payload clearing nor image deletion is secure erasure.

## Public operations

The public Factory API is the behavioral boundary for HTTP clients and integration tests.
`openFactory({ databasePath })` acquires ownership, opens SQLite with foreign keys, WAL and
full synchronous durability, and applies pending migrations before exposing operations.
Always close it with `await factory.close()`.

Each HTTP operation is defined once in the contracts package: its method, path, named
parameters, request body and answer kinds, and input and output types. The backend route
table, frontend client and facade type derive from those definitions. The table requires
an entry for every definition, with one entry per listener for client scope; path shape
determines precedence and conflicting entries refuse server startup. Trust attributes and
body limits belong to the backend, alongside the handlers and business validation.
The facade declares only its three operations not reached over HTTP separately.

Operations return either a value or an error with `code`, `message` and field-addressed
issues. Storage failures are sanitized at this boundary. Validate untrusted input here;
keep transports limited to translating requests and responses. Product routes are shared
by host and approved clients, with explicit [host-only boundaries](desktop-and-clients.md#two-listeners-two-trust-domains).

## Anonymous product analytics

The backend validates each analytics event against a closed catalog before buffering it. The catalog accepts only the values declared for that event. The backend supplies the installation hash and build metadata itself. `app.started` records whether First-run setup is still pending and reports only the bucketed totals for Projects, active Flows and active Agents.

Flow authoring events report the saved graph's structure, including whether it contains a Subflow block. Run Start reports the captured root Flow's structure. Run completion counts distinct executed Blocks across the root and all invocations, including activated Subflow placements and reached Finish blocks. Each invocation is part of the same Run. An import reports the definition kind once for a newly committed request, including when a Flow document creates multiple definitions.

The backend creates its random installation identity in `FACTORY_HOME/telemetry-id` with owner-only permissions when analytics is available. The UUID stays on disk and only its SHA-256 hash is sent. A damaged or inaccessible identity disables delivery. Events are held in memory, and retries keep the same event UUID and timestamp so PostHog can deduplicate them. Delivery uses a bounded background queue and a one-second best-effort flush at shutdown.

Packaged Release and Beta builds use the public PostHog EU project token embedded at packaging time. `FACTORY_POSTHOG_KEY` overrides that token and `FACTORY_TELEMETRY_HOST` overrides the default `https://t3factory.app/ingest` destination. An absent token disables delivery. Source runs and development packages require `FACTORY_TELEMETRY_ENABLED=true` to send, and `FACTORY_TELEMETRY_ENABLED=false` always disables delivery. Factory disables PostHog person profiles and GeoIP enrichment on each event. The production project must also discard client IP data from stored events. [PostHog data storage controls](https://posthog.com/docs/privacy/data-storage#discarding-ip-addresses-at-project-level)

## Live delivery

Run detail, sidebar navigation, shared T3 connection status, [theme colors](t3-integration.md#theme-colors),
the Run composer's launch choices and Studio's saved definitions use typed Effect RPC streams over WebSocket at `/api/live`;
commands and other reads remain HTTP operations. A window holds one connection-status subscription,
one theme-color subscription (it never disables mutations or shows synchronizing), one view
subscription carrying navigation and its open Runs, and, while the composer is shown, one
launch-choices subscription carrying the Project catalog and Flows with their readiness.
Servers also serve a Studio subscription carrying every current saved Agent, every
current Flow with its readiness and every Trigger with its latest check and problem; Agent usage is derived from those
Flows. A window holds it for its lifetime, because Agent reporting state and the command palette
read it outside Studio; those reads never gate mutations or show synchronizing, like theme colors.
While Studio is open its hold gates the window's mutations like every other gating scope, so Studio
writes, and other product writes, wait while it is unsynchronized; drafts stay editable. A refused or failed subscription stays
synchronizing, with no HTTP fallback, and HTTP answers never mark the scope synchronized. Each read of a view covers navigation and those Runs in one
read transaction, and its changes travel in one delivery that the window applies at once,
so one commit's lifecycle, attention and report changes appear together in Run detail and
the sidebar. Opening a Run resubscribes the view with a fresh joint snapshot. A Run left
for another stays in the view, still updated, until the view next subscribes again, so releasing it
never returns the Run opened in its place to synchronizing, and reopening it shows it live at once.
Releasing a Run while a held Run is refused for capacity resubscribes at once, giving it the slot.
Each subscription starts with an authoritative snapshot, followed by committed changes. The
owning modules publish only after a successful durable commit, or an authoritative
in-memory connection or project-discovery transition. This covers reports, including
committed rejection diagnostics, as well as background observation, recovery and lifecycle
changes. Flow and Agent writes, project observation and selection, discovery problems and
connection transitions mark launch choices; Run changes do not. Each read of launch choices
covers the catalog and Flows in one read transaction and does not wait for a running
project reconcile, whose own publications would otherwise leave that read not current.
Committed Flow and Agent creates, saves, duplicates, removals and imports mark Studio through the
same definition-change hook; refused writes change nothing. Each read of Studio covers both lists in
one read transaction, so every Flow's readiness was resolved against exactly the Agents delivered
with it. Studio reads come from SQL alone and never contact T3, so capability and connection
changes neither mark Studio nor change what it delivers.
Subscription registration precedes the snapshot read. A relevant hint during that read
triggers a fresh read, up to three reads. A delivery is current only when no relevant
change arrived while it was read and no later read failed; a scope counts as synchronized,
and new commands are enabled, only while its latest applied delivery is current. A command
admitted then, such as Start with its image uploads, is not cancelled halfway by a later
catch-up, but sends nothing once the client is offline. A snapshot
or a later read raced by another commit stays unsynchronized until its catch-up arrives, and
a failed re-read keeps the last value, marks the scope unsynchronized and retries. An unknown
Run is final for that Run only, as is a Run beyond the view's capacity of 20 Runs per window;
any other refused subscription is retried with backoff and keeps mutations disabled.

Delivery replaces changed entities or logical sections by stable identity, sends navigation
upserts/removals and appends timeline entries by sequence. Studio changes are whole Agent and
Flow upserts and removals by id: an Agent change also delivers each Flow whose readiness it
changed, although that Flow's revision is unchanged. Clients order Agents by `updatedAt` (latest
save or owner change) descending and Flows by `createdAt` descending, each then by ascending id, which reproduces the
backend's list order. Worker executions use the pair
of binding id and execution id, including observation metadata, so later turns preserve
earlier executions. Observation-only timestamps of Runs and projects
travel as compact metadata rather than repeated Run or catalog data. Changes may coalesce into the
latest committed state; delivery is not a record of every intermediate state, but preserves
recorded timeline history.

Pending change hints are bounded to one dirty marker per subscription. Slow consumers
re-read committed state against the last value sent rather than accumulating a queue of
changes, and publication never waits for network delivery or turns an accepted mutation
into a failure. Snapshots and retained Run history still grow with the underlying data;
this is not a fixed byte limit on a Run or a durable delivery log.

Every reconnect or visibility gap starts fresh snapshots for active scopes. There is no
replay cursor or polling fallback for these consumers, and reconnect never replays commands.
Each later socket connection also repeats the protocol handshake, because a server replaced
behind the same address may no longer be compatible; an incompatible one shows the update gate.
Obsolete subscriptions cannot replace the current view. Runner observation, dispatch,
recovery and handoff scheduling belong to the server: zero subscribers stop no execution,
and additional subscribers create no additional Runner schedules. See [Run viewing](runs.md#live-viewing)
and [transport admission](desktop-and-clients.md#two-listeners-two-trust-domains).

## SQL migrations

Add the next unique `NNN_description.sql` under `apps/backend/src/migrations/`; never edit
a released migration. Each chunk contains **one SQLite statement**, separated by the exact
`-- statement-breakpoint` line. Do not add `BEGIN` or `COMMIT`: the migrator owns the
transaction. An unknown migration ledger fails closed.

The current-schema snapshot at `apps/backend/src/schema.sql` is generated and
test-asserted. After adding a migration, regenerate it with
`pnpm --filter @t3-factory/backend schema:update`. It is never an input to the
build or runtime and is not shipped; migrations remain the only schema source.

Persisted JSON (operational payloads, evidence and Agent model options) is versioned like
the schema. Flow graphs and Run definitions are not stored as JSON: Flow and Agent revisions
are relational rows that Runs reference, so changing their shape is an ordinary SQL migration
over current and historical revisions. Such a migration converts every revision in place under
the guard rule below; it never appends, renumbers or drops revisions, because Runs reference
them. A JSON shape change needs a migration that rewrites stored data and a
[frozen-fixture upgrade test](../apps/backend/test/fixtures/README.md). Preserve records by
converting them to the current shape unless the user explicitly accepts discarding the
affected data. An accepted removal still needs a migration and an upgrade test proving
both the deletion and preservation of unaffected data. Record retained/lost data and any
operator action in the PR and update support limits.

A Run captures its root revision and references each placed Flow revision once. Invocation
records own serial placement ordering and link their inner Block identities to the captured graph.
Runtime records continue to reference the Run and its Block IDs. The scoped runtime migration
keeps existing Blocks in the root scope with their existing public identifiers, operation keys,
Condition numbers and revision references.

A reset must be explicit, never a fallback after upgrade failure. The application reads
only the current shape; old-shape readers and dual-write paths do not replace migrations.
When rewriting immutable history, temporarily remove its guard and restore the identical
guard within the same migration. Upgrade tests restore genuine captured data and assert
public results; they never edit current data to fabricate an old contract. See the
[upgrade baseline policy](testing.md#database-upgrade-baseline).

## UI routes

Settings and Studio open over the current Run or composer. Closing them returns to that
screen with its draft intact; direct links fall back to `/runs/new` in a fresh session.
Settings sections open at `/settings/<section>`: `connection`, `agent-reporting`, `devices`, `privacy`,
`run-titles`, `run-images`, `appearance`, `keyboard` and `desktop`. A removed or unknown
section path opens T3 connection; removed paths have no redirects.
Studio destinations open at `/studio/flows`, `/studio/agents` and `/studio/triggers` with their nested editor routes.
[Studio](studio.md#shell) and [Keyboard shortcuts](keyboard-shortcuts.md) document navigation and
unsaved-change guards. Direct URLs must also work on reload; the server serves the UI for each of these paths.

Browser storage is optional: blocked or malformed storage must leave in-memory preferences
usable and must not turn a confirmed Start into an unknown outcome. Shortcut schema
changes must migrate or explicitly invalidate saved preferences under the
[current-contract policy](../AGENTS.md#one-current-contract). The composer retains an
unknown Start's identical key and payload for an explicit check, across reloads when
storage allows; only confirmed success clears its prompt. Run drafts are client-local
preparation in browser storage, never backend records: metadata in localStorage and image
bytes in IndexedDB, keyed by selected server, draft and image. Drafts and pending requests
saved before images become one text segment with the same request identity; those saved before title provenance
submit legacy, which keeps their request identity. Blocked storage
shows that a draft lasts only while the window is open. Client-local state that belongs
to a server is scoped by that server: browsers are isolated by origin, while the desktop
renderer shares one origin and names its role and selected server. Backend idempotency
remains authoritative.

The UI must work over plain HTTP on a LAN or Tailscale address as well as loopback.
Browser APIs requiring a secure context must not be the only way to generate identifiers.
Canvas routing and viewport geometry are transient; pan, zoom and live updates never modify
saved definitions or the revisions a Run captured. Authoring positions change only through explicit
edits or Auto-arrange followed by Save; see [canvas behavior](studio.md#automatic-layout-and-canvas-view).
