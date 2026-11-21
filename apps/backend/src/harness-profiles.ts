import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A home the instance's T3 settings can redirect: `homePath`, then `envName`, then the default. */
export type ResolvedHome = {
  readonly kind: "resolved";
  readonly envName: string;
  /** `null` means the config file sits in the OS home, not a subdirectory. */
  readonly defaultDirectory: string | null;
};

/** A home directory under the OS home that the harness always reads, whatever T3 configures. */
type FixedHome = {
  readonly kind: "fixed";
  readonly directory: string;
  /** What discovery tells the user about this home. */
  readonly message: string;
};

/** Where one reporting harness reads its user MCP servers and skills, and Factory's entry there. */
export type HarnessProfile = {
  readonly home: ResolvedHome | FixedHome | { readonly kind: "antigravity-profile" };
  readonly config: {
    readonly file: string;
    readonly format: "toml" | "json";
    readonly urlKey?: "serverUrl";
  };
  readonly entry: (url: string) => Record<string, string>;
  readonly skillsFolder: (home: string) => string;
};

const urlEntry = (url: string) => ({ url });
const homeSkills = (home: string) => join(home, "skills");

const profiles = {
  codex: {
    home: { kind: "resolved", envName: "CODEX_HOME", defaultDirectory: ".codex" },
    config: { file: "config.toml", format: "toml" },
    entry: urlEntry,
    skillsFolder: homeSkills,
  },
  claudeAgent: {
    home: { kind: "resolved", envName: "CLAUDE_CONFIG_DIR", defaultDirectory: null },
    config: { file: ".claude.json", format: "json" },
    entry: (url) => ({ type: "http", url }),
    // The default `~/.claude.json` keeps its skills under `~/.claude`; a configured
    // CLAUDE_CONFIG_DIR, whatever its name, holds both `.claude.json` and `skills`, which is where
    // Claude Code and T3's skill discovery read them.
    skillsFolder: (home) =>
      home === realpathSync(homedir()) ? join(home, ".claude", "skills") : homeSkills(home),
  },
  cursor: {
    // The Cursor SDK always reads os.homedir()/.cursor/mcp.json. A provider homePath would
    // point Factory at a file the harness never loads.
    home: {
      kind: "fixed",
      directory: ".cursor",
      message:
        "Cursor loads this user MCP file for every project. Install once; both Cursor provider instances share it.",
    },
    config: { file: "mcp.json", format: "json" },
    entry: urlEntry,
    skillsFolder: homeSkills,
  },
  grok: {
    home: { kind: "resolved", envName: "GROK_HOME", defaultDirectory: ".grok" },
    config: { file: "config.toml", format: "toml" },
    entry: urlEntry,
    skillsFolder: homeSkills,
  },
  antigravity: {
    home: { kind: "antigravity-profile" },
    config: { file: "mcp_config.json", format: "json", urlKey: "serverUrl" },
    entry: (serverUrl) => ({ serverUrl }),
    skillsFolder: homeSkills,
  },
} satisfies Record<string, HarnessProfile>;

/** Harnesses whose Block reports Factory can accept. */
export type ReportingDriver = keyof typeof profiles;

export const HARNESS_PROFILES: Readonly<Record<ReportingDriver, HarnessProfile>> = profiles;
