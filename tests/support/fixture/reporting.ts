import assert from "node:assert/strict";
import { lstat, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FACTORY_START_RUN_SKILL } from "../../../apps/backend/src/factory-start-run-skill.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/** The Factory reporting the seed installs for Codex, and the runtime contract T3 advertises. */
export function reportingFixture({ factory, t3, home }: Host) {
  const codex = join(home, "reporting-codex");
  const requiredSkill = join(codex, "skills", "factory-block", "SKILL.md");
  const optionalSkill = join(codex, "skills", "factory-start-run", "SKILL.md");

  async function optionalSkillMatches() {
    try {
      const info = await lstat(optionalSkill);
      return (
        info.isFile() &&
        info.nlink === 1 &&
        (await readFile(optionalSkill, "utf8")) === FACTORY_START_RUN_SKILL
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  return {
    actions: {
      incompleteRuntime() {
        t3.contract.runtimeContractComplete = false;
      },
      async removeRegistration() {
        await rm(join(codex, "config.toml"));
      },
      async breakRequiredSkill() {
        await rm(requiredSkill);
      },
      async blockRequiredSkillWrite() {
        await rm(requiredSkill);
        await symlink(join(codex, "missing-skill"), requiredSkill);
      },
      /** Replaces the optional Start a Run skill with a link, which Factory leaves for the owner. */
      async linkOptionalSkill() {
        const path = join(
          await realpath(home),
          "reporting-codex",
          "skills",
          "factory-start-run",
          "SKILL.md",
        );
        await rm(path);
        await symlink(join(codex, "config.toml"), path);
        return { path };
      },
    },
    async reset() {
      t3.contract.runtimeContractComplete = true;
      await rm(join(home, ".cursor", "mcp.json"), { force: true });
      const required = await lstat(requiredSkill).catch((cause: unknown) => {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        return null;
      });
      if (required?.isSymbolicLink()) await rm(requiredSkill);
      // Factory refuses to replace a linked optional skill, so the fixture puts the file back.
      if (!(await optionalSkillMatches())) {
        await rm(optionalSkill, { force: true });
        await writeFile(optionalSkill, FACTORY_START_RUN_SKILL);
      }
      const targets = requireSuccess(await factory.getReportingInstallations());
      const target = targets.find((entry) => entry.instances.includes("codex-main"));
      assert(target);
      if (target.status !== "installed" || target.launchSkill !== "current")
        requireSuccess(await factory.installReporting({ targetId: target.id }));
    },
  };
}
