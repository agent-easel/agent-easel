# Desktop and approved clients

An Electron application for **macOS on Apple Silicon (arm64) only**, plus approved-client access for desktop and browser clients. Execution, report, Human, uncertainty, Settle and Archive
semantics are unchanged; see [Runs](runs.md). Packaging and release qualification are in [Release](release.md).

## Installation roles

Each installation has exactly one role, chosen on first launch and changeable in
**Settings → Desktop app**:

| Role | What runs on this computer | Data |
| --- | --- | --- |
| **Run a server** | The single authoritative backend (Runner, SQLite, reporting acceptance, T3 Code OAuth context) and its local panel | The existing user-level home `~/.agenteasel` (or `FACTORY_HOME`) |
| **Connect to a server** | Bundled UI only; no backend, Runner, T3 Code or reporting tooling | Desktop settings, the pinned server certificate and a Keychain-encrypted client credential |

An installation never hosts one AgentEasel and operates another at the same time. Switching
from server to client asks for confirmation (with the open-Run count) and stops the
backend in order; it never archives Runs. Local data stays where it is and is never copied
to or merged with another server. Switching back reopens the same home and reconciles.

A desktop server adopts an existing source installation's home: Flows, Agents, Runs,
the T3 Code connection and reporting registrations stay available. Only one backend may own a
home. If a source backend (`pnpm start`, `pnpm dev:prod`) or another app already owns
it, the desktop shows an actionable error with Retry; it never removes the live lock,
kills the other backend or starts with an empty home. The source backend reports the
same conflict in the other direction.

## Lifecycle

- Closing the last window leaves the server (and its Runs) running. The Dock icon and
  launching the app again reopen the panel at the view it last showed, unless a Dock click
  [routes](#notifications-and-dock-badge) to waiting Runs.
- The window reopens, also after Quit, at the size, position, and maximized or full-screen
  state it last had. A position on a display that is no longer connected falls back to the
  default size.
- Closing the last window also leaves [notifications and the Dock badge](#notifications-and-dock-badge)
  running, in both roles; they stop with Quit.
- **Settings → Desktop app → Show in the menu bar** (desktop only) is off by
  default. When enabled, a menu-bar icon shows the installation's role and status with
  **Open AgentEasel** and **Quit AgentEasel**. The choice is stored per installation and
  applies immediately, without a restart.
- **Quit** on a server with open Runs asks for confirmation: AgentEasel control stops,
  reports and transitions wait, and T3 Code work already started may continue. **Cancel**
  keeps everything running. Confirmed Quit shuts the backend down in order and
  releases ownership. Quit is not Archive; on the next start normal reconciliation runs
  before eligible work resumes. Quit with no open Runs needs no confirmation.
- Closing or quitting a client never affects its server.
- **Open AgentEasel in the background at login** is off by default. When enabled, a login
  launch starts with the remembered role and no window. No daemon, operation after
  logout or sleep prevention is provided.

## Connecting a client

The server owner enables **Settings → Devices & access → Allow approved devices on my
LAN or tailnet**. AgentEasel then serves a separate HTTPS listener (default port 4312,
all interfaces) and shows its addresses and certificate fingerprint. The plain-HTTP
loopback listener remains the host-local panel; requests to it from other machines are
refused.

A desktop client enters the address (`https://<LAN or Tailscale address>:4312`). The
app checks the server's handshake, shows the certificate fingerprint and asks the user
to compare it with the host panel. Pasting the panel's **Desktop link** (the
address followed by `#sha256=<fingerprint>`) verifies the certificate automatically. Confirming pins that certificate authority; the client then requests
access under a device name.

A browser profile opens the same HTTPS address. Trust the host's certificate on that
device first (**Browser certificate → Download** on the host panel, or the `/factory-ca.pem` it
serves, after comparing fingerprints). Installing the AgentEasel CA grants system-wide
issuer trust to the execution host and processes using its account; use it only for
a host you trust at that level. Alternatively configure a publicly trusted certificate such
as one from `tailscale cert` (see [transport security](#transport-security)).

Knowing or reaching the address grants nothing. Every desktop installation and browser
profile is approved individually on the host panel, where each request shows its
device name, kind and six-digit verification code. Waiting requests are listed first, and
the **Devices & access** navigation item shows an attention dot while one waits. Approve only
a request whose code matches the requesting screen. Approved clients have full normal AgentEasel access: Flows,
Agents, Runs, Human answers, attention, history and Run operations, with the existing
revision-conflict behavior. They can also install, repair and reinstall AgentEasel MCP in
**Settings → Agent reporting**. Clients control the authoritative server remotely:
commands execute on the server and reporting setup changes the server's harness files.
Keeping files and credentials on the server does not by itself restrict an operation
to its local panel. The T3 Code endpoint and host reauthorization remain host-only: remote
clients see their status and the "Managed on the AgentEasel host" chip.
When T3 Code needs approval, a remote client can choose **Authorize** or
**Open the page again** for the saved endpoint. Both open the host's browser.
See [T3 Code connection](t3-integration.md#authorizing). While the host's
[First-run setup](t3-integration.md#first-run-setup) is incomplete, an approved client waits
read-only on **Finish setup on the AgentEasel host** and opens the application once the host
completes it. Lifecycle and approvals are host-local
only; an approved client may check, download and install the server's own update
([updates](#updates)).

The Devices list shows Waiting, Approved, Revoked and Denied alongside the
device name, with the verification code for a waiting request and the last
seen time when available for other devices. Unanswered requests expire after
15 minutes. Up to ten can wait at once. **Deny** rejects a request.
**Revoke…** asks for confirmation, then removes access immediately, including
in open windows. Denied and revoked clients can request access again. If the
remote listener cannot start, its switch row shows **Couldn’t start**, address
and certificate rows are hidden, and the problem card keeps raw diagnostics
under **Technical details**.

## Connection states

| State | Client presentation |
| --- | --- |
| Connecting | Checking protocol and access |
| Unreachable (never connected this session) | Explanation, automatic retry, **Choose another server** on desktop |
| Pending approval | Verification code; waits for the host |
| Denied / revoked | Explanation and **Request access again** |
| Incompatible | Which side to update; product operations are blocked, the protocol is rechecked automatically, and local Application settings remain available |
| Synchronizing | The connection is open while active live scopes obtain fresh snapshots; retained data stays visible, mutations are disabled, browsing and navigation remain available. When catching up takes over 500 ms, the sidebar footer shows **Synchronizing…** with a neutral dot |
| Connected | The normal application with active live scopes synchronized |
| Offline after connecting | The last observed view stays; the sidebar footer shows **Offline** in the Error colour with its observation time (**Offline** alone when none was recorded), and nothing overlays the window controls, title strip or page headers. Mutations are disabled and never sent or queued, Studio's blocked primary actions show **Offline** as their reason, browsing and navigation remain available, and AgentEasel reconnects automatically and synchronizes |

A command whose response was lost is not repeated as new work: Start retries reuse
the original request key and resolve to the same Run, and Settle or Archive is never
reported successful without the server's response. Clients and servers interoperate
across releases when their protocol ranges overlap; see the
[compatibility range](#protocol-compatibility).

## Notifications and Dock badge

Every desktop installation, in either role, follows its server's Run navigation with its own
live subscription in the main process, independent of any window: the server role over the
supervised loopback backend, the client role over the pinned HTTPS connection with its
credential. A server, role, credential or backend change replaces the subscription; any loss
reconnects automatically. Browser profiles show no OS notifications, the menu-bar icon keeps showing only
role and status, and [Chat control](chat-control.md) notices are unaffected.

- **Dock badge**: the number of Runs with at least one pending **Needs input** or **Problem**
  matter, not the number of matters. Snoozed, Settled and Archived Runs (which leave navigation)
  do not count, nor do a Run's Human steps and native requests while a confirmed Settle is
  stopping or unresolved. More than 99 Runs show `99+`; none removes the badge. The badge does not depend on
  notification permission. Turning **Dock badge** off clears it.
- **Readiness**: only the installation's own subscription qualifies the badge and notifications:
  an accepted (approved, compatible) connection whose navigation snapshot is applied and
  current. While it is offline, unauthorized, incompatible, synchronizing after a gap, or the
  backend is stopped, the badge is cleared and nothing is notified from retained data.
- **Notifications**: matters that become pending in one committed change share one notification
  per Run, with `+N more` for the others; a later matter gets its own notification. A rise in a
  worker's native pending-question count notifies once per increase (1, 2, 1, 2 is two
  increases). By default the text is generic: "A Run needs your input" or "A Run has a problem".
  **Run details in notifications** adds the project, Run title and Block name; message,
  report or question text and paths never appear. Notifications play no sound and the Dock icon
  never bounces. Ordinary Agent chat questions are not attention and never notify.
- **Run finished**: with **Notify when a Run finishes** on, each time a Run newly becomes Settled
  automatically or at a Finish ending, one notification is posted for that Settled cycle. A
  manual Settle never notifies, whether it was made here, from another client, or from another
  client while this installation was offline. A Settle on a Run that already has a Run result
  counts as reaching its Finish ending and notifies, and so does a Finish settlement that
  completes after Retry settlement. Nothing is posted while a settlement is stopping or
  unresolved. A Run that returns to Active and settles again notifies again. By default the
  title is "A Run has settled"; **Run details in notifications** makes it
  "<Project> · <Run title>". The body is "Settled at Finish ending “X”" or "Settled": it never
  names the settlement kind and never includes prompt, report or output text or paths. [Chat
  control](chat-control.md) still reports "Settled manually." for its own notices; the desktop
  deliberately stays silent for manual settlement. Completion notifications leave the Dock badge
  and **Needs you** unchanged, and are not withdrawn because the Run has no pending matter.
- **Snooze and Settle hold**: a [Snoozed](runs.md#snooze-and-woke) Run is silent. Matters
  pending or appearing while it is Snoozed never notify, also after **Restore**, which returns it
  to the badge without a notification; new attention that wakes it (Woke) notifies as usual.
  While a confirmed [Settle](runs.md#settled-runs) is stopping or unresolved, answers are
  refused, so the Run's Human steps and native requests do not notify; its Problems, including
  **Settle could not stop workers**, still do.
- **Withdrawal**: a delivered notification is withdrawn, best effort, once none of the matters
  it announced still counts: they resolved, or the Run was Snoozed, Settled, Archived or held by
  a confirmed Settle. macOS alerts again for a notification posted again, so one whose matters
  resolve only in part is withdrawn and not replaced; the rest stay on the badge and never
  notify again. Withdrawing never makes a matter notify again. A completion notification is
  withdrawn, best effort and without alerting again, once its Run returned to Active, was
  Archived or no longer has a row, or its Settled cycle differs from the one in the current
  ready snapshot, also when the cycle changed while AgentEasel was offline or quit. Opening the Run
  in AgentEasel does not withdraw it, and a later Rename leaves a delivered banner unchanged.
- **Focused window**: while any AgentEasel window of this installation is focused, no notification
  is shown. Matters that became pending and Runs that settled meanwhile count as seen and never
  notify later, also after switching to another app.
- **Settings**: **Settings → Desktop app → Notifications** holds the per-installation switches
  **Notifications** (on), **Notify when a Run finishes** (off), **Dock badge** (on) and **Run
  details in notifications** (off). While **Notifications** is off, **Notify when a Run
  finishes** keeps its value but is disabled.
  They are stored with the desktop settings, apply immediately and are never synchronized
  through the server, so each Mac is tuned on its own. While **Notifications** is off nothing is
  shown; turning it on shows what is still pending, at most one notification per Run.
  Turning **Notifications** or **Notify when a Run finishes** on announces no Run that is
  already Settled.
- **Permission**: macOS asks the first time a notification would be shown, never at launch and
  never while it would be suppressed. AgentEasel reads the permission without a window at startup,
  before each delivery, when the app becomes active or the Mac wakes, and about every 60
  seconds; a newly noticed grant shows what is still pending, at most one notification per Run.
  A newly noticed grant announces no Run that is already Settled, except the one completion that
  prompted the request: it is posted after **Allow** if its Run is still in the same Settled
  cycle, also when a pending matter prompted the request together with it. A prompt that only a
  pending matter prompted exempts no completion, and Runs or cycles that settle while the prompt
  is open count as seen at **Allow**. The ledger keeps the last permission it
  observed, so a grant made in System Settings while AgentEasel was quit is noticed at the next
  launch and also announces no Run that is already Settled. A ledger that cannot be written
  does not stop AgentEasel from starting; a grant it could not record is noticed again, with the
  same baseline, at the next permission read once the ledger can be written, and a grant that
  follows a denial the ledger could not record has the same baseline. A denial leaves the badge working and AgentEasel never asks again. Settings shows the permission
  status and, after a denial, **Open System Settings**, which opens this app's page in System
  Settings → Notifications. A prompt left unanswered when AgentEasel quits counts as denied.
- **Restart and reconnect**: each installation keeps a ledger of what it announced in
  `desktop-attention.json` beside its desktop settings, per server. After a restart or reconnect
  the fresh snapshot catches up with at most one notification per Run for matters still pending
  that were never announced; matters that appeared and resolved meanwhile are never reported. A
  notification is recorded as attempted before it is posted, so a crash can lose a banner but
  never repeats one; one macOS refused is retried only at the next catch-up. An attempt that
  fails after macOS may have accepted it, such as one whose click listeners cannot be restored,
  stays counted and is never retried. Catch-up also posts
  one notification for each Run still Settled, automatically or at a Finish ending, in a cycle
  that was neither announced nor counted as seen; Runs that returned to Active or were Archived
  meanwhile stay silent, and no summary is posted. Cycles from a period when **Notify when a Run
  finishes** or **Notifications** was off are never replayed. The first ready snapshot of a server
  with no completion history, after an upgrade or **Forget server**, counts every Settled Run as
  seen; a switch turned on or a grant noticed while no snapshot is ready makes the next ready
  snapshot do the same. A Run's completion record is kept until the Run leaves Settled or is
  Archived, with no age limit, so a click after a cold launch opens it. After that the posted
  notification's record is kept while its banner is still in Notification Center, because
  withdrawal is best effort, and through the launch after it left, so a banner that outlived its
  Run still routes when it launches AgentEasel.
- **Routing**: clicking a notification focuses or opens the window and opens that Run as it is
  now: with the Block selected while exactly one matter the notification announced is still
  pending (a native request's Block offers **Open in T3 Code**), otherwise the Run overview. An
  Archived Run opens its read-only history and a Run that no longer exists shows that it is
  unavailable; both also hold for a completion notification, which always opens the Run
  overview with no Block selected, whatever state the Run is in, and opens the inspector where
  the overview and the Run result show, also when it was closed. Every click applies its route
  again, also when the window already shows that Run after the owner closed the inspector or
  changed the selected Block. A
  notification clicked after Quit relaunches AgentEasel and opens its Run once the
  connection is ready, behind the connection gate. A Dock click with no window open opens the
  single waiting Run (its Block selected when it has one matter), the Run list's
  [Needs you (N)](runs.md#run-list) filter when several wait, or the last view when none does; with
  a window open it only brings the window forward. Routing only navigates, never acts on a Run:
  Settings and Studio still ask before discarding unsaved edits, and leaving the New Run view
  keeps its draft. Clicks on another server's or a revoked selection's notifications open only
  the window. A revocation deletes the notification records the revoked selection had, also
  when another server is selected or the credential is replaced before the deletion runs, so
  their clicks still open only the window after the same server approves this client again,
  also after a restart and for a click made before the revocation that was still waiting behind
  other work. A client that must be approved again without a revocation (an unreadable Keychain
  credential, a session-only credential) keeps routing the notifications it posted, also after a
  restart. A notification posted before a revocation stays window-only for the rest of that launch even when
  the ledger could not record the revocation's deletion; a later launch cannot know it, so there
  such a banner routes again once the server is selected. Their
  accounting stays: one macOS refuses only after the revocation is
  retried at the next catch-up, and one it accepted or whose outcome is unknown is not.
- **Selection boundaries**: switching server or role, or the server refusing this client's
  credential after a revocation, clears the badge, withdraws the previous selection's
  notifications and ignores whatever the previous selection's subscription still delivers. A
  notification macOS accepts, or whose outcome is unknown, after it was withdrawn is withdrawn
  again, also when the ledger cannot record that outcome. The
  ledger is kept per server, so switching back without forgetting repeats nothing. **Forget
  server** deletes that server's ledger: connecting to it again announces what is still pending,
  at most one notification per Run. A revoked client keeps reconnecting; once its new access
  request is approved, alerts resume within about ten seconds.

Notifications are posted through `UNUserNotificationCenter` by a small native module, not
Electron's `Notification` API: Electron withdraws its notifications when the app quits and asks
for permission on its first call. Clicks arrive through Electron, which restores delivered
notifications only once permission is decided; a notification that relaunched AgentEasel is read
from the launch before any window opens. macOS accepts notifications only from an app registered from a
non-temporary location, so a package run from a temporary folder badges but cannot notify.

## Native window appearance

The sidebar title area drags the desktop window while macOS keeps its native traffic-light controls and the content uses the full window height. Studio, and Settings when it fills a small window, open as inset dialogs below the title-bar strip that holds the native controls. Product controls, dialogs and canvases stay
outside the draggable region, fullscreen and window controls stay native, and the background matches the application canvas of the effective [appearance](#appearance) while content loads. Browser clients keep their layout without desktop chrome.

## Appearance

**Settings → Appearance** offers **System**, **Light** and **Dark**. System is the default
and follows the device's Light or Dark appearance from the first frame, including changes
while AgentEasel is open. Light and Dark keep their selected mode when the device changes.
An upgrade keeps any saved Light or Dark value, including Dark saved as the former desktop
default. A profile or installation without a saved value uses System.

Each desktop installation and each browser profile per AgentEasel address saves its own
preference locally. Changing the server, role, T3 Code endpoint or authorization keeps that preference.
Every connection and startup gate has an **Application settings** entry, including in
browsers, and the preference works while offline. Visual rules are in the
[design system](design-system.md#light-and-dark).

Each desktop installation and each browser profile may also apply one custom color theme JSON in
**Settings → Appearance** (pasted or uploaded as a `.json` file). The config uses T3 Code's color theme
format v1 (`appearance`, `canvas`, `accent`, `colors`, `variants`; unknown fields such as `css` are
ignored) and is resolved, mapped onto AgentEasel's color tokens and validated under the
[contrast policy](design-system.md#custom-theme-colors) directly on the device. Each mode
(`light` / `dark`) applies its custom colors independently and falls back to AgentEasel's colors when
missing or unreadable. The **Appearance** header shows **Custom colors** when at least one mode
uses custom colors and **AgentEasel colors** otherwise. **Reset to AgentEasel** removes the custom config
and restores AgentEasel's colors. The source JSON is stored locally in the browser profile or desktop
installation (`localStorage`), re-validated on load and across browser tabs of the same origin, and
never travels to or through the AgentEasel server. If a browser blocks storage, the custom colors apply
until the tab closes and Settings explains why.

Support limits of custom theme configs:

- **Format.** T3 Code's theme file version 1 only (at most 128 KB UTF-8): `appearance` (`light` or
  `dark`), optional `name` (1–48 characters, defaulting to `Custom theme`), optional `#rgb`/`#rrggbb`
  `canvas` and `accent` seeds, and `colors`/`variants` records mapping up to 256 role names to color
  strings of at most 64 characters. Unknown extra fields (such as `css`) are ignored.
- **Base palette and variants.** The declared `appearance` starts from the palette generated from
  `canvas` and `accent` when both seeds are given, or from T3 Code Chat's base palette for that mode
  otherwise (including when only one seed is given), with `colors` overlaid on top. The opposite
  mode exists only when `variants[other]` is declared: T3 Code Chat's base palette for that mode with the
  variant's colors on top, never the seeds. Without that variant the opposite mode keeps AgentEasel's
  colors.
- **Mapped roles.** AgentEasel reads the twelve T3 Code roles it maps (`canvas`, `text`, `textMuted`,
  `placeholder`, `surfaceRaised`, `border`, `input`, `focus`, `accent`, `accentForeground`,
  `sidebar`, `sidebarForeground`) and ignores every other role. A config with neither seed pair nor
  any readable T3 Code role color is rejected.
- **Color syntax and translucency.** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with
  channels in 0–255, and `oklch()` with numbers or percentages. Unparseable color strings (such as
  named colors or `hsl()`) are ignored and reported, leaving the role at its base value. A mapped
  role resolving to a translucent color (alpha < 1) rejects that mode to AgentEasel's colors.

- On **desktop**, AgentEasel saves the preference with the installation's other settings.
  The effective mode drives native window chrome, dialogs and the window background.
  The bundled page opens and reloads with the effective mode already applied. If a
  preference change fails to save, AgentEasel restores the previous preference and appearance
  and shows the error in Settings.
- In the **browser**, the profile saves the preference for the AgentEasel address. The
  page applies the effective mode to its colors and the browser theme color before
  the stylesheet paints. Other tabs of that profile follow saved preference changes.
  If the browser blocks storage, the preference applies until the tab closes and Settings
  explains why.

## Application menu

The desktop app replaces Electron's default menu with its own: **AgentEasel** (About,
Settings, Check for Updates…, Hide, Quit), **File** (New Run, Close Window), **Edit**
(standard text-editing roles, which keep the clipboard working in text fields), **View**
(Command palette, Studio, Keyboard shortcuts, page zoom, Full Screen, Reload), **Go** (Back,
Forward, Previous/Next Run, Search Runs), **Run** (Snooze or restore, Settle, Archive…,
Rename), **Window** and **Help** (AgentEasel documentation). Registry commands
appear once the window shows the connected application. Command labels and
accelerators come from the [shortcut registry](keyboard-shortcuts.md) and follow the
user's customized bindings; an unbound command shows no accelerator. **Run** items are
disabled when the action is [unavailable](keyboard-shortcuts.md#command-behaviour) for the
Run open in detail, including while a Run action is running, and while no window is open. **Check for Updates…** checks this app only, with the result in the sidebar
footer control.

The renderer remains the only executor of registry commands. A key press is handled by
the page; a menu accelerator never runs the command a second time. Choosing an item with
the pointer sends the command to the renderer, which runs it through the same path and
overlay gating as the shortcut. Choosing one with no window open reopens the window
without running the command. **Close Window** (Mod+W) closes the window and leaves the
server running. **View → Reload** (Mod+R) reloads the window in every build; Force
Reload and DevTools exist only in unpackaged development builds, and packaged builds
also disable DevTools for the window. On Windows and Linux the
menu bar is hidden until Alt is pressed.

## Handoff to AgentEasel

The final T3 Factory release reads the tombstone described in [Migration from T3 Factory](#migration-from-t3-factory) in its data home (`FACTORY_HOME`, by default `~/.t3-factory`) or its desktop profile. If either file exists, T3 Factory starts no backend, window, attention or update check. It turns off its login item and shows one blocking dialog with **Open AgentEasel**, **Move T3 Factory to Trash** and **Quit**. Each choice ends the process. **Open AgentEasel** opens the download page when AgentEasel is not installed.

## Migration from T3 Factory

On launch, before its settings, window or backend start, the desktop app brings over a previous T3 Factory installation found at the default locations: the data home `~/.t3-factory` and the desktop profile `~/Library/Application Support/T3 Factory`. A desktop profile chosen with `FACTORY_DESKTOP_USER_DATA` (probes, side-by-side installs) never migrates, and with `FACTORY_HOME` set only the desktop profile is copied.

- **Preflight.** While T3 Factory runs (its desktop process, or a backend that holds the data home's lock), a dialog asks the user to quit it and offers **Retry** and **Quit**. AgentEasel never stops T3 Factory. It holds the data-home lock during the copy, so T3 Factory cannot start its backend meanwhile.
- **Data home.** When `~/.agenteasel` does not exist, the old home is copied into `~/.agenteasel.migrating`. The database comes from an online SQLite backup, including uncheckpointed WAL content, and must pass `PRAGMA integrity_check`. Then the staging directory is renamed to `~/.agenteasel` in one step. A failed or interrupted copy leaves the old home untouched; the next attempt discards the staging directory and starts over. An existing `~/.agenteasel` is kept and not overwritten, and the summary says so. Credentials, including the remote-access certificate authority, move with the home, so paired clients keep trusting the host.
- **Desktop profile.** Copied even for a client installation without a data home, and only into a profile that has no desktop settings yet: the desktop settings, the attention ledger (so delivered notifications are not repeated) and the UI partition's Local Storage, IndexedDB and storage quota database, which hold Run drafts, draft images, custom themes and shortcut and panel preferences. Caches, cookies, session storage and the pending update receipt are left behind. The remote server's Keychain-encrypted credential cannot be read by another app, so a client keeps its server and trust pin but asks to be approved again.
- **Finish.** If T3 Factory opened at login, AgentEasel registers itself as a login item. It writes `migrated-to-agenteasel.json` into the old data home and the old desktop profile, then shows a one-time summary of what is left to do. Each step is recorded in `previous-installation.json` in the desktop profile, so a retry continues where the last attempt stopped.

The old data stays as a backup. **Settings → Desktop app → Previous T3 Factory data** moves the old data home and desktop profile to the Trash after a confirmation, while T3 Factory is not running, and leaves a desktop profile holding only the tombstone so the old app keeps refusing to start. Thirty days after migration, and again every 30 days until the data is removed, a dialog on launch offers the same action.

## Updates

Release and beta builds check the AgentEasel update feed automatically on launch and every hour, so a running app shows a new Release or beta build in the sidebar without a manual check. **Settings → Desktop app → Updates** (desktop only) chooses the installation's **release channel**: **Stable** (tagged Releases) or **Beta** (nightly and
on-demand [beta builds](release.md#beta-builds) of main, plus newer stable Releases). Until chosen, an installation follows the channel of the build it runs. Changing the channel discards an update found on the
previous one and checks again; it is refused while a download is in progress. Leaving beta never downgrades: the installed beta stays until a newer Release exists, and Desktop app settings says so. The page header shows the update state and action. The Updates card shows the installed version, release channel and last check time when supported. The release-channel control is disabled during a download. Update failures keep their diagnostics under **Technical details**.

One control at the right of the Run sidebar footer drives the lifecycle for every installation this window can replace: the desktop app itself, and the server when the window talks to one through its update
API (a desktop client's remote server, or the server a browser profile uses). A desktop server is one target. Its states:

| State | Control | Click |
| --- | --- | --- |
| Idle | Circular arrow, **Check for updates** | Checks every target |
| Checking | Spinner | — |
| Up to date | Check mark, **Up to date · Stable 0.1.0**, for a few seconds after a check | Checks again |
| Available | Highlighted download arrow; tooltip shows the version and a short changelog | Downloads on every target that has an update; nothing downloads on its own |
| Downloading | Percentage; tooltip shows the version and percentage across targets | — |
| Ready | Highlighted arrow, **Update downloaded · Click to upgrade client + server** (or one of them) | Opens the upgrade review |
| Upgrading | Spinner, **Upgrading…** | — |
| Error | Warning, **Update failed · Click to retry** | Shows what failed, e.g. **Server update failed · Client kept**, with **Retry** |

The sidebar and Desktop app page open the same centred confirmation, **Upgrade
to *version*?** for one target or **Upgrade client + server?** for two.
**Upgrade** starts installation and **Cancel** dismisses the confirmation.
Ordinary Quit never installs. With two targets
the server installs first: the client waits until the server answers its handshake with the target release and only then restarts. If the server does not return on that release within ten minutes, or reports an
installation error, the upgrade stops with **Server update failed · Client kept** and the client is unchanged. A browser reloads its UI after the server upgrade.

A server update keeps data, role, reporting registrations and T3 Code connection; Runs are not stopped and reconcile after restart, and clients go **Offline** meanwhile and reconnect automatically. The server's channel
is chosen on its host. A server running from a source checkout, a development package or a release without the update API is not an upgrade target. Connection and startup gates without a sidebar keep a contextual
**Application settings** entry with the channel and the same control for this app only, including in incompatible and offline states.

The Available tooltip previews the changes in the offered version's notes. Each change is one line without author, PR or commit references and without its Conventional Commit prefix; four are shown, then **+N more**. Notes are always read as
text, never feed markup; a release without notes says so and does not block download. If installation fails before
replacement, AgentEasel clears the quitting state and reopens the same data home through normal reconciliation, keeping the error in the control.

## Browser access on the host

`pnpm start` and the desktop server keep serving the browser UI on loopback
(`http://127.0.0.1:4310`) as the host-local panel. Other devices use the approved-client
HTTPS address. AgentEasel sends no CORS approval headers on either listener.

### Local developer builds

Test packages show the release base plus `+dev.<HEAD>` (and `.dirty` for uncommitted
changes). Building locally does not increment the release version. Local packages
are updated by installing another local package; only release packages use the
release update feed. The macOS icon, menu-bar glyph and browser favicons use the
AgentEasel easel-flow mark shipped with the application.

## Two listeners, two trust domains

AgentEasel exposes two listeners with distinct trust boundaries:

| Surface | Binding | Trust | Routes |
| --- | --- | --- | --- |
| `host` | `host`/`port` from `config.json` (loopback by default), plain HTTP | Host-local: the socket peer must be a loopback address, plus the existing Host and mutation checks | All product routes, host-setup routes, live delivery (`/api/live`), AgentEasel MCP (`/mcp`), `/api/host/*` owner routes |
| `remote` | `remoteAccess.host`/`port` (default `0.0.0.0:4312`), TLS 1.2+ only | Approved client credential on every request | Product routes including live delivery (`/api/live`); host-setup routes answer `host_only`; owner routes do not exist |

The host surface keeps the [existing Host/Origin defenses](installation.md#configuration-and-storage).
A request whose socket peer is not loopback is refused with `host_only`, even when the
listener is bound to `0.0.0.0`, so plain-HTTP network access never reaches product data. Host-local trust is the same OS-user boundary that already protects the
database, credentials and AgentEasel MCP. Anything forwarding network traffic
into loopback (an SSH tunnel, Tailscale Serve, a reverse proxy, the `pnpm dev`
Vite proxy) extends that host-local trust and is not an approved-client path.

Live delivery upgrades `GET /api/live` to a WebSocket on either listener. It requires
an `Origin` exactly matching that listener's scheme and request Host, and a compatible
protocol range in the `protocol` and `minimum` query parameters because browsers cannot
set WebSocket headers. The remote listener also requires the approved desktop bearer
credential or browser cookie. Missing or incompatible protocol returns HTTP 426 and an
invalid credential returns HTTP 401 before upgrade; a missing or mismatched Origin is
refused with HTTP 403. Host peer and Host checks still apply. Revoking a client destroys
its live sockets and discards queued delivery; disabling remote access closes all remote
live sockets. Data already delivered cannot be retracted.

Remote product requests require an allowed Host (IP literals or `allowedHosts`), a valid
mutation guard with `Origin` equal to `https://<Host>`, a compatible declared protocol
and an approved client credential before any operation. Public
remote routes are limited to the handshake (`GET /api/protocol`), the caller's own
access state (`GET /api/client-access`), access requests (rate-limited to five per peer
per minute) and the public certificate (`/factory-ca.pem`); static UI files carry no
product data. Reporting installation is an approved-client product operation; it uses
the same server-side installer as the host panel and accepts only a discovered target
identifier, not a client-supplied filesystem path. [Trigger](studio.md#triggers) management is
likewise an approved-client product operation: bodies carry typed Trigger fields only, never commands,
flags, paths or environment, and every check runs the host's `gh` with AgentEasel's fixed arguments. AgentEasel MCP (`/mcp`), endpoint changes
(`PUT /api/connection`), host reauthorization (`POST /api/connection/authorize`, which
retires the current context), changing **Generate Run titles**
(`PUT /api/settings/run-titles`) and every [Chat control](chat-control.md) operation, reads
included (`/api/chat-control/*`), remain `hostOnly`: report ingress
therefore cannot become a bypass into general APIs, and the T3 Code grant never leaves the
host. `POST /api/connection/authorization/open` is the one connection mutation an
approved client may call: it only reopens a pending approval or starts one for the
saved endpoint in the host's browser, and never changes a ready or incompatible grant
(see [T3 Code connection](t3-integration.md#authorizing)). Its
response is the ordinary `T3Connection` status; consent URLs, OAuth state, verifier
and tokens stay on the AgentEasel host. The remote UI hides host-only controls, and the server enforces that boundary independently.

## Client identity, approval and revocation

The credential is `<client id>.<secret>`, issued once. Desktop clients send it as a
bearer token; browsers receive only an `HttpOnly; Secure; SameSite=Strict` cookie and
an empty credential in the body. Every request checks current approval, so revocation ends existing sessions immediately; disabling remote access
also closes open sockets. IP address, reachability, `Origin` and the client-chosen label
are never authority. Pending requests expire after 15 minutes and at most ten wait.
Last-seen activity never revives a revoked client.

This boundary is separate from Factory-to-T3 Code OAuth (host-only credentials in
`credentials/`) and from exact-execution report validation, which are unchanged.

## Transport security

Secure remote access uses either:

- **AgentEasel's own authority** (default): a P-256 CA
  (ten years) and a server leaf (397 days, renewed 30 days before expiry or when the
  machine's names change) with certificates covering loopback, every
  non-internal interface address, `<hostname>.local` and `allowedHosts`. Keys live in
  `credentials/tls/` (directory 0700, files 0600); the CA key never leaves it. The
  server presents the leaf plus CA.
- **A provided certificate**: `"remoteAccess": { "certificate": { "certFile": "/abs/cert.pem", "keyFile": "/abs/key.pem" } }`,
  for example from `tailscale cert`, which browsers already trust.

Desktop clients pin the authority (or system-trusted certificate) the user confirmed
by fingerprint. Requests run in the Electron main process over Node TLS with that CA as
the only trust anchor, while hostname checks remain mandatory for every pinned issuer,
including public roots. A changed LAN address must appear on the server certificate;
restart the server to reissue its leaf after interface changes. Browsers rely
on the OS trust store, so they need the AgentEasel CA installed or a provided certificate.

## Protocol compatibility

The current protocol is **27**. The server and the Desktop and browser clients require protocol **27**.

Protocol 27 adds three fields to each Run navigation row: the Settled-cycle id (the sequence of the
Run's latest `run-settled` event, which changes when a Run returns to Active and settles again), the
settlement reason (`automatic`, `manual` or `finish`) and the ending name captured in the Run result.
The ending name comes from the Run result, not the live Flow, and output text is never included. A
Settle on a Run that already has a Run result is recorded as `finish`. A protocol 26 client cannot
read the fields and a protocol 27 client needs a server that sends them, so each side shows the update
gate naming the peer to update. Existing approvals, credentials and stored data carry forward.

Protocol 25 removes the `WatchAppearance` live RPC and `ClientScope.appearanceSource` because
custom color themes are configured per device rather than polled from T3 Code. Protocol 24 and older
clients would subscribe to the removed RPC, and protocol 24 servers do not match this contract;
both sides are refused at handshake and told to update. Existing approvals and credentials carry
forward, and migration `125` drops the retired `appearance_snapshot` table on startup.

Protocol 26 adds [Join](studio.md) blocks to Flows and captured Run definitions, each Join's
[round summary and round events](runs.md#joins) to Run detail, the per-source Join read, and the
`join-integrity` attention kind. A protocol 25 client can neither draw nor save a Flow with a Join,
and a protocol 26 client needs a server that sends Join summaries, so each side shows the update gate
naming the peer to update. Existing approvals, credentials and stored data carry forward; the
portable definition format v7 still imports versions 1–7.

Protocol 24 made the [Finish block](studio.md#finish-block) optional in Flow and Run definitions.
Protocol 23 clients assume every graph has one, and protocol 23 servers would add it back on save.
Update both peers. Existing approvals and credentials carry forward.

Protocol 23 adds [Subflow authoring](studio.md), captured invocation evidence
in [Runs](runs.md), and portable definition format v5. A protocol 22 or older approved client
shows the client update gate before product screens open. A protocol 23 client connecting to
a protocol 22 or older server shows the server update gate. Update both peers to use the new
contracts. Existing approvals and credentials carry forward, and the host upgrades its stored
definitions, Runs, and import receipts on startup.

Protocol 22 added the [Finish block](studio.md#finish-block) with its endings to Flows and
captured Run definitions, connections that enter an ending, and the Run's `result` in Run detail.

Protocol 21 added the [First-run setup](t3-integration.md#first-run-setup) status read
(`GET /api/setup`) and the host-only completion (`POST /api/setup/complete`). Every client reads the
status before it opens the application and waits on the setup screen until the host completes it.
A protocol 20 or older server lacks the read, so a current client shows the server update gate
instead of waiting for a status that never comes. A protocol 20 or older client never reads the
status and would open the application while the host's setup is incomplete, so the server refuses
it at the handshake and it shows the client update gate; its approved credentials and stored data
are kept. This is an intentional transport break; it needs no stored-data migration of its own.

Protocol 20 added the `workerFinished` field in Run detail. That field lets the client distinguish
a completed turn from a finished worker thread when offering **Request report**. Protocol 20
clients required a protocol 20 server for it; older clients ignored the field and the server still
checked their requests before dispatch.

Protocol 19 added [Agent Create reservations](studio.md#agent-definitions). Clients on protocols
17 and 18 could still create Agents without a reservation, and a protocol 19 client showed the
server update gate when the server did not support reservations.

Protocol 18 adds the [Trigger operations](studio.md#trigger-http-api)
over the product HTTP API, a `triggers` list to the Studio live subscription (snapshots and change
sets) and the [Run origin](runs.md#starting-from-a-trigger) (`origin`) to Run detail and navigation.
Protocol 17 clients keep working against a protocol 18 server, since they never call the new routes
and ignore the added list and field. Protocol 18 clients refuse protocol 17 servers because
they manage Triggers in Studio.
Protocol 17 gave every
Flow and Agent an [owning Project](studio.md#ownership) (`projectId`, null for a global definition) that
create accepts, validates a Flow's unsaved content by its id (`POST /api/flows/:id/validate`) and names
each placed Agent's revision and owning Project in the answer. It also added Flow Duplicate (`POST /api/flows/:id/duplicate/preview`
and `POST /api/flows/:id/duplicate`, whose commit requires the plan's target `projectId`), an optional target `projectId` on
Agent Duplicate and Import commit, and
[Change owner](studio.md#ownership) (`PUT /api/flows/:id/owner` and `PUT /api/agents/:id/owner`); Flow and Agent saves
require the `expectedProjectId` they last read. A protocol 16 client neither sends those routes nor the expected owner, nor
compares those answers, and a protocol 17 or newer client needs a server that sends them, so each side
refuses the other at the handshake and shows the update gate; credentials and stored data are kept.
This is an intentional transport break beside migration `103`.
Protocol 16 added
[Condition](studio.md#canvas-and-block-configuration) blocks with their ordered rules, outputs and
fixed Otherwise output to Flows and captured Run definitions, with each Condition's
[routing summary and selection events](runs.md#conditions) in Run detail, and the
`condition-integrity` attention kind. Older clients can neither read nor save
such a Flow, so the server refuses them at the handshake before product screens mount and they must
update; their credentials and stored data are kept. A current client likewise refuses a protocol 15
or older server, which rejects or lacks Condition blocks, and shows the update gate naming the server.
This is an intentional transport break; it needs no stored-data migration of its own.
Protocol 15 added two required fields to each navigation attention matter: the worker's native
pending request count (`null` except for a native request, and until it is observed) and the Block
name. It also declared the attention kind for the **Settle could not stop workers** Problem, which is
about the Run: its Block id and Block name are `null`, in navigation matters and in Run detail
attention. Protocol 15 kept protocol 14 clients working, since they ignore the added fields and leave
an unknown attention kind out before reading its `null` Block id; protocol 16 refuses them.
Protocol 14 dropped the appearance grant from theme-color presentations and sources: colors come from
`t3_theme_read` over the T3 Code connection. Protocol 13 let an Agent have no execution settings (`execution` is `null`),
required the `execution` key on Agent create and save, and added Agent and Flow export and import
([definition export](studio.md#definition-export)).
Every compatible server therefore serves the Studio live subscription (`WatchStudio`) and names the
Agent revisions a Flow validation answer was resolved against ([Studio](studio.md#validation)), so
clients always subscribe. A client repeats the handshake whenever its live socket reconnects, so a
server replaced by an incompatible one shows the update gate without a reload.
Protocol 12 added the Studio live subscription and those Agent revisions. Protocol 11 added the
Flow's current revision to Run detail. Protocol 10 added the
theme-color live subscription (`WatchAppearance`) and the server identity and current theme-color
source in the client-scope answer for the host panel and approved clients. Protocol 9 changed manual
Settle: its request may authorize stopping workers (`stopWorkers`) and it answers a settlement
outcome with the Run instead of the Run alone, and Run detail and navigation carry settlement
progress; it also added Wait blocks with their durations and Wait arrivals. Older clients could
neither settle nor read current Flows and Runs. The published v0.4.1-beta.11 already carries
these wire changes while still declaring protocol 8, so protocol 8 does not identify one contract:
requiring 9 refuses beta.10 and beta.11 peers alike, and both must update. Their approved credentials
are kept, but every product request answers that the client must update. Older servers likewise show
the existing update gate before product screens mount (protocol **8** added Continuation blocks with
their prompts, the `sent` and `pass-through` block states and Continuation visits, protocol **7** replaced outcome-based block
exits with Agent exits, protocol **6** added Run prompt segments and image manifests, protocol **5** Starts with
staged images, protocol **4** Flow workspace settings, Run workspaces, navigation activity and
worker repository metadata, protocol **3** live delivery). Compatibility follows the declared
protocol range, not the application release.
Product HTTP API requests declare `X-Factory-Protocol` and `X-Factory-Protocol-Minimum`;
WebSocket upgrades declare the same range in the query as described above.
A pair is compatible when the client protocol is at least the server minimum and the
server protocol is at least the client minimum. Otherwise the server answers HTTP 426
`incompatible` naming the side to update, before authentication or any operation; the
remote surface also rejects product requests that declare nothing. The handshake and
public certificate download are exempt so ordinary browser navigation can obtain trust
material before negotiation. Project favicon `GET` and `HEAD` requests may omit the
protocol declaration because an HTML image cannot supply custom headers. These
binary reads still require an approved credential (desktop bearer or browser cookie),
check revocation, and reject an explicitly incompatible protocol. No other product
route gains this exception. `GET /api/protocol` returns
the server descriptor (protocol range and application release, `source` for source
runs) so clients decide before showing product screens. Raise the protocol for any
change a peer must understand, and the minimum only when older peers can no longer
interoperate safely; application releases never decide compatibility. This is
separate from T3 Code capability checks.

## Desktop security

The renderer always runs bundled UI on `factory://app` with context isolation,
sandbox, no Node integration, denied permissions and blocked navigation. Only requests from `factory://app` may use the privileged desktop bridge. Besides role, server, update, appearance and live-delivery operations, the bridge carries the [application menu](#application-menu): the renderer publishes registry labels, bindings and Run-action availability, which the main process validates and uses only to build the menu, and the main process sends back the identifier of a command chosen with the pointer. A menu publication is accepted whole or refused: anything but exactly the declared menu commands, each well formed, fails the bridge call and leaves the menu unchanged. Remote servers only answer API requests
relayed by the main process; they never load content into the window. The desktop
client credential stays in the main process, encrypted using Keychain; it is never exposed to the renderer.
Live delivery also runs through the main process: the renderer exchanges frames over a
private message port and never opens a network socket. The selected remote server uses
the same pinned TLS trust and hostname validation as HTTP; its credential is attached
only in the main process. The server role relays to its supervised loopback backend.
Switching servers, forgetting a server or changing roles closes existing live channels and invalidates in-flight access to
the previous selection. Late responses must neither attach credentials to another server
nor restore forgotten settings. Without Keychain, credentials remain session-only.
Remembered trust and encrypted credentials survive role changes; unreadable or unsupported
saved settings are kept aside rather than silently reused.
`FACTORY_DESKTOP_USER_DATA` selects a disposable profile for probes, as `FACTORY_HOME`
selects server data.

The AgentEasel CA is not name-constrained: other processes under the host account, including T3 Code workloads, can read its key. Browser system-wide trust therefore extends beyond AgentEasel; the desktop's app-scoped pin leaves the system trust store unchanged. Local approvals share the host account's trust boundary.

The ten-slot pending queue is an availability limit: peers may fill it until requests expire or are denied, while approved clients continue to operate. A certificate SAN does not authorize an HTTP Host name; add desired `.local` or tailnet names to `allowedHosts` as well.
