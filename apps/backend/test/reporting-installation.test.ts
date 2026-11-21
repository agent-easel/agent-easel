import { assert, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  driverHomes,
  reportingFixture,
  installedReportingFixture,
  installedReportingServer,
} from "./support/reporting.ts";
import { prepared } from "./support/prepared-runner.ts";
import { FACTORY_BLOCK_SKILL } from "../src/factory-block-skill.ts";
import { FACTORY_START_RUN_SKILL } from "../src/factory-start-run-skill.ts";
import { SETUP_FACTORY_SKILL } from "../src/setup-factory-skill.ts";
import { isolatedUserHome } from "./support/reporting-home.ts";

const MCP_URL = "http://127.0.0.1:4310/mcp";

it.for([
  {
    driver: "codex",
    config: ".codex/config.toml",
    before: '# keep this comment\nmodel = "sample"\n',
    after: `# keep this comment\nmodel = "sample"\n\n[mcp_servers.factory-runtime]\nurl = "${MCP_URL}"\n`,
    skills: ".codex/skills",
  },
  {
    driver: "claudeAgent",
    config: ".claude.json",
    before: JSON.stringify({ theme: "dark", mcpServers: { other: { command: "keep" } } }),
    after: `${JSON.stringify(
      {
        theme: "dark",
        mcpServers: {
          other: { command: "keep" },
          "factory-runtime": { type: "http", url: MCP_URL },
        },
      },
      null,
      2,
    )}\n`,
    skills: ".claude/skills",
  },
  {
    driver: "cursor",
    config: ".cursor/mcp.json",
    before: JSON.stringify({ theme: "dark", mcpServers: { other: { command: "keep" } } }),
    after: `${JSON.stringify(
      {
        theme: "dark",
        mcpServers: { other: { command: "keep" }, "factory-runtime": { url: MCP_URL } },
      },
      null,
      2,
    )}\n`,
    skills: ".cursor/skills",
  },
  {
    driver: "grok",
    config: ".grok/config.toml",
    before: '# keep\nmodel = "sample"\n',
    after: `# keep\nmodel = "sample"\n\n[mcp_servers.factory-runtime]\nurl = "${MCP_URL}"\n`,
    skills: ".grok/skills",
  },
] as const)(
  "installing $driver reporting adds Factory MCP to its user config beside unrelated settings and installs the Factory skills in its skill folder",
  async ({ driver, config, before, after, skills }, context) => {
    // Arrange
    const { factory, home, harness } = await driverHomes(context, {
      [driver]: { driver, config: {} },
    });
    await mkdir(dirname(join(home, config)), { recursive: true });
    await writeFile(join(home, config), before);
    const targets = await factory.getReportingInstallations();
    assert(targets.ok);
    const canonicalSkills = join(harness.processHome, "reporting", "skills");

    // Act
    const result = await factory.installReporting({ targetId: targets.value[0]!.id });

    // Assert
    assert(result.ok);
    expect(result.value).toMatchObject({
      provider: driver,
      status: "installed",
      launchSkill: "current",
      runtimeEvidence: "UNVERIFIED",
    });
    expect(result.value.path).toBe(join(await realpath(home), config));
    expect(result.value.skillsPath).toBe(join(await realpath(home), skills));
    expect(await readFile(join(home, config), "utf8")).toBe(after);
    expect(await readFile(join(home, skills, "factory-block", "SKILL.md"), "utf8")).toBe(
      FACTORY_BLOCK_SKILL,
    );
    expect(await readFile(join(home, skills, "factory-start-run", "SKILL.md"), "utf8")).toBe(
      FACTORY_START_RUN_SKILL,
    );
    expect(await readFile(join(home, skills, "setup-factory", "SKILL.md"), "utf8")).toBe(
      SETUP_FACTORY_SKILL,
    );
    expect(await readFile(join(canonicalSkills, "factory-block", "SKILL.md"), "utf8")).toBe(
      FACTORY_BLOCK_SKILL,
    );
    expect(await readFile(join(canonicalSkills, "factory-start-run", "SKILL.md"), "utf8")).toBe(
      FACTORY_START_RUN_SKILL,
    );
    expect(await readFile(join(canonicalSkills, "setup-factory", "SKILL.md"), "utf8")).toBe(
      SETUP_FACTORY_SKILL,
    );
  },
);

it("a configured Claude config directory keeps its config and skills directly inside it", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    claude: { driver: "claudeAgent", config: { homePath: "~/claude-work" } },
  });
  const configDirectory = join(home, "claude-work");
  await mkdir(configDirectory);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(result.value.path).toBe(join(await realpath(configDirectory), ".claude.json"));
  expect(result.value.skillsPath).toBe(join(await realpath(configDirectory), "skills"));
  expect(await readFile(join(configDirectory, "skills", "factory-block", "SKILL.md"), "utf8")).toBe(
    FACTORY_BLOCK_SKILL,
  );
  expect(
    await readFile(join(configDirectory, "skills", "factory-start-run", "SKILL.md"), "utf8"),
  ).toBe(FACTORY_START_RUN_SKILL);
  expect(await readFile(join(configDirectory, "skills", "setup-factory", "SKILL.md"), "utf8")).toBe(
    SETUP_FACTORY_SKILL,
  );
  expect(existsSync(join(configDirectory, ".claude"))).toBe(false);
});

it("installing Antigravity reporting registers MCP and skills in the selected T3 profile", async (context) => {
  // Arrange
  const { factory, state, home } = await driverHomes(context, {
    "agy-work": { driver: "antigravity", config: {} },
    "agy-other": { driver: "antigravity", config: {} },
  });
  const profiles = join(await realpath(state), "providers", "antigravity");
  const selected = join(profiles, createHash("sha256").update("agy-work").digest("hex"));
  const other = join(profiles, createHash("sha256").update("agy-other").digest("hex"));
  await mkdir(join(selected, "antigravity-acp"), { recursive: true });
  await mkdir(join(other, "antigravity-acp"), { recursive: true });
  await mkdir(join(selected, "config"), { recursive: true });
  const config = join(selected, "config", "mcp_config.json");
  await writeFile(config, JSON.stringify({ mcpServers: { other: { command: "keep" } } }));
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);
  const target = targets.value.find((target) => target.instances.includes("agy-work"));
  assert(target);
  expect(target.status).toBe("not-installed");

  // Act
  const result = await factory.installReporting({ targetId: target.id });

  // Assert
  assert(result.ok);
  const skills = join(selected, "config", "skills");
  expect(result.value).toMatchObject({
    status: "installed",
    launchSkill: "current",
    path: config,
    skillsPath: skills,
    instances: ["agy-work"],
  });
  expect(JSON.parse(await readFile(config, "utf8"))).toStrictEqual({
    mcpServers: { other: { command: "keep" }, "factory-runtime": { serverUrl: MCP_URL } },
  });
  expect(await readFile(join(skills, "factory-block", "SKILL.md"), "utf8")).toBe(
    FACTORY_BLOCK_SKILL,
  );
  expect(existsSync(join(other, "config"))).toBe(false);
  expect(existsSync(join(home, ".gemini", "config", "mcp_config.json"))).toBe(false);
});

it("Antigravity with no T3 profile points the user to provider setup", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, {
    antigravity: { driver: "antigravity", config: {} },
  });

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject([
    {
      provider: "antigravity",
      status: "needs-attention",
      path: null,
      message:
        "Install and sign in to Antigravity in T3 Code → Settings → Providers, then check again.",
      actions: { install: false, repair: false, reinstall: false },
    },
  ]);
});

it("Antigravity identifies the runtime folder when a file occupies its path", async (context) => {
  // Arrange
  const { factory, state } = await driverHomes(context, {
    antigravity: { driver: "antigravity", config: {} },
  });
  const key = createHash("sha256").update("antigravity").digest("hex");
  const profile = join(state, "providers", "antigravity", key);
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "antigravity-acp"), "");

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject([
    {
      status: "needs-attention",
      message: "The antigravity-acp folder inside the T3 profile must be a local directory.",
      actions: { install: false, repair: false, reinstall: false },
    },
  ]);
});

it("installs Mistral Vibe into its configured home and preserves its own MCP entries", async (context) => {
  // Arrange
  const { factory, home, t3 } = await driverHomes(context, {
    "vibe-work": {
      driver: "acpRegistry",
      config: { agentId: "mistral-vibe" },
      environment: [{ name: "VIBE_HOME", value: "~/vibe-work" }],
    },
    "mistral-vibe": { driver: "acpRegistry", config: { agentId: "another-agent" } },
  });
  const provider = { ...t3.projects.controlledProviders[0]!, driverKind: "acpRegistry" };
  t3.projects.controlledProviders.push(
    { ...provider, providerInstanceId: "vibe-work" },
    { ...provider, providerInstanceId: "mistral-vibe" },
  );
  const directory = join(home, "vibe-work");
  await mkdir(directory);
  const config = join(await realpath(directory), "config.toml");
  const before = '# keep\n[[mcp_servers]]\nname = "other"\ntransport = "stdio"\ncommand = "keep"\n';
  await writeFile(config, before);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);
  const target = targets.value.find(({ provider }) => provider === "mistral-vibe");
  assert(target);

  // Act
  const result = await factory.installReporting({ targetId: target.id });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({
    provider: "mistral-vibe",
    instances: ["vibe-work"],
    status: "installed",
    launchSkill: "current",
    path: config,
  });
  expect(await readFile(config, "utf8")).toBe(
    `${before}\n[[mcp_servers]]\nname = "factory-runtime"\ntransport = "streamable-http"\nurl = "${MCP_URL}"\n`,
  );
  expect(await readFile(join(directory, "skills", "factory-block", "SKILL.md"), "utf8")).toBe(
    FACTORY_BLOCK_SKILL,
  );
  const capabilities = await factory.getAgentCapabilities();
  assert(capabilities.ok);
  expect(capabilities.value.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        providerInstanceId: "vibe-work",
        reporting: expect.objectContaining({ supported: true }),
      }),
      expect.objectContaining({
        providerInstanceId: "mistral-vibe",
        reporting: expect.objectContaining({ supported: false }),
      }),
    ]),
  );
});

it("Vibe reporting cannot install into a home occupied by a file", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    "vibe-work": {
      driver: "acpRegistry",
      config: { agentId: "mistral-vibe" },
      environment: [{ name: "VIBE_HOME", value: "~/vibe-work" }],
    },
  });
  await writeFile(join(home, "vibe-work"), "keep");

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject([
    {
      provider: "mistral-vibe",
      status: "needs-attention",
      path: null,
      message: expect.stringContaining("Vibe's configured home must be a directory."),
      actions: { install: false, repair: false, reinstall: false },
    },
  ]);
});

it.for([
  { kind: "empty", servers: "", tail: "" },
  {
    kind: "populated",
    servers: '{ name = "other", transport = "stdio", command = "keep" }',
    tail: ', { name = "other", transport = "stdio", command = "keep" }',
  },
])("installs Vibe reporting into a $kind inline MCP array", async ({ servers, tail }, context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    "vibe-work": { driver: "acpRegistry", config: { agentId: "mistral-vibe" } },
  });
  const directory = join(home, ".vibe");
  await mkdir(directory);
  const config = join(directory, "config.toml");
  await writeFile(config, 'active_model = "sample"\nmcp_servers = [' + servers + "] # keep\n");
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);
  const target = targets.value[0]!;

  // Act
  const result = await factory.installReporting({ targetId: target.id });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(await readFile(config, "utf8")).toBe(
    'active_model = "sample"\nmcp_servers = [{ name = "factory-runtime", transport = "streamable-http", url = "' +
      MCP_URL +
      '" }' +
      tail +
      "] # keep\n",
  );
});

it("repairing Vibe's inline MCP entry keeps dollar signs in the new address", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    "vibe-work": { driver: "acpRegistry", config: { agentId: "mistral-vibe" } },
  });
  const directory = join(home, ".vibe");
  await mkdir(directory);
  const config = join(directory, "config.toml");
  const before =
    'mcp_servers = [{ name = "factory-runtime", transport = "streamable-http", url = "' +
    MCP_URL +
    '" }] # keep\n';
  await writeFile(config, before);
  const backend = "http://127.0.0.1:4999/$&/$$";
  factory.setRuntimeBackendUrl(backend);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(await readFile(config, "utf8")).toBe(before.replace(MCP_URL, () => backend + "/mcp"));
});

it("Vibe repair identifies an edited MCP entry and preserves its formatting", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, {
    "vibe-work": { driver: "acpRegistry", config: { agentId: "mistral-vibe" } },
  });
  const directory = join(home, ".vibe");
  await mkdir(directory);
  const config = join(directory, "config.toml");
  const edited =
    'mcp_servers = [{ name="factory-runtime", transport="streamable-http", url="' +
    MCP_URL +
    '" }]\n';
  await writeFile(config, edited);
  factory.setRuntimeBackendUrl("http://127.0.0.1:4999");
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(!result.ok);
  expect(result.error.message).toBe(
    "The Factory registration was edited. Review the factory-runtime entry manually.",
  );
  expect(await readFile(config, "utf8")).toBe(edited);
});

it("repeating a Codex installation after backend restart leaves its config unchanged", async (context) => {
  // Arrange
  const { factory, config, harness, options } = await reportingFixture(context, "codex");
  await writeFile(
    config,
    '# keep this comment\nmodel = "sample"\n[mcp_servers.other]\ncommand = "other"\n',
  );
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);
  assert((await factory.installReporting({ targetId: targets.value[0]!.id })).ok);
  const before = await readFile(config, "utf8");
  await factory.close();
  const reopened = await harness.open(options);

  // Act
  const result = await reopened.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(await readFile(config, "utf8")).toBe(before);
});

it("a provider without Factory reporting is listed as unsupported with nothing to install", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, { "test-provider": { driver: "pi", config: {} } });

  // Act
  const targets = await factory.getReportingInstallations();

  // Assert
  assert(targets.ok);
  expect(targets.value).toMatchObject([
    {
      provider: "pi",
      instances: ["test-provider"],
      status: "unsupported",
      path: null,
      launchSkill: null,
      actions: { install: false, repair: false, reinstall: false },
    },
  ]);
});

it("a provider instance whose key matches a discovery result's id is still a per-instance target", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, { unavailable: { driver: "pi", config: {} } });

  // Act
  const targets = await factory.getReportingInstallations();

  // Assert
  assert(targets.ok);
  expect(targets.value).toMatchObject([
    { kind: "instance", provider: "pi", instances: ["unavailable"], status: "unsupported" },
  ]);
});

it("an unreadable T3 settings file refuses discovery and names where Factory reads T3's state", async (context) => {
  // Arrange
  await isolatedUserHome(context);
  const { factory, state } = await reportingFixture(context);
  await writeFile(join(state, "settings.json"), "{ not json");

  // Act
  const targets = await factory.getReportingInstallations();

  // Assert
  assert(targets.ok);
  expect(targets.value).toHaveLength(1);
  expect(targets.value[0]).toMatchObject({ kind: "discovery-refused", instances: [] });
  expect(targets.value[0]!.message).toMatch(
    /^Cannot discover local T3 configuration: .+\. Check that T3 has run on this computer as this user, or set FACTORY_T3_STATE_DIRECTORY to the owning local T3 state directory\.$/,
  );
});

it("a conflicting configuration target exposes no repair action", async (context) => {
  // Arrange
  const { factory, config } = await reportingFixture(context);
  await writeFile(config, '{"mcpServers":{"factory-runtime":{"command":"someone-else"}}}');

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]!.status).toBe("needs-attention");
  expect(result.value[0]!.actions).toStrictEqual({
    install: false,
    repair: false,
    reinstall: false,
  });
});

it("a Factory entry for another backend address offers repair", async (context) => {
  // Arrange
  const { factory, config } = await installedReportingFixture(context);
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: { "factory-runtime": { type: "http", url: "http://127.0.0.1:4999/mcp" } },
    }),
  );

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]!.status).toBe("needs-attention");
  expect(result.value[0]!.actions).toStrictEqual({
    install: false,
    repair: true,
    reinstall: false,
  });
});

it("a conflicting Factory namespace is never overwritten", async (context) => {
  // Arrange
  const { factory, config } = await reportingFixture(context);
  const before = '{"mcpServers":{"factory-runtime":{"command":"someone-else"}}}';
  await writeFile(config, before);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(!result.ok);
  expect(result.error.message).toMatch(/Conflicting/);
  expect(await readFile(config, "utf8")).toBe(before);
  expect(targets.value[0]!.status).toBe("needs-attention");
});

it("default provider homes resolve from the user home without explicit homePath", async (context) => {
  // Arrange
  const home = await isolatedUserHome(context);
  const { factory, state } = await reportingFixture(context);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: {
        "codex-main": { driver: "codex", config: {} },
        claude: { driver: "claudeAgent", config: {} },
      },
    }),
  );
  await mkdir(join(home, ".codex"));

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value.length).toBe(2);
  expect(result.value[0]!.message).toContain("standard home for this OS user");
  expect(result.value.find((target) => target.provider === "codex")!.path).toBe(
    join(await realpath(join(home, ".codex")), "config.toml"),
  );
  expect(result.value.find((target) => target.provider === "claudeAgent")!.path).toBe(
    join(await realpath(home), ".claude.json"),
  );
});

it("provider instances disabled in T3 are neither listed nor inspected", async (context) => {
  // Arrange
  await isolatedUserHome(context);
  const { factory, state } = await reportingFixture(context);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: {
        claude: { driver: "claudeAgent", enabled: true, config: {} },
        codex: { driver: "codex", enabled: false, config: {} },
        grok: { driver: "grok", config: {} },
        opencode: { driver: "opencode", config: { enabled: false } },
      },
    }),
  );

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value.map(({ provider, instances }) => ({ provider, instances }))).toEqual([
    { provider: "claudeAgent", instances: ["claude"] },
  ]);
});

it("a provider instance a T3 project enables stays listed while the machine has it disabled", async (context) => {
  // Arrange
  await isolatedUserHome(context);
  const { factory, state } = await reportingFixture(context);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: { claude: { driver: "claudeAgent", enabled: false, config: {} } },
      projectSettingsOverrides: {
        "project-1": { providerInstances: { claude: { enabled: true } } },
      },
    }),
  );

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject([{ provider: "claudeAgent", instances: ["claude"] }]);
});

it("Grok reporting uses the standard home and stays not installed until install", async (context) => {
  // Arrange
  const { factory, home } = await driverHomes(context, { grok: { driver: "grok", config: {} } });
  await mkdir(join(home, ".grok"));

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  const grok = result.value.find((target) => target.provider === "grok")!;
  expect(grok.path).toBe(join(await realpath(join(home, ".grok")), "config.toml"));
  expect(grok.status).toBe("not-installed");
});

it("a provider without reporting shows the MCP address and no install action", async (context) => {
  // Arrange
  const { factory } = await driverHomes(context, { pi: { driver: "pi", config: {} } });

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  const pi = result.value.find((target) => target.provider === "pi")!;
  expect(pi.path).toBe(null);
  expect(pi.message).toMatch(/factory-runtime/);
  expect(pi.message).toContain("http://127.0.0.1:4310/mcp");
  expect(pi.actions).toStrictEqual({ install: false, repair: false, reinstall: false });
});

it("an unresolvable Codex home keeps its discovery message", async (context) => {
  // Arrange
  const { factory, state } = await reportingFixture(context);
  await writeFile(
    join(state, "settings.json"),
    JSON.stringify({
      providerInstances: { codex: { driver: "codex", config: { homePath: "relative/codex" } } },
    }),
  );

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]!.message).toMatch(/Relative provider homes/);
  expect(result.value[0]!.message).not.toMatch(/no installer/);
});

it("a different execution host never receives a local installation target", async (context) => {
  // Arrange
  const { factory, state } = await reportingFixture(context);
  await writeFile(join(state, "environment-id"), "another-machine");

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]!.path).toBe(null);
  expect(result.value[0]!.message).toMatch(/identity does not match/);
});

it("symbolic link configuration is not overwritten", async (context) => {
  // Arrange
  const { factory, config, home } = await reportingFixture(context);
  const other = join(home, "other.json");
  await writeFile(other, "{}");
  await symlink(other, config);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(!result.ok);
  expect(result.error.message).toMatch(/Symlink/);
  expect(await readFile(other, "utf8")).toBe("{}");
});

it("an installed Claude entry reaches the Factory tools on the listening backend", async (context) => {
  // Arrange
  const { config } = await installedReportingServer(context);
  const entry = JSON.parse(await readFile(config, "utf8")).mcpServers["factory-runtime"];
  const client = new Client({ name: "harness", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(entry.url)));
  context.onTestFinished(() => client.close());

  // Act
  const listed = await client.listTools();

  // Assert
  expect(entry.type).toBe("http");
  expect(listed.tools.map((tool) => tool.name)).toStrictEqual([
    "factory_update_block",
    "factory_get_block",
    "factory_get_run_image",
    "factory_get_run",
    "factory_get_condition_arrivals",
    "factory_set_run_title",
    "factory_get_agent_capabilities",
    "factory_list_agents",
    "factory_get_agent",
    "factory_create_agent",
    "factory_save_agent",
    "factory_remove_agent",
    "factory_change_agent_owner",
    "factory_duplicate_agent",
    "factory_list_flows",
    "factory_get_flow",
    "factory_create_flow",
    "factory_save_flow",
    "factory_change_flow_owner",
    "factory_preview_flow_duplicate",
    "factory_duplicate_flow",
    "factory_check_flow",
    "factory_remove_flow",
    "factory_list_projects",
    "factory_start_run",
    "factory_list_triggers",
    "factory_get_trigger",
    "factory_preview_trigger",
    "factory_create_trigger",
    "factory_save_trigger",
    "factory_enable_trigger",
    "factory_disable_trigger",
    "factory_run_trigger_check",
    "factory_remove_trigger",
  ]);
  expect(listed.tools.map((tool) => tool.inputSchema.required)).toStrictEqual([
    ["blockId", "to"],
    ["blockId"],
    ["blockId", "imageId"],
    ["blockId"],
    ["blockId", "conditionBlockId"],
    ["titleGenerationId", "title"],
    undefined,
    undefined,
    ["agentId"],
    ["name", "prompt", "execution", "exits"],
    [
      "agentId",
      "expectedRevision",
      "expectedProjectId",
      "name",
      "prompt",
      "execution",
      "exits",
      "projectOverrides",
    ],
    ["agentId"],
    ["agentId", "expectedProjectId", "projectId"],
    ["agentId"],
    undefined,
    ["flowId"],
    ["name"],
    ["flowId", "expectedRevision", "expectedProjectId", "name", "graph"],
    ["flowId", "expectedProjectId", "projectId"],
    ["flowId"],
    ["flowId", "projectId", "expectedRevision", "agents"],
    ["flowId"],
    ["flowId"],
    undefined,
    ["requestId", "projectId", "flowId", "input"],
    undefined,
    ["triggerId"],
    undefined,
    ["name", "projectId", "flowId", "schedule", "maxActiveRuns", "github"],
    [
      "triggerId",
      "expectedRevision",
      "name",
      "projectId",
      "flowId",
      "schedule",
      "maxActiveRuns",
      "github",
    ],
    ["triggerId", "reviewedRevision"],
    ["triggerId"],
    ["triggerId", "expectedRevision"],
    ["triggerId"],
  ]);
  expect(listed.tools[0]?.inputSchema.properties?.to).toMatchObject({
    enum: ["working", "finished"],
  });
});

it("repairing a Codex entry for another backend address replaces only Factory's entry", async (context) => {
  // Arrange
  const { factory, harness, options, config } = await reportingFixture(context, "codex");
  await writeFile(config, '# keep this comment\nmodel = "sample"\n');
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);
  assert((await factory.installReporting({ targetId: targets.value[0]!.id })).ok);
  await factory.close();
  const moved = await harness.open({
    ...options,
    runtimeBackendUrl: "http://127.0.0.1:4999/$&/$$",
  });

  // Act
  const result = await moved.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  const saved = await readFile(config, "utf8");
  expect(saved).toBe(
    '# keep this comment\nmodel = "sample"\n\n[mcp_servers.factory-runtime]\nurl = "http://127.0.0.1:4999/$&/$$/mcp"\n',
  );
});

it("the installed Factory Block skill names its trigger, the Factory tools and both reports", async (context) => {
  // Arrange
  const { factory, home } = await reportingFixture(context);
  const targets = await factory.getReportingInstallations();
  assert(targets.ok);

  // Act
  const result = await factory.installReporting({ targetId: targets.value[0]!.id });

  // Assert
  assert(result.ok);
  const installed = await readFile(join(home, "skills", "factory-block", "SKILL.md"), "utf8");
  expect(installed).toContain("name: factory-block");
  expect(installed).toContain("factory_get_block");
  expect(installed).toContain("factory_get_run");
  expect(installed).toContain("factory_get_run_image");
  expect(installed).toContain('to: "working"');
  expect(installed).toContain('to: "finished"');
  expect(installed).toContain("`blockId`");
  expect(installed).toContain("$factory-block");
});

it("a missing Factory Block skill stays repairable and Repair rewrites it", async (context) => {
  // Arrange
  const fixture = await installedReportingFixture(context);
  const skill = join(fixture.home, "skills", "factory-block", "SKILL.md");
  await rm(skill);
  const before = await fixture.factory.getReportingInstallations();
  assert(before.ok);
  expect(before.value[0]!.status).toBe("needs-attention");
  expect(before.value[0]!.actions.repair).toBe(true);
  expect(before.value[0]!.message).toMatch(/Factory Block skill/);

  // Act
  const result = await fixture.factory.installReporting({ targetId: fixture.targetId });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(await readFile(skill, "utf8")).toContain("name: factory-block");
});

/** The skill current releases install: it passes a Factory tool ref and has no working report. */
const RELEASED_SKILL = `---
name: factory-block
description: Work one Factory Block with the factory-runtime tools. Use when the thread's first message starts with $factory-block.
---

# Factory Block

This thread is one Block in a Factory Run. Factory takes the Block's result only from its tools, never from chat.

1. Call \`factory_get_block\` before any other work. Done when it returns your Block with its inputs and exits.
2. Work from this Agent's prompt and those inputs. Call \`factory_get_run\` when you need the rest of the Run as context.
3. Report with \`factory_update_block\`. Done when it returns an acknowledgement.
   - \`to: "waiting"\` when you need the user's reply, then end the turn.
   - \`to: "finished"\` with one of the Block's exits when the work is done.

When the message gives a Factory tool ref, pass it as \`ref\` on every Factory tool call. Factory tools belong to this thread's own agent; subagents work without them.

Every later turn in this thread, including feedback and user replies, starts again at step 1.
`;

it("a Factory Block skill installed by an earlier release needs attention until Repair replaces it", async (context) => {
  // Arrange
  const fixture = await installedReportingFixture(context);
  const skill = join(fixture.home, "skills", "factory-block", "SKILL.md");
  await writeFile(skill, RELEASED_SKILL);
  const before = await fixture.factory.getReportingInstallations();
  assert(before.ok);
  expect(before.value[0]).toMatchObject({ status: "needs-attention", actions: { repair: true } });

  // Act
  const result = await fixture.factory.installReporting({ targetId: fixture.targetId });

  // Assert
  assert(result.ok);
  expect(result.value.status).toBe("installed");
  expect(await readFile(skill, "utf8")).toContain('to: "working"');
});

it("a missing optional skill leaves reporting installed and offers Reinstall", async (context) => {
  // Arrange
  const { factory, home } = await installedReportingFixture(context);
  await rm(join(home, "skills", "setup-factory", "SKILL.md"));

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]).toMatchObject({
    status: "installed",
    launchSkill: "missing",
    actions: { reinstall: true },
  });
  expect(result.value[0]!.message).toMatch(/Reinstall and start a fresh session/);
});

it("an outdated harness launch skill leaves reporting installed", async (context) => {
  // Arrange
  const { factory, home } = await installedReportingFixture(context);
  await writeFile(join(home, "skills", "factory-start-run", "SKILL.md"), "older skill");

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]).toMatchObject({
    status: "installed",
    launchSkill: "outdated",
    actions: { reinstall: true },
  });
});

it("an outdated canonical optional skill leaves reporting installed", async (context) => {
  // Arrange
  const { factory, harness } = await installedReportingFixture(context);
  await writeFile(
    join(harness.processHome, "reporting", "skills", "setup-factory", "SKILL.md"),
    "older skill",
  );

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]).toMatchObject({
    status: "installed",
    launchSkill: "outdated",
    actions: { reinstall: true },
  });
});

it("Reinstall restores a missing launch skill and updates the outdated canonical copy", async (context) => {
  // Arrange
  const { factory, home, harness, targetId } = await installedReportingFixture(context);
  const skill = join(home, "skills", "factory-start-run", "SKILL.md");
  const canonical = join(
    harness.processHome,
    "reporting",
    "skills",
    "factory-start-run",
    "SKILL.md",
  );
  await rm(skill);
  await writeFile(canonical, "older skill");

  // Act
  const result = await factory.installReporting({ targetId });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ status: "installed", launchSkill: "current" });
  expect(await readFile(skill, "utf8")).toBe(FACTORY_START_RUN_SKILL);
  expect(await readFile(canonical, "utf8")).toBe(FACTORY_START_RUN_SKILL);
});

it("Repair installs required reporting and leaves a symlinked launch skill unchanged with its explanation", async (context) => {
  // Arrange
  const { factory, home, config, targetId } = await installedReportingFixture(context);
  const skill = join(home, "skills", "factory-start-run", "SKILL.md");
  const destination = join(home, "unrelated.md");
  await rm(skill);
  await writeFile(destination, "preserve");
  await symlink(destination, skill);
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: { "factory-runtime": { type: "http", url: "http://127.0.0.1:4999/mcp" } },
    }),
  );

  // Act
  const result = await factory.installReporting({ targetId });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ status: "installed", launchSkill: "outdated" });
  expect(result.value.message).toContain(skill);
  expect(await readFile(destination, "utf8")).toBe("preserve");
  expect(await readFile(config, "utf8")).not.toContain("4999");
});

it("Repair completes when launch-skill copies are FIFOs, without reading them", async (context) => {
  // Arrange
  const { factory, home, harness, config, targetId } = await installedReportingFixture(context);
  const skill = join(home, "skills", "factory-start-run", "SKILL.md");
  const canonical = join(
    harness.processHome,
    "reporting",
    "skills",
    "factory-start-run",
    "SKILL.md",
  );
  const fifo = join(home, "launch.fifo");
  execFileSync("mkfifo", [fifo]);
  await rm(skill);
  await symlink(fifo, skill);
  await rm(canonical);
  execFileSync("mkfifo", [canonical]);
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: { "factory-runtime": { type: "http", url: "http://127.0.0.1:4999/mcp" } },
    }),
  );

  // Act
  const result = await factory.installReporting({ targetId });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ status: "installed", launchSkill: "outdated" });
  expect(result.value.message).toContain("special or hard-linked file");
  expect(await readFile(config, "utf8")).not.toContain("4999");
});

it("an unwritable launch-skill location stays explained after Repair installs reporting", async (context) => {
  // Arrange
  const { factory, home, config, targetId } = await installedReportingFixture(context);
  const directory = join(home, "skills", "factory-start-run");
  await rm(join(directory, "SKILL.md"));
  await chmod(directory, 0o500);
  context.onTestFinished(() => chmod(directory, 0o700));
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: { "factory-runtime": { type: "http", url: "http://127.0.0.1:4999/mcp" } },
    }),
  );
  assert((await factory.installReporting({ targetId })).ok);

  // Act
  const result = await factory.getReportingInstallations();

  // Assert
  assert(result.ok);
  expect(result.value[0]).toMatchObject({ status: "installed", launchSkill: "missing" });
  expect(result.value[0]!.message).toContain(`${directory} is not writable`);
});

// A non-root user can lock a file against replacement only with macOS file flags.
it.runIf(process.platform === "darwin")(
  "a launch-skill copy that cannot be replaced keeps its actual failure after Repair installs reporting",
  async (context) => {
    // Arrange
    const { factory, home, config, targetId } = await installedReportingFixture(context);
    const skill = join(home, "skills", "factory-start-run", "SKILL.md");
    await writeFile(skill, "older skill");
    execFileSync("chflags", ["uchg", skill]);
    context.onTestFinished(() => {
      execFileSync("chflags", ["nouchg", skill]);
    });
    await writeFile(
      config,
      JSON.stringify({
        mcpServers: { "factory-runtime": { type: "http", url: "http://127.0.0.1:4999/mcp" } },
      }),
    );
    assert((await factory.installReporting({ targetId })).ok);

    // Act
    const result = await factory.getReportingInstallations();

    // Assert
    assert(result.ok);
    expect(result.value[0]).toMatchObject({ status: "installed", launchSkill: "outdated" });
    expect(result.value[0]!.message).toContain(`${skill} could not be replaced`);
    expect(await readFile(skill, "utf8")).toBe("older skill");
    expect(await readFile(config, "utf8")).not.toContain("4999");
  },
);

it("missing optional skills do not block Start", async (context) => {
  // Arrange
  const { f, input } = await prepared(context);
  const targets = await f.getReportingInstallations();
  assert(targets.ok);
  const config = targets.value[0]!.path!;
  await rm(join(config, "..", "skills", "factory-start-run", "SKILL.md"));
  await rm(join(config, "..", "skills", "setup-factory", "SKILL.md"));

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(result.ok);
  expect(result.value.id).toBeTruthy();
});
