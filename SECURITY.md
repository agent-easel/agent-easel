# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
[Report a vulnerability](https://github.com/agent-easel/agent-easel/security/advisories/new)
form. Do not include exploit details, secrets or user data in public issues or PRs.

If private reporting is unavailable, open a minimal issue asking the maintainer to
enable a private reporting channel. Include no vulnerability details in that issue.

A useful private report includes the affected commit/build, the relevant trust
boundary, prerequisites, minimal reproduction using dummy data, expected and actual
behavior, and the impact. Never send real credentials or a production database.
Coordinate disclosure with the maintainer before publishing details.

Reports are handled on a best-effort basis. There is no guaranteed response time,
security release schedule or bug bounty program.

## Supported versions

AgentEasel is in early development. Security fixes target the current `main` branch;
there is no maintained older release series. Check the
[compatibility limits](docs/installation.md#compatibility-and-support-limits) before
assuming a platform, provider or desktop distribution is qualified.

## Publishing source and artifacts

Review the Git history intended for publication and bundled release content for
credentials and private user data. Removing a file from the current tree does not
remove it from earlier commits; revoke exposed credentials before coordinating cleanup.

## Trust boundaries and operation

- The plain HTTP listener is host-local and rejects non-loopback peers. Other devices
  connect through the separate HTTPS listener after individual host approval;
  see [approved clients](docs/desktop-and-clients.md).
- An approved client can operate Flows, Agents and Runs and install or repair AgentEasel MCP
  in the server's harness configuration. Approve only devices you
  trust; revoke access on the host when no longer needed.
- The execution host, OS account, T3 Code, configured harnesses and selected project are
  trusted. AgentEasel does not isolate malicious processes running as the same OS user.
  A Flow's [workspace setting](docs/studio.md#workspace-setting) decides where its workers
  edit: new Flows give each Run its own Git worktree, shared by all of that Run's workers,
  and a project-checkout Flow works in the project checkout. A worktree separates Runs'
  edits; it is not a security boundary.
- Keep OAuth credentials, TLS private keys and AgentEasel data homes private. For browser
  clients, installing a host's AgentEasel CA grants broader issuer trust; compare
  fingerprints and read the [transport security guidance](docs/desktop-and-clients.md#transport-security).
- `pnpm dev --tailscale` exposes development tooling through the Vite proxy. Use the
  approved-client HTTPS listener for remote access to real data.
- Stopping the backend does not stop agent work in T3 Code. [Archive](docs/runs.md#archive)
  asks T3 Code once to interrupt the Run's worker threads without confirming termination, and
  [manual settlement](docs/runs.md#settled-runs) stops workers only when you choose to.
  Neither undoes repository edits.

Configuration presence and controlled tests do not establish live execution safety.
See [T3 Code integration](docs/t3-integration.md) and
[execution boundaries](docs/installation.md#execution-and-safety-boundaries).
