# T3 integration

In **Settings → T3 connection**, save one MCP endpoint: HTTPS, or HTTP on `localhost`, `127.0.0.1` or
`[::1]`. URLs with credentials, query or fragment are rejected without echoing them. The backend stores the
endpoint in SQLite, so opening the UI from another device does not change which machine connects to T3.

## Authorizing

Choose **Authorize on backend host**. Factory discovers the server, registers its public client and opens the
host's browser; approve access in T3. No pre-created client or copied token is needed. The callback listens only
on `127.0.0.1:43827/callback` (free that port if Factory reports a bind failure) and approval expires after ten
minutes. Wrong-state callbacks are rejected; denial, expiry and browser-launch failures have actionable
explanations. Approval must happen in a browser **on the backend host**: a remote UI cannot complete the loopback
redirect. Factory uses `open` on macOS, `xdg-open` on Linux and `rundll32` on Windows; only macOS is verified.

While approval waits the pane says **Approve in the browser on the Factory host**
and offers **Open the page again**, which reopens the same pending consent page
with its existing OAuth state and verifier. An expired, denied or never-started
attempt is replaced by a new one. On the host, **Start over** replaces a pending
attempt and **Reauthorize** replaces a working grant.

An [approved remote client](desktop-and-clients.md) may use **Authorize** or
**Open the page again** for the endpoint saved on the host. Consent happens
in the host's browser. The consent URL, state, verifier and tokens stay on
the host. Editing the endpoint and replacing an existing grant are host-only
operations. Agent reporting installation is available remotely as described below.
Opening is serialized with checks: Factory rechecks first, does nothing
for a ready or incompatible connection, waits for an in-flight callback exchange and opens the host browser at most
once every five seconds.

## States

| State (badge) | Meaning and action |
| --- | --- |
| Not set up | Save the T3 address on the Factory host. |
| Disconnected (`unavailable`) | T3, network or storage inspection failed. Check the address and start T3. |
| Needs authorization (`authorization-required`) | Approve access, finish pending approval on the host, or reauthorize after revocation. |
| Incompatible version (`incompatible`) | The MCP protocol or connection contract is unsupported. Inspect problems, update T3 if appropriate, recheck. |
| Connected (`ready`) | An approved grant, live tool inventory and environment identity passed connection checks. |

The connection badge is green only when Connected, amber for authorization or version problems and
red when disconnected. The sidebar Settings dot also checks reporting configuration for providers used by saved Agents:
while Connected, a missing, outdated, unsupported or unreadable installation makes it amber with a labelled warning and
opens **Agent reporting**. Unused providers do not raise this warning. Reporting inspection is neutral while loading;
connection problems take precedence. The footer names problems, so status never relies on color. The
T3 connection pane shows the status and **Check again** in the header. The
Connection card lists the address, T3 version, authorization and when the last
check ran. An unsaved address opens for editing automatically on the host. A
problem gets one card with the next step and raw diagnostics under closed
**Technical details**. The connected view keeps environment and tool diagnostics
under the same disclosure. Settings navigation groups are **Factory** (T3 connection,
Agent reporting, Devices & access), **Chat control** (Language model, Discord),
**Runs** (Run titles, Run images) and **This device** (Appearance, [Keyboard
shortcuts](keyboard-shortcuts.md), Desktop app). Search filters sections by name
and row labels while leaving the open page in place. Esc clears the search, then
closes Settings. Settings opened from the composer or a Studio editor returns
to the draft on close.

Connection status refreshes automatically while the application is visible, so approval
on the host can turn a waiting remote view Connected without another click. **Check again**
requests an immediate inspection. A transient outage preserves the authorization reference
and credentials; reconnection never opens a browser automatically.

Connected does **not** prove project availability, provider/model availability, harness setup or exact runtime
correlation; those execution gates are checked separately at [Start](runs.md). Version differences alone do not reject a
connection and Factory launches no onboarding workload.

## First-run setup

**First-run setup** is the host's one-time checklist before the application opens. Whether it is completed is durable installation state in `factory.sqlite`, never derived from the live connection, so a later T3 outage does not gate the application again. A fresh home starts not completed; an installation that already has a saved T3 endpoint is recorded as completed when it upgrades. The development demo seed records completion. The status read returns the completion flag, the detected T3 (`endpoint`, `serverVersion`) or none, and the reporting drivers that T3 keeps off (`harnessesOffInT3`); step progress is not duplicated there, because steps read the connection and [reporting installations](#reporting-installation).

Detection exists because T3 offers no supported way to discover its MCP endpoint: its MCP tools need an existing authorized connection, and T3 documents only copying the MCP URL from **Settings → Connections**. Factory therefore reads T3's internal `server-runtime.json` from the same T3 state directory as reporting discovery (`FACTORY_T3_STATE_DIRECTORY`, otherwise `~/.t3/userdata`). The file is untrusted and not a published contract: only its `origin` and optional `serverVersion` are read, unknown fields are ignored, and the proposal `<origin>/mcp` must pass the same endpoint validation as a typed address (HTTPS, or HTTP on loopback; no credentials, query or fragment). A missing, unreadable, malformed or differently shaped file, or an origin that fails validation, means no running T3 was found and the user enters the address manually. A file without a server version still proposes the address, with no version. The `origin` must be exactly an origin: a value with a path, credentials, query or text the URL parser would repair proposes nothing. The proposal is only a suggestion; the connection check after saving it is what proves it, so a stale file left by a crashed T3 fails there. A T3 release that changes the file's shape needs the same adjustment here.

Until setup is completed, the host shows a full-window **First-run setup** screen after the protocol, reachability and client-approval checks; no application route opens behind it. Its first step, **Connect to T3**, proposes the detected T3 with its version and address. **Connect** saves that address and then starts the same host authorization as Settings, so T3's approval page opens in the host's browser. While approval waits, the step offers **Reopen approval page**; if the host's browser cannot be opened, the connection reports it (`authorizationOpenFailed`, with its explanation) until a later open succeeds or that approval ends, so every host window and every reload shows the explanation instead of saying the page is open. The failure is recorded on the pending approval itself, beside its callback and consent page in the host's credentials, so it has exactly that approval's lifetime: a backend restart that resumes the approval reports it as before, and a new approval starts without it. The step passes by itself once the live connection is Connected. Until setup is completed the host re-reads the setup status every few seconds while visible and on focus, so the step follows T3 starting or stopping. Without a detected T3 the step says no running T3 was found, offers **Check again**, and opens **Use another address**, where **Save and connect** does the same with a typed address; once T3 is detected the disclosure starts closed again. That disclosure and the **Settings → T3 connection** address editor show one shared explanation of where the address comes from. A denied, expired or failed approval, an unreachable address or an incompatible T3 shows the connection's own explanation in the step, and Connect starts again. A fresh home has no saved address, so once one is saved, these explanations show whether the attempt was made in this window, before a reload or in another host window.

The second step, **Install in your agents**, opens once T3 is Connected. It lists every [reporting installation](#reporting-installation) target whose provider Factory can install into (status other than `unsupported`), which is exactly the set reporting discovery finds enabled in T3. Each row shows the configuration file and the skills folder Factory writes, the target's own message, such as the guidance to verify an assumed default home, and its status; a target that needs attention, such as a conflicting `factory-runtime` entry, shows its usual explanation instead. **Install in N harnesses** runs the ordinary reporting install, which repairs a target that needs it, for each target that allows it, one after another; rows update in place, and a failed target keeps its error while the others install. **What gets installed** names Factory MCP and `$factory-block` as required and `factory-start-run` and `setup-factory` as optional. Reporting drivers whose instances T3 keeps off are named below the list, judged by the same settings file and enablement rule as discovery; a driver that has no instance in T3's settings file is not named, as discovery does not list it either. The list is read again for every ready connection and whenever that caption changes, for example after a harness is turned on in T3; until that read answers, the step shows it is checking, since the list read before can be out of date, such as discovery's refusal from before T3 was Connected. The connection names each ready connection with `readyGeneration`, which changes on every connect, reauthorization, new authorization context, reconnect after an outage, endpoint change and backend restart, and is empty while T3 is not Connected; each request to read the list again is its own read generation, so a list read for an earlier connection or an earlier request never counts, even when the caption is the same. With no installable harness on in T3, the step asks to turn one on and offers no install; it keeps the screen, because turning one on in T3 fixes it. When discovery refuses instead, because T3's local state cannot be read, belongs to another T3 identity, or the host is Windows or managed or the connected T3 is not on loopback, the step shows discovery's explanation and recovery, names no harness as off and offers no install. It also says how to continue: open Factory without reporting, then install it from **Settings → Agent reporting** once the blocker is fixed, or set it up by hand as [Reporting installation](#reporting-installation) describes. When T3's settings or identity file is missing or unreadable, the explanation names where Factory reads T3's state (`FACTORY_T3_STATE_DIRECTORY`). Reporting discovery marks such a list's only target as a discovery result (`kind` `discovery-refused`, or `none-enabled` when no instance is on) rather than a per-instance target (`instance`), so no T3 instance key can pass for one. The step passes when every listed target is `installed`. When installation is impossible, the host can open Factory without it: discovery refused, or the list is not empty and no listed target still offers Install or Repair (each remaining one shows its own explanation, such as a missing harness home or a conflicting entry). In a mixed list, the installable targets are installed first; **Open Factory** appears only once none is left to install or repair, and it records completion exactly as below. Every **Open Factory** in this screen, including Ready's, is available only while the list it rests on is current: read for the current ready connection and since the caption last changed, with no newer read outstanding. While a read is outstanding it is disabled, so a harness turned on in T3 is listed and offered for install before setup can be completed. The reminder to open a new agent session appears only when something is installed. Fixing those targets later belongs to **Settings → Agent reporting**. This step adds no installer behavior: install, repair and reinstall and the set of supported harnesses are those of **Settings → Agent reporting**.

When both steps pass, **Factory is ready** shows both as done, naming the optional skills only when every listed harness has their current copies, and reminds the user to open a new agent session, since an open session keeps the tools it loaded. **Open Factory** records completion through the host-only operation and then opens the application; a setup read still in flight cannot reopen the screen afterwards. If recording fails, the screen stays with the error. From then on the screen never returns, whatever later happens to the connection or reporting; Settings and the sidebar status report those problems, and Settings remains the place to repair them.

An approved client that opens Factory while the host's setup is incomplete waits on the same card, read-only, titled **Finish setup on the Factory host**. It shows the host's progress through both steps from the same connection and reporting reads, including the listed harnesses and their status, and offers only **Check again**: no Connect, address entry, Install or Open Factory. When installation is impossible on the host, it says it is waiting for the host to open Factory; it says so only from a reporting list read for the host's current ready connection, and read again when the off-in-T3 caption changes, never from one read before; it lists harnesses by the same rule. The host-only rules are unchanged; only the host saves the endpoint, authorizes or records completion, which refuses approved clients with `host_only`. The client re-reads the setup status every few seconds while visible and on focus, and opens the application by itself, without a reload, once the host completes setup.

## Credentials and reauthorization

OAuth registration, tokens, discovery, PKCE and pending callback state live in `credentials/t3-<endpoint SHA-256>.json`
under the data home, apart from configuration and SQLite (directory 0700, files 0600, atomic writes). Credentials and
callback URLs never appear in API responses, prompts or history; OAuth error bodies are sanitized.

A pending approval can restore its listener after a backend restart within the approval window. Completed grants are
reused by later processes; a crash during the one-use code exchange may require explicit authorization again.
Reauthorizing retires the active authorization context before external I/O. A new grant, changed endpoint or changed
environment gets a new durable context; reconnects and refresh keep it. Operation intents compare their saved context with
the current one and keep mismatches unresolved: reauthorization is never permission to silently replay old work. See the
[replay rules](runner.md#ownership-and-restart).

## Theme colors

Factory uses the color palette of the **environment default theme** of the T3 connection's environment
(`t3 theme set`), not the theme an individual T3 window shows. Each client keeps its own
[appearance preference](desktop-and-clients.md#appearance) and uses the T3 palette for its
effective Light or Dark mode.
T3 keeps owning theme selection and editing; Factory has no theme catalog or editor.

**Reading the default.** Factory reads the theme with T3's `t3_theme_read` MCP tool over the authorized T3
connection, so theme colors need no pairing or credential of their own. Each pass lists T3's tools, reads the
environment identity and the default theme id, and, when that id names a published theme, reads that theme's file.
It keeps only the environment id, the default theme id and that definition. Factory reads on startup, whenever the
saved endpoint or its authorization context changes, and on every connection-check interval; a change made in T3
appears by the next interval, since the tool pushes no updates. A T3 that lists no `t3_theme_read` (builds before
November 2026) uses Factory’s colors and shows **Update T3 to follow its theme**. Factory once paired a separate `orchestration:read`
session for theme colors; a backend deletes any token of that session it still stores, and T3 keeps the session
until it expires or the owner revokes it (`t3 auth session revoke`). Hosts and approved clients see
the same read-only theme and color sources in [Appearance](desktop-and-clients.md#appearance).

**Resolution.** Built-in T3 themes (`t3-chat`, `grove`, `ocean`, `ember`, `iris` and their legacy aliases) and
published theme definitions resolve through one bounded resolver ported from T3 Code (MIT, © 2026 T3 Tools Inc.)
at revision
[`d2c25950b4d9`](https://github.com/pingdotgg/t3code/tree/d2c25950b4d9183ea342d5d5fc14c326b9e0172a); the
ported source keeps the license notice, and parity tests compare it with output of the upstream resolver at that
revision. Factory maps the roles by meaning and validates each mode under the
[contrast policy](design-system.md#t3-theme-colors), then publishes one presentation with both halves and their
availability. Factory does not claim compatibility with T3 revisions other than the pin.

A published definition resolves as T3 resolves it. Its declared appearance takes the palette T3 generates from its
`canvas` and `accent` seeds, or T3 Chat's palette for that appearance when it has no seeds, with its `colors` on top.
The other mode exists only when the definition declares a variant for it: T3 Chat's palette for that mode with the
variant's colors on top, never the seeds. Without that variant the mode keeps Factory's colors and Settings says
so; Factory never inverts colors, derives an opposite theme or shows the declared appearance in the other mode. A
built-in id or legacy alias always names the built-in, whatever a published definition is called.

Support limits of published definitions:

- **Format.** T3's theme file version 1 only: a `light` or `dark` appearance, `#rgb`/`#rrggbb` seeds, and color
  records of role names to texts of at most 64 characters, in a set of at most 32 definitions. A named definition
  in any other structure is not followed and Settings names it; unknown extra fields are ignored.
- **Roles.** Factory reads the twelve T3 roles it maps and ignores every other role, known to T3 or not. A
  definition without seeds and without any readable color of a T3 role is not a theme.
- **Color syntax.** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with channels in 0–255, and `oklch()`
  with numbers or percentages. T3 itself accepts more CSS color syntax (named colors, `hsl()`, `lab()` and others);
  Factory ignores such a color as T3 ignores an unparseable one, so the role keeps its seed-generated or T3 Chat
  value. Clients receive color values formatted by Factory.
- **Translucent colors.** A mapped role resolving to a color with alpha rejects that mode to Factory's colors.
- **Parity.** Verified against upstream output for seeds in both appearances, overrides, partial and complete
  colors and variants, to the six decimals T3 writes; other inputs are not claimed.

**Fallbacks.** An empty default, an unsupported or removed definition, a rejected mode, a T3 without
`t3_theme_read`, a connection whose authorization T3 rejected (even before a new authorization replaces its context)
and a mismatched environment all use Factory’s colors for the effective mode. Appearance explains
an unreadable theme or a connection problem and identifies each mode’s color source when the theme is applied.
During a transient outage the last presentation of the same endpoint and environment stays.
A changed endpoint or connection environment discards it at once. Theme colors
never change connection readiness, Start, execution or Run attention.

**Stored snapshot.** The backend keeps the presentation it publishes as one snapshot in its database, with both
modes together and no credential, and deletes it whenever it stops publishing one (another endpoint or
environment, no inherited default, a T3 without `t3_theme_read`). A starting backend adopts that snapshot before
T3 answers only when it was stored for the saved endpoint and still carries the connection's environment and the
current resolver pin; so a host restarted while T3 is unreachable keeps its colors. Nothing is adopted later in
the process: returning to an earlier endpoint never brings its old colors back. Migration `096` removed the grant reference that
snapshots stored while theme colors used a paired grant; their colors are kept. On reconnection Factory reads T3's
current default and publishes the resulting presentation as one revision. Each client also
[caches the presentation](desktop-and-clients.md#appearance) it received.

## Agent reporting

Agents report Block results by calling `factory_update_block` on **Factory MCP**, a Streamable HTTP
MCP server at `/mcp` on the backend's host-local listener (`http://127.0.0.1:4310/mcp` by default).
Each harness configuration registers it once by URL as `factory-runtime`; the harness connects at
session start and lists the tools the running backend serves. Each call names the Block by its
Block id; Factory returns a durable acknowledgement and never parses assistant text.
Installation also writes the `$factory-block` skill beside the harness configuration. The skill carries
the worker's [reporting obligations](#reporting-authority); argument rules and Factory's next step live
in the tool descriptions and replies, so an application update changes those without touching harness
files. The worker's first message starts with `$factory-block` followed by a `Factory Block id: <id>.` line.

### Installation actions

**Settings → Agent reporting** lists each discovered configuration home as one row
with its provider, path, status and available action. Provider instance display
names distinguish rows when a provider has several homes. **Check again** shows
in the header alongside **Install all** when a home offers Install or Repair.
Install all calls the same installation action for each eligible home in order,
shows its progress on that row, and refreshes the list at the end. A failed
home keeps its retry action and its own problem card with **Technical details**.
The Agent reporting navigation dot surfaces homes needing action and failed
inspections even for homes that no saved Agent uses. Those homes belong to the drivers listed under
[Reporting installation](#reporting-installation). Every other provider instance is listed as **Not available**,
with the `factory-runtime` MCP URL to add by hand and no install action. Agent capabilities
publish the same per-provider `reporting` status, and Start blocks an unsupported provider with
`harness_unsupported` pointing to Studio → Agents. A provider instance disabled in T3 is left out:
Factory neither lists it, inspects its home nor offers an action for it. A home shared with an
enabled instance stays listed for that instance. An Agent saved on a disabled provider shows
**Reporting not configured** and Start stays blocked until the provider is enabled in T3 or the
Agent uses another one.

- **Install** (Not installed) and **Reinstall** (Installed) write only
  Factory's own entry. **Repair** appears only when Factory can repair what it owns:
  a missing or outdated `$factory-block` skill, or Factory's entry pointing at another backend
  address (a changed `port` or `FACTORY_PORT`). An application upgrade needs Repair only when it
  changes the skill; a fresh harness session sees the new tools. Any other `factory-runtime`
  entry, including a command entry from an earlier stdio bridge, is a conflict to remove by hand.
  Conflicts, inaccessible homes, unsupported providers and remote T3 hosts show diagnostics only;
  unknown homes and homes on those hosts get manual-setup guidance.
- Installation is per effective home and is shared by all Agents, models and Projects using it.
  Studio's Agent list and editor show the selected provider's reporting installation status only when it needs attention,
  the editor with the actual diagnostic and **Open Agent reporting** for repair; installed reporting shows nothing there.
  Changing the provider updates the editor's status before saving.
  Status refreshes on opening Agents or Agent reporting, after saving or removing an Agent and after an installation action;
  visible windows also recheck on focus and periodically. These indicators describe configuration, not verified execution.
  Discovery covers the same-user loopback T3's provider homes as described, with their limits, in
  [Reporting installation](#reporting-installation).
- **Installed** describes configuration only; it does not prove current live tool visibility,
  so runtime evidence stays **UNVERIFIED** even after a valid report. Fresh harness
  sessions and native trust approvals remain the user's responsibility. No setup action starts a
  workload.
- Desktop and source servers register the same URL, so switching between them needs no
  Repair. Harness configuration is written only on an explicit action.
  Approved remote clients can install, repair and reinstall through the same screen. The server
  resolves the selected configuration home and writes its own harness files and skill; the client
  sends only the discovered target's identifier. The MCP URL remains the server's loopback address
  ([client access](desktop-and-clients.md#connecting-a-client)).

## Reporting readiness

Start and runtime readiness check the real connection, the available project, the selected
environment/provider/model/options, the public T3 interface and the installed Factory MCP entry. Readiness
covers each Agent's worker settings and reporting harnesses, including the installed `$factory-block` skill. Missing or unavailable selections or installation block Start with the actual conflict explanation. When the blocking problem is the reporting installation, the rejected-Start notice links to **Settings → Agent reporting**; other readiness problems link to **Studio → Agents**. Readiness never
launches diagnostic work, answers approvals or substitutes settings.

A worker's newest `finished` report is its Block's result, and a later one from the same thread
[replaces it](runner.md#report-acceptance). Its handoffs stay held until its worker thread is
[finished](runner.md#worker-thread-completion), while a Human answer releases its handoffs directly. A finished
thread without a report shows a Problem, and **Request report** is an explicit user action, never automatic.

## Integration boundary

Factory uses one typed boundary for all T3 access. T3 SDK calls and OAuth credentials
stay behind it; Factory owns durable routing, authorization checks and shutdown. Connection
inspection proves protocol support and environment identity, never readiness to execute work.
It launches no diagnostic workload. Version strings are informational, not an allowlist or
proof of replay continuity.

The boundary keeps one authorized MCP connection per T3 endpoint, opened on first use and shared
by inspections and every T3 call, including concurrent ones. When T3 no longer knows the
connection's session, for example after a T3 restart, the boundary opens a new connection and sends
that request again, because T3 did not run it. Any other transport failure is reported as T3
unavailable without resending, so an action T3 may already have executed is never replayed.
Authorizing, resuming authorization, a rejected grant, an endpoint change and shutdown close the
connection, so no call uses a previous grant's connection. An inspection without a saved grant uses
a separate connection that is closed afterwards.

The boundary classifies each T3 call's failure once, for that call only: T3 unavailable (network,
timeout, server error or lost reply, including during token refresh), authorization required,
refused by T3, or a response outside the contract. Only a refused launch fails definitively; any
other launch failure leaves the launch uncertain.

Native thread pointers may be Markdown autolinks. Public links use
`https://app.t3.codes/threads/<environment>/<thread>` with encoded segments; opening them
in a native client remains a live compatibility check.

### Connection API

| HTTP | Purpose |
| --- | --- |
| `GET /api/connection` | Read status |
| `PUT /api/connection` | Save an endpoint (host only) |
| `POST /api/connection/recheck` | Check again |
| `POST /api/connection/authorize` | Start authorization (host only) |
| `POST /api/connection/authorization/open` | Open consent on the host for the saved endpoint (host and approved clients) |
| `GET /api/setup` | Read [First-run setup](#first-run-setup) status (host and approved clients) |
| `POST /api/setup/complete` | Record that First-run setup is completed (host only) |

Theme-color status and presentation reach clients through live delivery only.

The authorization context tracks grant continuity, not verified user identity or server
retention of deduplication keys. Refresh preserves it; a new approval replaces it.
Controlled OAuth and simulator tests prove local handling only; production uses live T3
and needs the separate [qualification procedure](installation.md#bounded-live-verification).

## Execution operations

- **Launch.** Each Agent Block's worker is its own top-level thread. It uses that
  Agent's saved provider, model and options, the explicit project and environment, the
  Run's workspace strategy (`root` in a checkout Run; in a worktree Run `worktree` for the
  creator and `existing_worktree` with the bound path and branch for every other worker, launched
  when its Block is first reached, see [Run workspace](runner.md#run-workspace)), and the exact
  first message and request key. There is no Run
  conversation and no native-delegation launch. Launch omits `runtimeMode`; if the public
  schema requires it, Start fails with `launch_unsupported`. An uncertain launch is searched
  for and is not replayed. A definitive rejection is an error. Unknown send acceptance
  cannot be replayed without independent continuity and key-retention proof, absent by default.
- **Image attachments.** Factory treats image launches as supported only when T3 lists
  `t3_attachment_prepare_upload` and `t3_thread_launch` advertises `attachments` (an array whose `maxItems` covers the
  Run's images) and `clientRequestId`. For each image Factory calls `t3_attachment_prepare_upload` with type `image`,
  name `image-N-<sanitized name>`, type and size, then POSTs the exact bytes to the returned relative URL on the MCP
  endpoint's origin without the OAuth bearer, and launches with the returned attachment ids. Uploads are repeated for each
  launch attempt; ids, signed upload URLs and context URLs never enter prompts, saved payloads or logs. Factory does not
  discard pending uploads; T3's sweep removes them. Launches stay in the connection's own environment. The browser never
  uploads to T3. Controlled fixtures cover the transport; live T3 upload, relays in front of T3 and model vision are
  unverified.
- **Observation.** One `t3_thread_read` per worker thread (`runLimit: 50`) supplies the
  active and latest runs, recent runs with ordinals and source timestamps, and the pending
  native request count, which includes permissions as well as questions. A read whose
  thread identity, run references or pending count is missing or malformed is rejected,
  never read as idle. Factory does not classify turns: a user reply, a notification and a
  delegated completion are all later runs of the same worker thread.
- **Delegated wait.** `t3_thread_wait` for the latest run with `timeoutMs: 0` and
  `untilDelegatedWorkSettled: true` answers whether that run and its delegated and
  background work have settled. Its answer must name the waited thread and run and carry a
  boolean `timedOut`; `resultRun` is ignored. How the two reads combine is the
  [worker thread completion](runner.md#worker-thread-completion) rule.
- **Send.** Work targets an exact thread with `mode: queue`, a stable request key and fixed
  message. Agent blocks with `revisitContext: "fresh"` also send `freshContext: true` so T3
  starts a fresh provider session on that worker thread without earlier context; Start and
  dispatch require T3's `t3_thread_send` schema to advertise boolean `freshContext` for those
  Flows, while ordinary sends omit the field. Returned thread/message/execution references must match. Send replay requires its
  own continuity proof; launch replay support is insufficient.
- **Stop.** Archive and [manual settlement](runner.md#manual-settlement) stop worker threads with
  `t3_thread_interrupt`, `stop: true` and a request key, but no run ID: T3 acts on the thread and
  its delegated work, without an exact-execution fence, so a run started between Factory's read
  and the request can be stopped too. Factory treats Stop as supported only when the tool's schema
  has string `threadId` and `clientRequestId` and boolean `stop`. Archive sends one request per
  worker thread (key from the Run and thread) and records no outcome. Manual settlement sends at
  most one per worker thread and attempt (key from the Run, attempt and thread), only under the
  Run's live authorization context rechecked before each request, records it before sending and
  settles only after fresh reads confirm the thread finished; unsupported or refused Stop leaves
  it unresolved. Factory cancels no queued run: a queued run keeps manual settlement unresolved,
  and one that starts after Archive's interrupt is not stopped. T3 gives a queued run the next
  ordinal and shows the highest ordinal as the thread's
  [latest run](https://github.com/pingdotgg/t3code/blob/44ebb2fe57465d32f2bd07c5eb3d8e871bdf5ed5/apps/server/src/orchestration-v2/ThreadManagementService.ts#L530-L534),
  while its Stop
  [targets](https://github.com/pingdotgg/t3code/blob/44ebb2fe57465d32f2bd07c5eb3d8e871bdf5ed5/apps/server/src/orchestration-v2/Orchestrator.ts#L12403-L12417)
  a running run, or else the latest run that is not queued while its background work is
  pending, and holds queued runs instead of starting them; [manual settlement](runner.md#manual-settlement)
  owns how Factory applies this. This is source-reviewed at that pinned commit, not exercised
  against a live T3. Acknowledgements never
  prove termination.
- **Settlement.** `t3_thread_organize` with `action: "settle"` organizes a thread without
  launching a turn. It provides neither safe replay nor an execution fence.

### Launch provenance

Factory-launched workers are top-level threads. A title is not ownership: recovery binds
only when parentage, project, interaction mode, provider, model, options and one
execution are all present. A missing or non-string parent or workspace withholds the search.
A null workspace is the project checkout and matches a root-strategy launch; any other path
must equal the Run's project root. Worktree launches match on path and branch as the
[recovery rules](runner.md#start-and-delivery-guarantees) describe. Threads a worker starts later, including subagents, are
neither report authorities nor Factory obligations; T3's delegated wait answer covers them.
Observation makes no model calls.

## Projects and model options

Project behavior is in [Projects](projects.md). `orchestrator_capabilities` publishes `{ id, values, default? }` per model option. Factory keeps the complete string/boolean `values` domain and a valid published default, and saved options need exact membership
when `values` is present. Mixed domains (e.g. `[false, "auto"]`) render as a select retaining typed values. Unsupported value types omit the whole option and make saved
selections unavailable. Legacy `{ type, options }` descriptors still work. The Agent editor fills a missing selection from a published default, then the first permitted value,
and retains existing selections, including false and unavailable values.

## Reporting installation

The installer needs authorized same-user loopback T3, accessible local state and a matching environment identity; `FACTORY_T3_STATE_DIRECTORY` overrides state discovery, and standard homes assume
Factory and T3 share an OS user and home. Factory installs reporting for Codex, Claude, Cursor, Grok, Antigravity and Mistral Vibe. Other drivers stay blocked at Start. Discovery applies T3's enablement rule to the persisted settings: an explicit `enabled: false` on the instance or inside its `config` disables it, otherwise the instance flag, then the `config` flag, then the driver default decides. Without a flag, `cursor`, `grok`, `muse`, `pi`, `opencode` and `antigravity` are off and other drivers are on; this default is repeated from T3 and a T3 release that changes it needs the same change here. An instance that a T3 project's settings enable is listed whatever the machine setting. Agent reporting still lists enabled instances of other drivers with the `factory-runtime` MCP URL to add by hand once Factory can tie that harness's calls to a Run. Home resolution for Codex, Claude and Grok uses the trimmed non-empty persisted `config.homePath`, then the last provider environment entry
(`CODEX_HOME`, `CLAUDE_CONFIG_DIR` or `GROK_HOME`), then the same-user default (`~/.codex/config.toml`, `~/.claude.json`, `~/.grok/config.toml`). Skills go to the home's `skills` folder; for Claude that is `~/.claude/skills` with the default home and `<dir>/skills` beside `<dir>/.claude.json` in a configured `CLAUDE_CONFIG_DIR`, the folder Claude Code and T3's skill discovery read. After an upgrade that corrects an installed location, **Repair** or **Reinstall** writes the skills there. Cursor always uses `~/.cursor/mcp.json`; the Cursor SDK reads that path from the OS home and ignores a provider `homePath`. Tilde paths are expanded; relative
paths are refused. Factory's own environment never redirects discovery and T3's inherited host variables are unobservable, so an undisclosed override needs manual verification. Managed setup,
shadow homes, custom launch arguments and policy profiles need review; do not switch setup modes to satisfy the installer. Installer support does not qualify live workloads ([Harnesses](installation.md#harnesses)).

For Antigravity, install the runtime and sign in through **T3 Code → Settings → Providers**. Then use **Settings → Agent reporting** in Factory to install into each T3 provider instance. T3 exposes runtime setup in its UI and keeps ACP sessions in a private profile. It offers no MCP tool to register a user server for an instance, so Factory resolves the existing profile using T3's state layout under `providers/antigravity/<SHA-256 of instance id>`. A change to that layout needs the same adjustment in Factory. Factory writes `config/mcp_config.json` and `config/skills` relative to this profile, which may link skills to the user's Antigravity directory. Standalone `agy` keeps its separate MCP configuration. T3 disables its built-in Antigravity text generation for profiles with user MCP servers, which can affect T3's own title and summary generation.

T3 lists Mistral Vibe under the shared ACP Registry driver. Its capabilities omit the registry agent ID, so Factory checks the matching local T3 settings for the official `mistral-vibe` entry and its managed executable. Factory registers `factory-runtime` as a `[[mcp_servers]]` entry with the `streamable-http` transport in Vibe's user `config.toml`, then installs the skills under the same home's `skills` folder. Instances using the same home share the installation with the CLI. Factory uses the instance's `VIBE_HOME` when set and otherwise `.vibe` under the instance's `HOME` or the OS user's home. Factory can create a missing Vibe home during installation. An existing path must be a directory. A provider-level `VIBE_MCP_SERVERS` override or redacted configuration needs manual review. Vibe's trusted project settings and administrator policy can affect what a session loads.

Codex and Grok install `[mcp_servers.factory-runtime]` with `url` (TOML). Claude installs `mcpServers.factory-runtime` as `{ "type": "http", "url" }`, Cursor as `{ "url" }`, and Antigravity as `{ "serverUrl" }` (JSON). The URL is the backend's loopback address plus `/mcp`. Conflicting or modified entries, symlink/special/hard-linked files and unsupported TOML
structures are refused; unrelated content is preserved. Installation refuses detected conflicting edits; arbitrary external editors are outside its transaction.
Installation proves configuration, not effective native trust or visibility under higher-priority project policy. A missing Cursor directory is created on install.
An open harness session keeps the tool list it read at start; new tools reach the next session.

## Factory MCP and Block ids

Factory MCP is stateless Streamable HTTP on the host-local listener only: the approved-client
listener answers `/mcp` with `host_only`, and a request whose `Origin` is not the listener's own
origin is refused, so a cross-origin browser page cannot drive it. Requests may be up to 2 MB to accommodate whole Agent and Flow definitions.
Alongside the [authoring tools](#authoring-tools), its Block runtime tools are
`factory_get_block({ blockId })`, read-only `factory_get_run({ blockId })`,
read-only `factory_get_run_image({ blockId, imageId })`,
read-only `factory_get_condition_arrivals({ blockId, conditionBlockId, limit?, cursor? })` and
`factory_update_block({ blockId, to, exit?, message? })`, where `to` is `working` or `finished`.
A `waiting` report from an outdated instruction is refused with `WAITING_RETIRED` and current guidance.
[Title threads](#title-threads) call `factory_set_run_title({ titleGenerationId, title })` instead.
`factory_report` and `factory_context` are not exposed.

- **Block id.** Start mints one opaque id per Agent Block and Continuation of the Run, and every launch, visit, Continuation prompt
  and Request report message states it on a `Factory Block id:` line. The id is stable across
  visits; reports apply to the Block's current activation. Factory does not read native call
  metadata, the harness call id or the T3 timeline to identify a caller, so every reporting
  harness uses the same contract. Runtime calls without a Block id are `BLOCK_ID_REQUIRED`; ids Factory
  never issued are `UNKNOWN_BLOCK`. Ref-based calls from the replaced contract have no
  compatibility path.
- **Accepted risk.** Anything that knows a Block id can read and report for that Block,
  including a subagent the worker hands it to. Factory MCP is host-local for one user, so the
  expected failure is Agent confusion, not attack; the skill and tool descriptions tell
  workers not to share it.
- **Installation freshness.** The `$factory-block` skill is part of installation readiness.
  Readiness compares each installed copy with the backend's exact skill text, so any skill change
  marks earlier copies outdated. The skill explains `inputs.images` and tells workers to fetch
  relevant images with `factory_get_run_image`, not every image automatically.
  A missing or outdated skill is repairable and blocks Start.
  Repair does not rewrite running harness sessions: a worker keeps the instructions and tool
  schema already in its context until the harness reloads them.
- **Exit names.** The tool accepts the exact name or ID of one of the Block's exits in the Run's
  captured definitions; an exit hidden in the Flow, an unknown name or an ambiguous match is
  `INVALID_EXIT` with the allowed exit names. Finishing on an exit that requires a message without
  one is `FEEDBACK_REQUIRED`. Names are quoted in prompts, and the exact report content determines
  its fingerprint.

## Authoring tools

Any harness session with Factory MCP registered can author definitions without a Block id or an active Run:

- `factory_list_agents`, `factory_get_agent`, `factory_create_agent` and `factory_save_agent` list, read, create and save Agents, including a global Agent's [Project overrides](studio.md#agent-definitions); `factory_save_agent` requires the complete `projectOverrides` list.
- `factory_list_flows`, `factory_get_flow`, `factory_create_flow` and `factory_save_flow` do the same for Flows. Saves replace the whole graph; [Flow creation and layout](studio.md#validation-contract) support a graph and workspace in one creation and optional positions. Agent blocks read and write their optional `revisitInstruction` and `revisitContext` (`"keep"` or `"fresh"`), Condition blocks their ordered `rules` and fixed `otherwise`, and the graph its [Finish block](studio.md#finish-block) `finish` with ordered `endings` and wires that enter an ending by `targetEndingId`, under the same [graph shape](studio.md#graph-shape) rules as Studio. Create and read keep ending IDs and per-ending wires unchanged; the graph description explains arrival numbering, first-match selection, the ending fields and the Condition and ending readiness rules.
- `factory_check_flow` checks the latest saved Flow's readiness using the same graph and saved-Agent checks as Studio's live readiness, including `agent_model_required` for a block whose Agent Needs a model, the Condition rule-row and cycle findings, and the Finish ending findings. Studio checks that readiness as the draft changes and has no Check readiness button. The tool does not validate an unsaved draft or establish live execution readiness.
- `factory_remove_agent` and `factory_remove_flow` remove an Agent or a Flow by id, exactly as Studio's [Agent removal](studio.md#agent-definitions) and [Flow removal](studio.md#removing-a-flow).
- `factory_change_agent_owner` and `factory_change_flow_owner` take the id, `expectedProjectId` and the new `projectId` and perform [Change owner](studio.md#ownership).
- `factory_preview_flow_duplicate` (`flowId`, optional `projectId`) answers a [Flow Duplicate](studio.md#ownership) plan and writes nothing; `factory_duplicate_flow` (`flowId`, optional `name`, the plan's `projectId`, `expectedRevision` and every planned Agent with its `choice`) commits it. `factory_duplicate_agent` (`agentId`, optional `name` and `projectId`) duplicates an Agent. An omitted `projectId` on the preview or Agent Duplicate keeps the source's owning Project.
- `factory_get_agent_capabilities` reads the live T3 catalog of environments, provider instances, models and model options, including each provider's `reporting.supported` flag and explanation.

There are no import or export tools; [Run Start tools](#run-start-tools) start Runs. The removal tools reverse the earlier decision ([#220](https://github.com/alimek/t3-factory/issues/220), user story 20) to leave deletion out of Factory MCP so that an agent could not destroy definitions.

Creates and saves use the same definition operations as Studio: the same validation, one immutable revision per accepted write and a required `expectedRevision` and `expectedProjectId` (the owning Project last read, `null` for global) on saves. A stale expected revision or owner returns a conflict and appends nothing; read the latest definition, reconcile the edits and save against its revision and owner. Saves never change the owner. Successful replies contain the Agent with its settings status or the Flow with its readiness. Every reply includes the definition's owning Project (`projectId`, `null` for a global definition). The create tools take an optional `projectId`, a Project id or `null` (the default) for a global definition. The list tools take an optional `projectId`: with it they return the global definitions and those that Project owns, without it every definition. Creates and saves refuse an `agent_scope_mismatch` placement like Studio ([Ownership](studio.md#ownership)), and the next step says which Agents a Flow may place. The owner-change and Duplicate tools call the same operations as HTTP, with the same refusals: a stale `expectedProjectId` (`stale_owner`) or a blocked move (`owner_change_blocked`, naming each blocking definition) changes nothing, and a Duplicate commit whose plan is stale (`stale_duplicate_plan`) or changes a fixed choice (`duplicate_choice_not_allowed`) creates nothing. Their next steps are to reread the definition and confirm its owner with the user, to ask the user before editing blockers or to duplicate into the target instead, and to preview again. Errors flag the tool call as failed and include a code, issue paths and a short next step without echoing arguments.

Removals call the same removal operations as Studio: a soft remove with no restore that keeps saved revisions, rejects later saves and leaves Runs, including active ones, on the revisions they started with. A removal takes only the id and no revision, and replies `{agentId, removed: true}` or `{flowId, removed: true}`. It also succeeds for an absent or already removed id, so success does not prove that the id existed; check the target in a fresh list first. A missing or empty id is a `validation` error with an `invalid_id` issue at the id path. Removing an Agent that the latest revision of a current Flow places is a `conflict` that removes nothing, with one `agent_in_use` issue at `agentId` per such Flow, ordered by Flow name; its message carries that Flow's stored id and name, and removed Flows never block. The shared removal returns the same issues to Studio and REST, and Studio keeps showing only the top-level message. Its next step is to ask the user before editing or removing those Flows, never to rewrite them unasked. The tool descriptions tell the agent to get the user's explicit confirmation naming the definition unless the request gives its id or a name matching exactly one current definition, to ask with names, ids and distinguishing details when several match or the target is inferred, and not to call the tool when nothing matches. That confirmation is guidance, not a server check.

Agent creates and saves require `execution`: complete settings, or `null` for an Agent that [Needs a model](../GLOSSARY.md#needs-a-model); an omitted key or a partial object is a `validation` error, and `factory_get_agent` returns `execution: null` and `settingsStatus: null` for such an Agent. Creates and saves with settings inspect live T3 capabilities and reject a listed provider without Factory reporting support (`harness_unsupported`), matching Studio's disabled provider choice. Model settings are validated structurally; unavailable environments, providers, models or options are reported in `settingsStatus` and gate Start rather than save. Definition changes, including imports, refresh the Run composer's launch choices and an open Studio's lists, counts and Agent library live. Open Flow and Agent editors follow their definition's saved revisions, where a conflicting draft uses Compare latest revision ([Following saved revisions](studio.md#following-saved-revisions)); a known removal keeps the editable draft with **Copy as JSON** and disables Save and other actions that need a current definition. Any save that still reaches a removed id, including one already in flight or sent through the API, errors and never recreates it. Disabled Save implements that backend guarantee in an editor that already knows about the removal.

**Widened local trust.** Factory MCP checks no credentials or caller identity and refuses non-loopback callers through its host-local access boundary. Authoring requires no Block id, approval step or revision authorship marker: any local process can edit and remove Agent and Flow definitions. The Origin check [above](#factory-mcp-and-block-ids) does not authenticate local processes. This extends the one-local-user trust model beyond runtime calls that require knowledge of a Block id.

## Run Start tools

Any harness session with Factory MCP registered can start a text-only Run without a Block id:

- `factory_list_projects` rechecks the T3 connection and Project catalog and lists the Projects of the current connection and environment with their availability. Given `workspaceRoot`, the canonical repository root of a T3 Project (T3's `t3_worktree_status` reports it as `projectWorkspaceRoot`, also from a worktree conversation), it matches that exact path and returns `matched` with the Project id, or explains `none`, `ambiguous` or `unavailable`. Separate clones have separate roots and stay distinct. It never consults Factory's remembered Project selection, names or Git remotes, substitutes another Project or registers one. Its `generateRunTitles` field says whether [Generate Run titles](runs.md#run-title-generation) is on, so a Run started now may have its automatic title replaced by a generated title shortly after Start. When Factory cannot read the setting, the field is `null`, never a guessed off, and `problem` says so. The skill's review says the title may be replaced unless a listing in the conversation returned `false`, so a review that skipped Project collection, with no listing reply, still says it.
- `factory_start_run` takes `requestId`, `projectId`, `flowId` and the exact prompt text as `input`, and calls the same Start operation as the [composer](runs.md#starting): the same validation and readiness gates, including the refusal of a Flow another Project owns (`flow_project_mismatch`, whose next step is to offer the Flows `factory_list_flows` returns for that `projectId`), the current saved Flow and Agent revisions at acceptance, the Flow's own workspace setting and asynchronous worker dispatch. The Run title is the prompt's first non-empty line. A rejection returns the actual issues and creates no Task, Run or worker; Factory repairs nothing.

Success is an acceptance receipt: the Run id, number, title, Project and Flow. Its title is the accepted automatic title, also when a title thread later replaces it. It does not show that workers started or finished, waits for neither and carries no link. One submission keeps one `requestId`: retrying it with identical arguments returns the same Run, also after a lost reply or a backend restart, because Factory reuses the accepted request's creation time; changed content under that `requestId` conflicts. A new Run, even with the same prompt, needs a new `requestId`. Images and attachments are not accepted here.

**Following a started Run.** The [Block runtime tools](#factory-mcp-and-block-ids) are scoped by a Block id, which only a
worker receives, so the starting conversation cannot read the Run through Factory MCP. Follow it in Factory by its
number, or read it on the Factory host with `GET /api/runs/:id` using the receipt's Run id ([Run HTTP API](runs.md#run-http-api)).

**Direct Start authority.** `factory_start_run` starts a Run as soon as it is called. The user-invoked [`factory-start-run` skill](installation.md#optional-skills) asks for review and explicit confirmation first, but that gate exists only in the skill's instructions: any local caller of Factory MCP can start Runs, launch workers and spend provider budget without it. The host-local boundary [above](#factory-mcp-and-block-ids) is unchanged; reaching Factory from a phone works by driving a T3 conversation on the Factory host, never by exposing Factory MCP remotely.

## Trigger tools

Any harness session with Factory MCP registered can inspect, set up, enable, check and remove [Triggers](studio.md#triggers) without a Block id. Only `factory_run_trigger_check` starts Runs immediately; enabling and some saves let the schedule start Runs later, and every tool description says which of these a tool can do. The inspection tools start nothing:

- `factory_list_triggers` lists Triggers, optionally for one `projectId`. The shared list operation takes no filter, so the adapter keeps the Triggers whose Project matches exactly; an empty `projectId` is a `validation` refusal rather than an empty list. A row carries `id`, `name`, `kind`, `projectId`, `flowId`, `schedule`, `enabled`, `error` (the current problem) and `latestCheck` (`checkedAt` with `started`, `waiting` and `notStartedCount`).
- `factory_get_trigger` (`triggerId`) reads one Trigger as the shared operation answers it: complete settings, `revision`, `enabled`, the confirmed repository, `nextCheckAt` (`null` for a manual or disabled Trigger), the latest check with the issues that did not start as `{issue, reason}`, and `error`, whose message carries the repair guidance Studio shows.
- `factory_preview_trigger` previews what a Trigger would start and saves nothing. A **new draft** omits `triggerId` and sends complete settings with a `projectId` and no repository; a missing setting is a `validation` refusal naming it, never a default. The adapter detects the Project's repository through the readiness operation and the shared preview evaluates and returns it, which the reply shows as `repository.detected` even when no issue matches, so a conversation never supplies or guesses one. A remote that cannot be read, or another blocker such as T3 launch support, is the preview's `problem` rather than an error. If the remote names another repository by the time the preview reads it, the problem is the repository mismatch, ahead of any other blocker, and `detected` is null, so the reply never offers one repository for create beside another repository's warnings; `detected` is otherwise null only when GitHub could not name the repository. An **existing Trigger** sends `triggerId` and `expectedRevision`. Without settings the adapter maps the saved definition to operation input, so the preview reviews exactly the saved revision; with complete settings it previews that edit against the saved repository. Either way its `problem` is the one a check of those settings would hit first, so a Flow or T3 launch blocker comes before a remote that no longer names the saved repository. `detectRepository: true` evaluates the Project's current repository instead, and `repository` then shows `saved` and `detected` side by side. A stale `expectedRevision` is refused before GitHub is read.

The reply keeps the shared preview's fields: `issues` that start now or wait, the `problem` a check would hit, `warnings`, the `gh` `login` and the `revision` it evaluated, set only when the preview matches the saved settings exactly. A problem, or no matching issue, is an answer rather than an error. Warnings include the [author-filter warning](studio.md#reviewing-what-starts) and a same-repository warning that lists the other saved Triggers watching the proposed repository, across Projects, including disabled ones and never the Trigger being edited. Both also hold for a preview whose problem stopped it before it read issues. The warning is part of the shared backend preview, so Studio's review and Factory MCP warn identically. The tool description names a new-draft preview as the review that creating and enabling a Trigger rely on.

Six more tools write and execute through the same shared Trigger operations as Studio and REST, so an MCP write publishes the change Studio listens to and Studio's lists and editors update live with their usual revision and removal notices:

- `factory_create_trigger` saves complete settings switched off and starts no Run; a missing setting is refused rather than defaulted. `github.repositoryNodeId` is optional and MCP-only: pass the node id the new-draft preview returned and the shared save rechecks it, refusing with the repository-mismatch issue if the Project's remote changed since; without it the adapter detects the node id through the readiness operation. A Flow that exists, may start in the Project and is not ready still saves off, as the shared contract allows. The reply is `{trigger, warnings}`.
- `factory_save_trigger` (`triggerId`, `expectedRevision` and complete settings) replaces the saved settings. A stale revision is a `conflict` with a next step. An ordinary save leaves out `github.repositoryNodeId`, and the shared save keeps the saved repository, so it never retargets. A retarget sends `github.repositoryNodeId`, the detected repository of the preview the user confirmed. The shared save accepts any named node id, the saved one included, only while the Project's folder still names that repository, and otherwise refuses with the repository-mismatch issue; a node id that is not a string, `null` included, is a `validation` refusal and nothing changes. The reply is `{trigger, warnings}`.
- `factory_enable_trigger` (`triggerId`, `reviewedRevision`) and `factory_disable_trigger` (`triggerId`) use the shared enable. A `reviewedRevision` that is no longer current is refused (`trigger_changed`). Enabling a switched-off Trigger advances its revision and arms the next check one interval ahead only when the schedule is on; it starts no Run. Disabling needs no review and leaves the revision unchanged. Both reply with the Trigger.
- `factory_run_trigger_check` (`triggerId`, `expectedRevision`, both required) runs the shared manual check once. A missing revision is a `validation` refusal; a revision the Trigger has moved past is an outer `conflict` with the nested `stale_revision` issue, and nothing starts or changes. A disabled Trigger is a refused call. The reply carries the `revision` it checked, `startedRuns` (`id`, nullable `number`, `title`), the `latestCheck` summary as the list shows it and the problem the check recorded as `error`, with `untrustedTextNotice`; it is a single JSON text item and has no `requestId`. A check that completes but hits a problem returns its result, with the Runs it started before the problem, rather than an error. A save or removal during the check changes neither the revision reported nor the Runs listed. A check whose outcome Factory could not report is an `internal` failure whose next step says not to call the tool again, to report the latest check and to point to **Started from**.
- `factory_remove_trigger` (`triggerId`) replies `{triggerId, removed: true}`, also for an absent or already removed id. Runs the Trigger already started keep running with their origin.

**Check revision.** The shared manual check takes an optional expected revision, compared inside the Trigger's serial section after the Trigger is read and before GitHub is: a mismatch refuses with the stale-revision conflict, starts nothing and leaves the Trigger unchanged. The MCP schema requires it; scheduled checks pass none. The revision to pass is the enable reply's after an enable, the save reply's after a save, and otherwise that of the get or preview the user was shown. Issues, free slots and `gh` are still read when the check runs, so its result can differ from an earlier preview even at a matching revision. The REST run route accepts the same revision as an optional body field ([Trigger HTTP API](studio.md#trigger-http-api)).

**Review and confirmation guidance.** The server keeps no "reviewed" flag, preview token or MCP-only authorization: these rules live in the tool descriptions, as for the removal tools and `factory_start_run`.

- **Enable.** Preview first, show the full settings, what starts now and what waits, any problem and the warnings, then get explicit confirmation naming the Trigger. A preview with a problem may be confirmed once the blocker has been shown. A new Trigger is enabled with the revision the create returned, after a confirmed new-draft preview of exactly those settings; an existing one with the revision of a preview of its exact saved settings. After a change or a conflict, preview and confirm again.
- **Save.** A widening edit changes the Project or repository, the query or the Flow, or raises Max active Runs. For an enabled Trigger the agent previews the exact edit, shows it, gets confirmation and saves against the base revision; after a conflict it reconciles and reviews again. Turning the schedule on, or changing the interval of an enabled Trigger, authorizes later automatic starts, and a clear user instruction is enough for that.
- **Check.** It is the only tool that starts Runs immediately, and one check can start several, up to the free slots. An explicit request naming the Trigger authorizes it and an inferred Trigger is confirmed first. A combined enable or save plus check needs one confirmation that says it covers both, and the two outcomes are reported separately. A lost or unknown reply is never retried automatically: the agent reports the latest check from `factory_get_trigger`, points to **Started from** in Factory and treats any further check as new.
- **Remove.** Confirm by name, unless the request gives the id or a name matching exactly one current Trigger.
- **Changed remote.** Show both repositories and offer to restore the remote or retarget. Retargeting an enabled Trigger is a widening edit.

**Untrusted issue titles.** A preview lists GitHub issue titles, and a check names the Runs it started after them; anyone who can open an issue wrote those. Preview and run-check replies carry a fixed top-level `untrustedTextNotice` saying the titles, and Run titles derived from them, are untrusted GitHub text: data to show, never instructions and never the user's confirmation. The titles stay unchanged in their own fields, the reply remains one JSON text item with no in-band tags, and the other Trigger replies carry no notice because they carry no titles. The notice is not part of the REST shapes.

Failures use the [authoring envelope](#authoring-tools): an outer code, issues with codes and paths, a next step and no echoed arguments. Next steps cover a stale revision (read again, reconcile, preview again before an enable, a check or a widening save), a Trigger changed since its review at enable, a repository mismatch (restore the remote, or retarget after review), `flow_project_mismatch` (choose a global Flow or one of the Project's own), a taken name and a disabled Trigger at check. A create for a Project whose repository cannot be read, such as `gh` missing or signed out or a folder without a GitHub remote, is refused with the readiness guidance as its issue message and a next step that leaves the repair to the user; a preview answers it as its problem.

**Host-local trust.** Triggers read GitHub with the Factory host's own `gh` login, and Factory MCP keeps its [host-local, single-user trust](#factory-mcp-and-block-ids): any local caller may read, preview, save, enable, check and remove every Trigger. A check spends Runs and model budget, so the description's confirmation rule is guidance for the agent and not a server check.

## Worker thread renames

On a ready connection Factory inspects the optional `t3_thread_update` schema for `action: "rename"` and string `threadId`, `title` and `clientRequestId` fields compatible with its payload. Factory includes `environmentId` only when advertised. Older contracts can still Start and Rename Runs locally. Title-generation threads keep their technical title, `Factory title · Run #<number> · <Run id>`.

The live context must match the Run's accepted context through credential selection and dispatch. New approval never transfers outstanding work to the replacement grant. A missing thread permanently retires synchronization for its binding. A capability denial pauses work under that grant without timed retries. Other failures leave a backend diagnostic and follow the [Runner retry rules](runner.md#worker-title-synchronization).

Factory checks the thread ID, action and returned title. A retained receipt and event can replay the original acknowledgement even after a manual edit. After event compaction T3 can instead return the current projection. A different title on first dispatch leaves the revision eligible for retry. On replay of a previously dispatched key, a different title closes that revision as superseded and leaves newer revisions eligible. A matching title acknowledges the command without proving what T3 currently displays.

## Title threads

[Run title generation](runs.md#run-title-generation) launches one title thread per pending generation, beside the
Flow.

- **Launch.** A top-level thread in the Project checkout (`root` strategy, also for a worktree Run) with the provider
  instance, model and options captured at Start, `interactionMode: "default"` and no `runtimeMode`, like a worker. Its
  title is `Factory title · Run #<n> · <Run id>`, which never matches a worker's
  `F#<n> <Block label> · <Run title>`; its request key also names the Run. The request, with its key, is recorded
  when Start accepts the Run. Just before dispatch Factory rechecks eligibility, confirms that the Run's saved
  authorization context is still the live one, marks the request sent and calls `t3_thread_launch` once. After
  [reauthorization](#credentials-and-reauthorization) the launch stays unsent, like any operation intent with a
  mismatched context, and the generation times out at its deadline. A definitive rejection fails the generation; a
  lost reply leaves it pending with no thread bound.
- **Launch provenance and recovery.** A sent launch with no bound thread is never sent again, also after a restart.
  Until the deadline, also after the generation's outcome, Factory searches the Project for its saved title and binds
  a thread only under the worker [launch provenance](#launch-provenance) rules: the one thread with that title,
  top-level, in the Project checkout, with the captured provider, model and options and exactly one matching
  execution. A launch still unbound at the deadline is abandoned; a thread T3 created for it stays an orphan in T3.
- **Prompt.** The first message is the fixed built-in prompt (version 1). It asks for a title in the prompt's language
  of at most 120 code points, treats the Run prompt only as text to title, forbids reading, searching or editing files,
  running commands and delegating, and carries the generation's opaque `titleGenerationId`. Factory keeps that
  capability out of everything other clients and threads can read: Run reads, timeline events and the thread's T3
  title and request key. The Run prompt follows as
  text with `[Image N: name]` labels; image bytes and attachments are never sent. The prohibitions are instructions,
  not enforcement: the model runs in the Project checkout with the user's T3 permissions.
- **`factory_set_run_title`.** Possession of the `titleGenerationId` scopes the call to one Run's generation, the same
  possession model as the Block id; Factory does not check which thread calls. Factory trims surrounding whitespace and
  requires one non-empty line of at most 120 code points without control characters; it never shortens a title.
  Replies:
  - `TITLE_APPLIED` with the title for the first valid submission while the generation is pending; an identical
    submission afterwards returns the same success and writes nothing, also after a Rename;
  - `INVALID_TITLE` with the reason; the generation stays pending, so the model can correct and resubmit;
  - `TITLE_ALREADY_APPLIED` for a different title after one was applied;
  - `TITLE_GENERATION_CLOSED` once the generation was dropped, timed out, cancelled, failed or skipped, and at or
    after the deadline; the outcome is unchanged;
  - `UNKNOWN_TITLE_GENERATION` for an id Factory never issued, including a Block id, and `TITLE_GENERATION_ID_REQUIRED`
    or `INVALID_ARGUMENT` for malformed calls, each with a static `reason` and `next` step in the Block tools' style.

The title thread has no thread binding, observation, report or attention, and is never treated as a worker. Factory
reads it only to learn whether it finished without a title before the deadline, and, after the outcome, sends at most
one `t3_thread_interrupt` with `stop: true` while it may still be running and one `t3_thread_organize` settlement once
it finished ([cleanup](runner.md#run-title-generations)); neither is confirmed.

## Reporting authority

The [Runner report contract](runner.md#report-acceptance) defines activation results, non-final working reports, held handoffs and manual Request report. The worker launch invokes the `$factory-block` skill once; its obligations then stay in the thread and apply to every later turn of that worker: it reports `working` when it starts a visit's work, ends a questioning turn with the questions instead of another report, keeps `working` rather than `finished` while questions, CI, review, delegated or background work are pending, puts evidence and artifact references in its result, treats Request report as an assessment of existing work and keeps Factory tools with the Block's own agent. The skill also obliges the worker to claim each tracker issue it starts work on, and to skip the claim when the repository describes none. The claim removes the [ready label](../GLOSSARY.md#ready-label) named in the Run's start data (`factory:ready` when it names none) and adds `factory:in-progress`, or the in-progress label the tracker document names, even when the document's claim operation predates this rule; removing the label is what stops a [Trigger](runs.md#starting-from-a-trigger) from starting the issue again. Factory itself performs no tracker write: the repository's tracker document owns how an issue is claimed, and the worker performs it in its own turn. Any change to these obligations changes the skill text, so earlier installed copies, including a retained development demo home's, are outdated until **Repair** ([installation freshness](#factory-mcp-and-block-ids)). Request report queues a short assessment request on the same worker thread.

Report rejections return `code`, a static `reason` and a safe `next` step. A rejection for a
known Block of an open Run also appears in Run attention; an unknown or missing Block id
returns guidance only. No rejection retries work.

### Worker reporting

Factory-launched Block workers report for their Block from any turn of their thread. There is no Run conversation. Questions and reply turns use the same worker, and a notification turn after delegated or background work may report too. Release waits only for the worker thread to be
[finished](runner.md#worker-thread-completion); Factory does not inspect the commands, subtasks or model selection of the turns that produced the result.

### Block and Run reads

`factory_get_block({ blockId })` returns the Block's current visit, reason, exits, inputs and allowed transitions, also while
Factory is still confirming the worker's launch. `exits` lists the exits the worker may finish with, each
`{ id, name, description, messageRequired, endings }`: its captured Agent revision's exits not hidden in the Flow, then the Flow-local
exits. `endings` lists the Finish endings the exit is wired directly to, each
`{ id, name, description, output, outputDescription }`; an exit wired to a Required ending reports
`messageRequired: true` for this Flow, and a blank `finished` report on it is `FEEDBACK_REQUIRED`. Endings reached through
another Block are not listed. For a
Continuation the reason is `continuation`, `prompt` is its captured prompt and `exits` is empty: the worker finishes
it without an exit, with its response as the message; `output: { messageRequired, endings }` carries the same ending
information for its single output. On a visit after the first to an Agent block whose
[Revisit instruction](runner.md#revisit-instructions) is set, `revisitInstruction` is the captured instruction and
`revisitRule` the conflict rule its message states, worded in
[Revisit instructions](runner.md#revisit-instructions). Both are omitted on a first visit or when the instruction is
empty. A Request report message never includes the instruction: it asks for an assessment of existing
work, not a new task.

The launch message contains the captured Agent prompt. The worker retrieves the original Run input and incoming Agent result
through this tool. `inputs.results` identifies the exact report that caused the current visit, with its `reportId`, source
`blockId` and `blockName`, selected `exitName`, `threadLink` and `message`. These `blockId` values name Flow blocks, not Block
ids. Other visits' reports and unrelated graph neighbors are not inputs to that visit. Flow-input visits have no incoming result.
A visit a [Wait](runs.md#waits) forwarded has reason `Wait`, no `inputs.results` and the forwarded message, unchanged, in
`inputs.feedback`; Archive clears it to null. The Wait's local timer calls no T3 operation; the deliveries it creates follow the
usual authorization and delivery guards. A visit a [Condition](runner.md#condition-arrivals) routed has reason `Condition`,
likewise with no `inputs.results` and the routed message, unchanged and possibly empty, in `inputs.feedback`.
A result the source Block replaces after hand-off does not change the inputs of a visit it already started.

`inputs.images` is the ordered manifest of the Run's immutable initial images, with entries
`{ imageId, ordinal, name, mimeType, sizeBytes }`. Its 1-based ordinal matches `[Image N: name]` in the Run's input,
including when names repeat. Runs without images return an empty list. Block reads return metadata, never image bytes;
the tool descriptions and read guidance explain the labels and [on-demand retrieval](#run-image-reads).

The result message is plain text: it can describe decisions, include artifact URLs or give repository paths. No output schema
declaration is required, and Factory does not automatically fetch linked artifacts. An Agent's prompt can specify an expected
format when the next step needs one; the reporting contract's message requirements still apply.

`factory_get_run({ blockId })` returns the Run `id`, `number`, `title`, `input`, `state`, `startedAt` and each Block's state and latest result, plus each
Condition's constant-size [summary](runs.md#conditions) (`blockId`, `arrivals`, `pending`, `latest`) without its arrival history,
and `result`: the [Run result](runner.md#reaching-an-ending) once the Run reached an ending, else null. A result holds
`endingId`, `endingName`, `output` (the delivered text, null for an ending whose output is None), `outputMissing`,
`sourceBlockId`, `exitId`, `authorBlockId`, `origin`, `deliveryId` and `acceptedAt`. It grants no routing authority.

`factory_get_condition_arrivals({ blockId, conditionBlockId, limit?, cursor? })` reads one page of
[Condition evidence](runs.md#conditions) for a Condition of the calling Block's Run: the same page, window, cursor and limits as
the HTTP read, as `{ code: "CONDITION_ARRIVALS", arrivals, highWater, nextCursor }`. `conditionBlockId` is a Flow block id from
`factory_get_run`'s `conditions`; `limit` is a JSON integer. A Block id resolves only its own Run, so another Run's Conditions
are unreachable. An unknown Condition, invalid `limit` or a cursor that does not continue this Condition's window is refused
with `UNKNOWN_CONDITION`, `INVALID_LIMIT` or `INVALID_CURSOR` and static guidance; as over HTTP, a modified cursor or one issued
before the server restarted does not continue a window.

### Run image reads

`factory_get_run_image({ blockId, imageId })` resolves the Block id by the same rules as other Block runtime tools, then
looks up the image only in that Block's Run manifest. It accepts no path, URL, storage digest or T3 upload id as an
alternate lookup. Success returns text identifying the image id, ordinal and name plus exactly one MCP image-content
item containing the stored original MIME type and bytes, without resizing or recompression. A URL or base64 embedded
in a text/JSON result is not the image-content contract.

Every worker of the Run can use this read regardless of activation: a Flow-input worker, a downstream checkout launch,
a worktree Block's worker launched on its first arrival, a revisit or a later user conversation. The same immutable images and
label bindings remain available unless their bytes were deleted manually; a worker that received launch attachments can
fetch an image again. The host-local MCP and Block-id access boundary above is unchanged.

Malformed arguments return `IMAGE_ID_REQUIRED` for a missing image id or `INVALID_ARGUMENT` for other malformed
arguments; existing Block-id validation still applies. `UNKNOWN_IMAGE` means the id is not in this Run's manifest,
including an id belonging to another Run. Missing or corrupt stored bytes return `IMAGE_UNAVAILABLE`; a transient read
failure returns `IMAGE_READ_FAILED` and may be retried. Errors carry the requested image identity when known and never
image bytes.

Reads create no intent, turn, activation, handoff, attention or execution/lifecycle change and are safe to repeat after
a lost response. A failed read does not fail the Block or raise attention: the worker decides whether it can continue
and explains blockers through normal conversation and reporting. Missing bytes required for a Flow-input launch instead
cause the [launch-time Block error](runner.md#run-images). Image reads grant no authority to replay a handoff or launch.

Controlled tests prove discovery and MCP image transport, not model vision. Live harness image-result compatibility
remains **UNVERIFIED**; see [bounded live verification](installation.md#bounded-live-verification).
