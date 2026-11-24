# Release

A Release is one AgentEasel product version, identified by a `vX.Y.Z` tag on a fixed commit and published only by the controlled `publish` job. macOS Apple Silicon packaging, signing and qualification are part of that Release. [Beta builds](#beta-builds) are a second, unqualified track built from `main`. Application behavior is in [desktop and approved clients](desktop-and-clients.md).

## Version ownership

release-please owns the product version in root `package.json`, using manifest mode with a single component at repository root (`.`) and release type `node`. `.release-please-manifest.json` records the last released version. Its `extra-files` configuration keeps `apps/desktop/package.json` equal to the root version; the desktop package remains the build identity input. The Release PR maintains root `CHANGELOG.md`. Do not edit versions by hand.

Conventional Commit PR titles supply the versioning input: squash merges use the PR title as the commit title, and the **PR title** workflow check validates titles on pull requests. `feat` increments the minor version and `fix` increments the patch version while the product is on 0.x; a breaking `!` increments the minor version before 1.0. To override the version, add a `Release-As: X.Y.Z` footer to the squash commit message when merging an ordinary change PR; the Release PR then proposes that version. Adding it when merging the Release PR has no effect, because that PR already fixed the version. See [contributing](../CONTRIBUTING.md#opening-a-pull-request).

## Toolchain and commands

Electron, electron-builder, electron-updater, `@electron/rebuild` and esbuild are pinned exactly in `apps/desktop/package.json` and the lockfile. Electron is kept one patch behind the newest when that
release is inside pnpm's minimum release age rather than adding an exclusion.

```sh
pnpm install --frozen-lockfile
pnpm desktop:package          # local build: base version + HEAD identity
pnpm desktop:package:release  # clean checkout, release version, optional release feed
pnpm desktop:package:beta 12  # clean checkout, beta build 12 of the next patch, optional feed
pnpm desktop:probe /absolute/report.json
pnpm --filter @agent-easel/desktop start   # stage, then run the shell from source output
```

`pnpm build` (and the quality gate) bundles `apps/desktop/build/` without native rebuild or network. Packaging rebuilds the native `fs-ext` addon for Electron in isolation; the workspace's Node binary must remain untouched so source operation and tests still work. Packaging needs Xcode Command Line Tools and network access for Electron
headers; output lands in `apps/desktop/release/` as `AgentEasel-<version>-arm64.dmg`, `-arm64.zip` (Squirrel.Mac input) and blockmaps. Filenames match GitHub's release download names so update metadata and checksums remain valid after upload.

## Build identity and assets

`apps/desktop/package.json` supplies the desktop build version, synchronized by release-please with the product version. Local staging and packaging never edit versions: local packages are `<release>+dev.<12-character-HEAD>` plus `.dirty` for uncommitted changes (the suffix identifies the commit, not a content hash). `pnpm desktop:package:release` requires a clean checkout, keeps the plain version and never publishes. `pnpm desktop:package:beta <N>` also requires a clean checkout and packages `<major>.<minor>.<patch+1>-beta.<N>`: above the current Release and below the next one, so the updater orders both tracks correctly. macOS bundle version fields stay numeric. Development packages omit the update feed and disable the updater even if release-feed variables are set; install another local DMG to test a newer local build.

Shipping artwork is checked in: the macOS icon (`apps/desktop/resources/icon.png`, 1024 px), menu-bar templates (`trayTemplate{,@2x}.png`) and browser favicons (`apps/frontend/public/favicon-{16,32}.png`);
electron-builder generates the ICNS. Packaging needs no external design service.

## Signing, notarization and release feed

These are deployment prerequisites, not repository content:

| Variable | Purpose |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID Application certificate; enables the hardened runtime and `resources/entitlements.mac.plist` (JIT only) |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Notarization (only with signing): `notarytool` in electron-builder's `afterSign` hook, then stapling with retries, because Apple's ticket service intermittently drops the connection from CI runners. The workflow's `stapler validate` checks retry the same way |
| `FACTORY_UPDATE_URL` | Generic update feed the package checks, readable without credentials; Release and beta builds use `https://agenteasel.app/updates` ([update feed](#update-feed-and-bridge-metadata)) |

Local packaging without signing credentials is **ad-hoc signed** without the hardened runtime (Apple Silicon kills unsigned binaries and Electron's fuse changes void its linker signature): it runs locally for probes but
is not a release and Gatekeeper rejects it on another Mac. The update location must be anonymously readable (a public release-assets repository or generic HTTPS feed) and no maintainer token may reach clients; the
updater makes unauthenticated requests, so a browser's GitHub login grants no access to private release assets. Without a feed the app reports updates as **unsupported**. Preparing a build neither publishes a release
nor authorizes changing repository visibility. Fuses: `runAsNode`, Node options and inspect CLI are off, cookie
encryption and embedded asar integrity are on, and the app loads only from asar.

## Release and update flow

The **Release** workflow (`.github/workflows/release.yml`) chains `release-please` → `source` → `build-macos` → `publish` → `landing` through job dependencies (`needs`). On every push to `main`, release-please opens or updates the Release PR, titled like `chore(main): release X.Y.Z`. It passes normal checks and main branch protection like any other PR. Merging that PR is the human decision to cut a Release.

After the merge, release-please creates an empty draft GitHub release for tag `vX.Y.Z` that targets that exact merge commit, with generated notes. It uses `draft: true` and no component in the tag. The tag itself is created only when `publish` publishes the draft, because old T3 Factory beta installations update from the newest semver tag ([update feed](#update-feed-and-bridge-metadata)). Job dependencies start the build in the same workflow run: GitHub does not deliver draft-creation events to Actions, and events caused by `GITHUB_TOKEN` do not start workflows.

`source` requires exactly one release named by the tag, still a draft, and takes its target commit, which must equal the release-please commit when cut in this run. A tag that already exists must point to that commit and produces a warning. Published releases are refused.

`source` also decides whether the build repeats the quality gate and browser journeys. It skips them only when the release commit has the same tree as the head of the merged Release PR and that head's latest **Quality gate** and **Controlled UI journeys** checks succeeded. The main ruleset does not require PRs to be up to date, so a Release PR merged behind `main`, a release commit without a merged PR or a missing or failed check makes the build run both. The run summary states which case applied.

`build-macos` calls the reusable **Desktop build** workflow (`.github/workflows/desktop-build.yml`), which beta builds share. It runs only on a macOS arm64 runner and checks out that exact commit. It verifies that root and desktop package versions equal the tag version, then runs `pnpm check` and controlled e2e browser journeys unless `source` reused them, followed by Developer ID signing and notarization, `codesign`, `stapler` and `spctl` validation, the isolated packaged probe, DMG/ZIP checks and SHA-256 checksums. Missing Apple credentials fail the build; there is no silent unsigned release. This job writes only Actions artifacts: `release-<tag>` holds downloads and `release-evidence-<tag>` holds evidence retained even on failure. It never writes release assets.

`publish` starts as soon as `build-macos` succeeds, without a second approval: merging the Release PR is the only human gate. `publish` alone writes release assets: it re-checks the draft and its target commit, verifies the complete artifact file set (DMG, ZIP, their blockmaps, `latest-mac.yml` and `SHA256SUMS.txt`) and checksums, and completes the notes. It then writes the update metadata: AgentEasel's own `agenteasel-mac.yml` and the frozen bridge copies `latest-mac.yml` and `beta-mac.yml`, and recomputes `SHA256SUMS.txt` over the final set. It removes any assets left on the still-draft release by an earlier failed attempt and uploads the complete set. It verifies asset names and SHA-256 digests on GitHub and the frozen bridge metadata on the draft before setting `draft=false`, which creates the tag, and marking the Release latest.

### Update feed and bridge metadata

AgentEasel installations update from the generic feed `https://agenteasel.app/updates`: the stable channel reads `latest-mac.yml`, the beta channel `beta-mac.yml`. Every Release and beta build carries its own metadata as the `agenteasel-mac.yml` asset, with absolute download URLs of its ZIP and DMG and the release's name and notes. The [landing deployment](#landing-page) writes the feed from those assets: `latest-mac.yml` from the newest Release, `beta-mac.yml` from the newest Release or beta build. A Release or beta build therefore reaches installations only after the landing deployment that follows its publication.

Old T3 Factory installations keep electron-updater's GitHub provider on the transferred repository. Stable installations read `latest-mac.yml` of the release marked latest; beta installations read `beta-mac.yml`, then `latest-mac.yml`, of the newest semver entry in the repository's release feed, which includes bare tags. Every AgentEasel release, stable or prerelease, therefore carries `.github/release/bridge-mac.yml` as both `latest-mac.yml` and `beta-mac.yml`. That frozen copy of the bridge release's metadata points at the bridge ZIP by a relative path (`../v<bridge>/T3.Factory-<bridge>-arm64.zip`), because the GitHub provider resolves every file under the selected tag, and sets its own `releaseName` and `releaseNotes`, so an old installation does not show AgentEasel notes for the bridge. The `publish` jobs fail when the committed copy is unusable or when either release asset is missing or differs from it (`node scripts/update-feed.mjs check-bridge <asset-dir>`).

These rules keep every old installation on the bridge:

- No semver tag exists without the frozen metadata attached. Releases are created as drafts without a tag and get their tag on publication; any other repository tag must not be valid semver.
- A frozen file is never corrected by overwriting a published asset: GitHub keeps serving the old asset to the updater for minutes. Fix the committed copy before publication.
- GitHub release assets named `latest-mac.yml` and `beta-mac.yml` are reserved for the frozen copy.
- The transferred repository is never recreated under its old name, which would break the redirect old installations depend on.

### Landing page

The product landing page in `apps/landing` is one static HTML page styled with Tailwind and built by Vite; `pnpm --filter @agent-easel/landing dev` serves it locally. The build reads the version from root `package.json`, so the download buttons, structured data and version labels of a build from the release commit name that Release's DMG. `FACTORY_SITE_URL` sets the absolute URL used by the canonical link, Open Graph and Twitter cards, `robots.txt` and `sitemap.xml`; it defaults to `https://agenteasel.app/`.

GitHub Actions owns the production deployment at `https://agenteasel.app/`. The reusable **Landing** workflow (`.github/workflows/landing.yml`) runs after a successful Release or beta `publish`, or on a push to `main` that changes `apps/landing` or the product version without cutting a Release. It uses the current `main` landing source when its root version matches the latest published Release. Landing-only changes wait if that version is still pending. After publication, if `main` has already advanced to a pending version, the job uses the published Release commit. It checks that the advertised DMG and checksums are publicly reachable before building, and verifies the built canonical and download links before deployment. Each deployment writes the [update feed](#update-feed-and-bridge-metadata) into `/updates/`. Serialized production jobs recheck the latest Release before uploading the prebuilt output to Vercel. A beta build redeploys the same site with a refreshed feed. Use **Re-run failed jobs** when only the landing job failed.

The same deployment proxies `/ingest/static/*` to PostHog Cloud EU's asset host and `/ingest/*` to its ingestion host. The website is static and the ingestion rules need no Vercel Functions.

The product screenshots in `apps/landing/public/screens/` are dark-mode captures of the running application (1472×920, 16:10) taken against the isolated demo fixture, and `apps/landing/public/og-image.png` (1200×630) pairs the current hero Run detail screenshot with the brand header. Refresh those assets in `apps/landing/public` when major product or UI changes land.

#### Vercel setup

1. Create a Vercel project with Root Directory `apps/landing`, the Vite preset, and access to source files outside the Root Directory for the pnpm workspace and root version manifest. Match the repository's Node.js major and let `vercel.json` supply the build command and output directory.
2. In Production Environment Variables, set `FACTORY_SITE_URL=https://agenteasel.app/`. Bind `agenteasel.app` as the production domain and configure its DNS using the records shown by Vercel.
3. Disconnect Git in the Vercel project so the Release workflow is the sole deployment trigger. If Git is connected during setup, set **Ignored Build Step** to a custom command of `exit 0` before enabling any deployment. Git-triggered builds must always be skipped, including on `main`, since Vercel's Git integration cannot verify Release publication. The branch rules in `vercel.json` allow only `main`; the workflow applies the landing path and version filter and uploads a prebuilt deployment. Disable the old GitHub Pages deployment source when switching over. See [Vercel's Git settings](https://vercel.com/docs/project-configuration/git-configuration), [Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel), and [GitHub Actions guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).
4. Set up the GitHub Actions environment `landing-production` for `main`. Add `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as environment variables and `VERCEL_TOKEN` as an environment secret scoped to the Vercel project’s owning account or team. The workflow pulls production settings, builds locally in CI, and deploys the prebuilt output to production.
5. Create a PostHog Cloud EU project and set its billing limit. In the GitHub repository's **Settings → Secrets and variables → Actions → Variables**, set `FACTORY_POSTHOG_PUBLIC_KEY` to the project's public ingestion token (`phc_…`). The shared desktop build embeds it in Release and Beta packages. An AgentEasel host can override the packaged token with `FACTORY_POSTHOG_KEY`. The Vercel proxy needs no project token. See [PostHog's reverse proxy guide](https://posthog.com/docs/advanced/proxy).

### Retry and failed qualification

Neither retry path bumps the version or moves the tag; both use the same tag and commit. **Re-run failed jobs** in the same run reruns only what failed: when only `publish` failed, it reuses the artifact from that run's successful build. When `build-macos` reruns, it replaces that run's artifacts and `publish` uploads the new build. Manually dispatching **Release** from `main` with `tag` naming an existing draft starts a new run with a new build. After publication nothing is overwritten: a fix needs a new commit and a new version.

If the build fails, the draft and tag remain. Retry as above, or leave them: the next Release PR proposes the next version. That version number is consumed; reusing it requires deleting the draft and tag, a destructive maintainer decision. If qualification of a published Release fails, fix it in a new version.

### Publication boundary

Publish only through the controlled `publish` job. Actions cannot disable the GitHub UI **Publish release** button on a draft. Assets are uploaded only at the very end by `publish`, so manual publication before that job starts exposes a release with no files, and `publish` then refuses because the release is no longer a draft. `publish` checks the draft state before it removes leftover assets and uploads; a manual publication after that check can still meet an in-progress removal or upload. With immutable releases enabled, GitHub rejects asset changes once the release is published, so the job fails instead of replacing files, but the published release may be incomplete. Neither the window between the check and the upload nor the one between upload and `draft=false` can be closed from Actions.

### GitHub Actions setup

The following are maintainer prerequisites outside the repository; workflow files do not configure them. Configure these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12`, exported with its private key |
| `CSC_KEY_PASSWORD` | Password chosen when exporting that `.p12` |
| `APPLE_API_KEY` | Complete contents of the App Store Connect team API key `.p8` file; CI writes it to a temporary file for electron-builder |
| `APPLE_API_KEY_ID` | That API key's Key ID |
| `APPLE_API_ISSUER` | The team's Issuer ID |

Developer ID requires active Apple Developer Program membership. The Account Holder can create a **Developer ID Application** certificate through Xcode's account settings. For notarization, create a **Team Key** with **App Manager** access in **App Store Connect → Users and Access → Integrations → App Store Connect API**, which `notarytool` authenticates with; the `.p8` file downloads only once. Keep the exported certificate, private key and API key outside the repository; CI removes its temporary API key even when a step fails.

Also configure:

- Squash as the only merge method (repository settings and the main ruleset), with the PR title as commit title and a blank commit message. The default **commit or PR title** would use a single commit's message instead, and a PR body in the commit could add unintended changelog entries: release-please also reads Conventional Commit lines and footers in the commit body.
- **Allow GitHub Actions to create and approve pull requests** in Actions settings, so release-please can open the Release PR with `GITHUB_TOKEN`. `pull_request` runs for PRs opened or updated by `GITHUB_TOKEN` require a maintainer's manual **Approve and run** before the required **Quality gate** runs. A GitHub App token would avoid that approval but is not configured.
- **PR title** as a required check in the main ruleset, alongside the normal required checks.
- **Immutable releases**, required for the guarantee that published files are never overwritten; see the [publication boundary](#publication-boundary).

A tag ruleset protecting `v*` from update and deletion is recommended so published tags stay fixed.

The workflows require a public repository: the update feed points at its release downloads, and old T3 Factory installations read its releases directly. The `AgentEasel-<version>-arm64.dmg` / `AgentEasel-<version>-arm64.zip` filenames match GitHub download names so metadata remains valid after upload.

### Maintainer qualification

Qualification happens after publication, because `publish` runs without an approval. Review generated notes, artifact hashes and verification evidence from the workflow; the evidence includes the packaged probe report for exactly this build. Install the published DMG on a clean Mac. For later Releases, also install it over the previous signed Release on disposable data and verify data and bridge preservation, server restart and reconciliation, and client reconnect. Keep hashes and results; never probe a production installation. Complete the applicable packaged, clean-user and live-integration checks below and record unverified cases explicitly. CI's Gatekeeper assessment on the build runner proves neither clean-user installation nor updates between signed Releases.

Verify an update from the previous signed Release through the app (download, **Cancel** in the review, ordinary Quit and relaunch with the update still offered, download again, **Upgrade**, and a client with its remote server) on disposable data right after publication. This risk is accepted: a published Release is never replaced, so a defect found in qualification is fixed by a new version.

Recipients install the first signed DMG manually; developer packages cannot bootstrap into the update feed. Release and beta builds check on launch and every hour, and from the footer or Desktop app settings.
Downloads and installation are explicit: the footer control downloads, and the upgrade review confirms installation; ordinary Quit never installs. A client connected to a remote server upgrades the server
first and restarts only once the server is back on its target release; a client update otherwise affects only that client. Compatible protocol ranges let clients and server update independently.

## Beta builds

A beta build is a signed prerelease of `main` for installations on the beta update channel. The **Beta** workflow (`.github/workflows/beta.yml`) runs nightly at 02:00 UTC and builds only when `main` moved since the
last published beta; a manual dispatch from `main` always builds. Its build number is the workflow run number, so its version is `<major>.<minor>.<patch+1>-beta.<run number>` of the current product version and its tag is
`v<version>`. release-please ignores these tags: it locates the last Release by the version in its manifest.

Before packaging, Beta reuses a successful **Quality** push run for the exact commit on `main` (or a passing PR **Quality gate** whose tested tree matches the Beta tree) and a successful full Chromium suite from the merged PR when the tree tested by the shards matches the Beta tree. A PR check that skipped the suite cannot certify the tree. For any missing result, Beta runs the corresponding gate on Ubuntu, using the same eight isolated shards as PRs for browser journeys.

The **Desktop build** job runs the Chromium keyboard shortcut journeys on macOS and verifies the signed, notarized package with Gatekeeper and the packaged probe. It writes `beta-mac.yml` for the Beta update feed. The
`publish` job of the Beta workflow then creates a draft prerelease targeting the built commit with notes generated since the previous beta, writes the same update metadata as a Release, uploads the complete asset set, compares SHA-256 digests, checks the frozen bridge metadata and publishes it
as a prerelease that is never marked latest. The landing deployment then refreshes the feed. A failed attempt deletes its own still-draft prerelease, which has no tag yet; the next run uses a new number.

Beta builds deliberately skip the release PR and maintainer qualification: they reach beta installations without a human gate. Choose the beta channel only for installations
that accept that risk. Stable installations never see prereleases because the feed's `latest-mac.yml` names only the newest Release. The feed's `beta-mac.yml` names the newer of the latest beta build and Release. The updater never installs an older version: an installation that leaves the beta channel keeps its
beta until a newer Release is published.

## Packaged verification and limits

For a Release, `build-macos` runs the probe against the unpacked application it built and keeps the report in `release-evidence-<tag>`; it then checks that the application inside both the ZIP and the mounted DMG has an intact deep signature, a stapled ticket and the same code directory hash as the probed application, so the downloads ship the probed bundle. Locally, `pnpm desktop:probe /absolute/report.json` probes the package in `apps/desktop/release/mac-arm64/`, so run it right after packaging that checkout; it does not read a downloaded artifact. The probe uses disposable application data and a mock keychain and checks package startup, role selection, backend lifecycle and the
AgentEasel MCP endpoint. It checks that the packaged host shows First-run setup, records completion through the host API in the disposable data home, then reloads the window and checks that New Run opens.
Keep its report with the release artifacts. Controlled browser journeys cover the setup interactions, approved-client transport and updater UI ([UI verification](testing.md)).

Acceptance procedures use a disposable application copy, HOME, desktop profile and data home with a minimal PATH and a mock keychain unless real Keychain persistence is under test; never touch a production installation or
its login items, and keep raw captures in ignored `.e2e/` with a summary in the PR.

- **Packaged authoring:** create and edit a Flow in the packaged Studio, quit, reopen in a fresh process and verify the same definition, graph and revision in the renderer and through public operations (source-API data
  does not prove renderer writes).
- **Packaged reporting:** with `ControlledT3` and the packaged backend's AgentEasel MCP, start a Run, submit an explicit report with the worker's Block id and verify acceptance, then successful source completion before
  the handoff; record whether the backend was source or packaged (`UNKNOWN_BLOCK` proves transport only) and re-test registration after an actual app-version replacement.
- **Native lifecycle:** with an open Run close the last window and verify API access, reopen, cancel native Quit and verify state, then confirm Quit and verify orderly shutdown and ownership release; after restart
  compare Run, report and execution state and separately verify reconciliation after T3 Code reconnect.
- **Role changes:** cancel and confirm server-to-client switching with an open Run, verify ownership release, return to server mode and compare definitions and history; exercise a configured remote endpoint and
  credentials across switches and client restart.
- **Remote access and login:** record the network route and certificate trust path for desktop and browser clients, including approval, denial and revocation, and test login startup in an isolated macOS account
  (changing HOME alone does not isolate login items).

These checks and controlled fixtures do not establish: Developer ID signing, notarization and Gatekeeper acceptance on a clean Mac; cross-device LAN/Tailscale routing, certificate SANs and browser CA trust;
updates between consecutive signed releases (including failed downloads, data and reporting-registration preservation, and independent client/server updates); the integrated lifecycle with connected T3 Code, retained remote credentials,
launch at login and real Keychain prompts; or live T3 Code OAuth and workloads through the desktop. Record each as PASS, FAIL or UNVERIFIED; an ad-hoc package probe is insufficient for public distribution.
