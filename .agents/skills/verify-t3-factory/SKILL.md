---
name: verify-t3-factory
description: Validate T3 Factory web UI changes, explore features for bugs, and capture screenshots or video using the isolated e2e fixture.
---

# Verify T3 Factory

## Read first

Read [the feature map](features/README.md). The cheat-sheet below covers the
commands you need; do not run `e2e --help` or `e2e guide` to rediscover them
(`pnpm exec e2e guide writing-tests|mcp|explore|bug-bash` only for a topic it
does not cover).
Run from the repository root. `e2e.config.ts` drives `tests/*.e2e.ts`;
`e2e.explore.config.ts` adds the exploration model. Use pinned Node/pnpm from
[installation](../../../docs/installation.md).

## CLI cheat-sheet

Run from the repository root; `pnpm build` first after application edits.

| Need | Command |
| --- | --- |
| Check discovery | `pnpm exec e2e list` |
| Run a spec | `pnpm exec e2e run tests/<name>.e2e.ts [--grep <title>] [--trace on] [--video on] --output .e2e/proof/<change>` |
| Before/after proof | `pnpm e2e:evidence --base <ref> <spec> --output .e2e/proof/<change>` |
| Diff two PNG sets | `pnpm e2e:evidence-diff <before-dir> <after-dir> [out-dir]` |
| Screenshots | `pnpm e2e:screenshots` |
| Explore (model) | `pnpm e2e:explore '<charter>' --max-steps 3 --output .e2e/bugbash/<slug>` |

Results land in `<output>/report.json` and `<output>/results/<test>/attempt-N/`
(`screenshots/`, `trace.md`, video). A spec may live anywhere under the repository,
including ignored `.e2e/`; it needs no config of its own.

## Launch

Run `pnpm install --frozen-lockfile`, then build and run the smoke check below.
The runner starts an isolated fixture on an allocated loopback port, waits for HTTP readiness and stops it afterward. Run `pnpm e2e:prepare` before a direct journey or MCP session. It reuses a matching UI build and builds the frontend and its dependencies when the signature is stale or missing. `pnpm test:e2e` and `pnpm e2e:screenshots` prepare automatically.
The fixture refuses to start (`APP_UNREACHABLE`, its log names the cause) when `apps/frontend/dist` is missing or its signature differs from the current inputs.
The fixture serves the production frontend and real SQLite backend in a fresh
OS temporary directory. It seeds development Runs plus authoring Agents and Flows against a controlled T3
simulator. Host and remote browser journeys share this Factory; the remote helper
selects its approved-client listener through a browser-profile cookie. No application login or live T3 is needed.
Each CLI run has its own data home/port. Within a run tests share seeded state;
keep `workers: 1` and use unique names for new records.

## Doctor

`pnpm exec e2e list` checks discovery without starting the app.
Build and run the model-free smoke:

```sh
pnpm e2e:prepare
pnpm exec e2e run tests/smoke.e2e.ts --trace on --output .e2e/doctor
```

It opens `/studio/flows`, checks the Flows
heading, New Flow action and seeded ready Flow, and captures a frame.
Exit 0 means the built app, browser engine and fixture work. On failure read
`.e2e/doctor/report.json` and the failed test's `trace.md` before driving further.

## Drive

For a live session, run `pnpm e2e:prepare` first, then use the registered e2e MCP server:
`open_session {target: "web"}`, `call {tool: "observe"}`, and
`call {tool: "locate", args: {role: "button", name: "New Flow", exact: true}}`.
Use the returned catalog for navigation/actions; locate each new locator before
adding it to a test. `call {tool: "screenshot"}` returns the current image;
`start_recording` / `stop_recording` capture a walkthrough. `close_session`
ends the attempt. MCP provides browser verbs, run_code, screenshots and recording;
there are no project tools, credentials or saved sign-in sessions.
Clients load `.codex/config.toml`, `.mcp.json` or `.cursor/mcp.json`; reload the
client if newly registered tools are absent. `pnpm exec e2e mcp` serves stdio for a
client; it is not an interactive shell command.

For regression proof, run the feature's mapped test with
`pnpm exec e2e run tests/flow-authoring.e2e.ts --trace on --video on --output .e2e/proof/flow-authoring`.
Use exact accessible names for deterministic paths. For variable flows use
`agent.act` with the explore config, and assert each goal's outcome.

## Evidence

Every PR that touches UI must include before/after screenshots of the affected views.
Before capture, name the user action, affected states and representative data. Use
persisted simulator/scenario data for long identities and multiple workers;
read the public API to confirm those values and links. Capture the rendered app
without replacing DOM text, API responses or CSS for evidence.
Capture the baseline from the PR base revision and the verified result in the same
viewport; use comparable states and explain differences in the PR.
One command does both: `pnpm e2e:evidence --base <ref> <spec> --output .e2e/proof/<change>`
(`<ref>` is the PR base, such as `origin/main`; `<spec>` is a `tests/*.e2e.ts` file or
a throwaway spec under `.e2e/`). It builds the base commit once in a cached worktree
under `.e2e/evidence-base/<sha>/` (reused while the base SHA is unchanged), builds the
current tree, runs the spec in each with the project config (fresh fixture per run) into
`<output>/before` and `<output>/after`, then runs the diff below. Do not write
per-change configs or hand-build base worktrees.
Embed both sets in the PR body's **UI screenshots** section as a `| Before | After |`
table with one row per view, Before on the left and After on the right, so each pair
compares side by side; GitHub scales each image to its column and opens it full size
on click. Write local references such as `![Before: <view>](./before.png)` in the
cells, then check the installed `gh pr edit --help` and run
`gh pr edit <PR> --body-file body.md --attach ./before.png --attach ./after.png`.
It uploads the files and rewrites matching local references to uploaded URLs;
attachments the body does not reference are appended at its end, outside the
table. Use this path when you can push to the repository; without push access
(for example from a fork), `--attach` cannot upload, so drop the images into the PR
description editor on GitHub into the same table cells. Do not use gists or other
hosting. On partial failure it still updates the body with successful uploads and
exits non-zero.
Then run `pnpm check:ui-evidence --pr <PR>`, the same validator as CI;
`pnpm check:ui-evidence --body-file <file>` (`-` reads stdin) checks a draft body
that already holds HTTPS image URLs.
Record the base/head commit, viewport, scenario and command alongside the images.
Capture After only after the last application edit; rebuild and repeat the affected
journey if the UI changes afterward. Inspect the evidence yourself, including
long text and each worker link, without reading raw PNGs one by one (each Read
costs context; one session read 44 images repeatedly). `pnpm e2e:evidence` already ran
`pnpm e2e:evidence-diff <output>/before <output>/after` (run it alone for sets captured
another way). Both runs fast-forward CSS transitions to their end state, and a pixel
counts as changed only above a small colour distance, so builds with no UI difference
diff as unchanged; a fixture-order change in a base older than the stable Flow order can
still show as changed. It pairs views by name, writes one `before | after | diff` contact sheet per
changed view to `.e2e/proof/<change>/contact-sheets/` and prints each view as
changed (with diff %), unchanged or unpaired. Read the summary, then each changed
sheet once; unchanged views need no image, and an unpaired view is the only case
for reading a raw PNG. Do not re-read after intermediate fixes; rebuild, recapture
and diff once. The **UI evidence attachments** CI check only
checks that one row of the two-column Before | After table holds an embedded HTTPS
image in both cells, outside HTML comments and code, accepting alt text with nested or escaped brackets;
it does not check their content, provenance or comparability. A non-empty reason under `### No UI evidence`
replaces both images for a frontend change without visible UI impact.
Human review still owns those judgments.

For Flow readiness, inspect every referenced Agent, including later branches.
Start's existing preflight reports all Agent blockers; fix every cause and retry.
Report configuration checks, accepted Start and accepted Block result separately.
Controlled fixtures prove these local stages, not live harness tool visibility or
model execution.

`pnpm e2e:screenshots` is a combined regression run: multi-test runs share seeded
state within one CLI run, unlike the isolated Before/After captures above.
It saves named PNGs for Flows, Agents, Runs, Agent reporting,
and a Flow before saving and after reload under `.e2e/screenshots/results/`.
Each output root has `report.json` listing exact artifact paths; `--trace on`
keeps passing traces too, and `--video on` keeps the action sequence.
In a test `await app.screenshot("name")` captures a named frame.
A new run clears that output root's `results/`; choose a distinct
`--output .e2e/proof/<change>` when evidence must survive later runs.

Prove the real user action and resulting state. Check durable writes via reload
and public API reads (Flow graph/revision, Runs and Human settlement), as existing
journeys do. SQLite files and temporary neutral repositories are removed on
fixture shutdown; capture assertions before shutdown. Preserve action/result
frames, trace and report, then return absolute clickable artifact paths.
Screenshots alone do not prove persistence or real T3 execution.

## Bug bash

Build and pass Doctor first. Read `pnpm exec e2e guide explore` and
`pnpm exec e2e guide bug-bash`; take goals from the feature map.
Use `pnpm e2e:explore '<charter>' --max-steps 3 --trace on --output .e2e/bugbash/<slug>`.
The model is `gpt-6-luna` through the OpenAI ChatGPT subscription (Codex sign-in).
Run `pnpm exec e2e login openai` yourself once (or add `--device`), then use
`pnpm e2e:explore` directly. `E2E_MODEL` optionally overrides Luna. No provider
selector or AI Gateway key is needed.
Credentials stay outside source control. No model auth is required for Doctor,
regression tests, screenshots or live MCP actions.

Explore only the disposable seeded projects and controlled connection. Each CLI
exploration gets a fresh fixture; run charters separately. Real OAuth, native T3
links, trust approvals and real workload execution require the separate
[human live runbook](../../../docs/installation.md#bounded-live-verification).
Read Findings and images; count a finding as a confirmed bug only after a
`tests/bugbash/<slug>.e2e.ts` repro fails with `ASSERTION_FAILED` at its intended
assertion. Report blocked charters and uncovered features explicitly.
`.e2e/`, including `.e2e/bugbash/`, is ignored.

## Cleanup

CLI teardown stops its own app and removes its temporary home/repositories.
Close every MCP session you opened; concurrent MCP sessions share the fixture
process/state, so use one writer at a time. Leave user-started servers alone.
Keep `.e2e/proof/`, screenshots and bug-bash evidence. Cleanup completes when
owned sessions/processes are closed and the report/artifact paths still exist.
