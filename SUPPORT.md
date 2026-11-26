# Support

AgentEasel is in early development. Support is best effort; there is no guaranteed
response time or production support commitment.

## Where to ask

- **Setup and usage:** start with the [README](README.md),
  [installation guide](docs/installation.md) and [T3 Code integration](docs/t3-integration.md).
- **Bugs:** search [existing issues](https://github.com/agent-easel/agent-easel/issues), then
  use the [bug report form](https://github.com/agent-easel/agent-easel/issues/new?template=bug_report.yml).
- **Ideas:** use the [feature request form](https://github.com/agent-easel/agent-easel/issues/new?template=feature_request.yml)
  and explain the workflow you want to improve.
- **Questions:** open an [issue](https://github.com/agent-easel/agent-easel/issues/new)
  with your question and what you have already tried.
- **Vulnerabilities:** follow [SECURITY.md](SECURITY.md); do not post exploit details publicly.

## Useful diagnostic information

Include the AgentEasel commit or desktop build identity, OS and architecture, Node and
pnpm versions for a source install, and whether you used the demo, source production
or desktop. For integration problems, include T3 Code/harness versions and the relevant
permission mode. Give the shortest reproduction and the expected and actual result.

For a setup or integration failure, turn on **Settings → AgentEasel → Diagnostic log**, repeat the
step that failed, then use **Copy** and paste its output into the bug report's Diagnostic log
excerpt. The preview shows exactly what is copied; review it before posting.

Share only a small, redacted error excerpt. Remove tokens, OAuth callback URLs,
credentials, private prompts, repository paths and host/device identifiers. Do not
upload an AgentEasel database, data home or complete trace by default.

The [compatibility limits](docs/installation.md#compatibility-and-support-limits)
distinguish controlled checks from live integration and supported release targets.
