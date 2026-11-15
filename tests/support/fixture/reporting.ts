import assert from "node:assert/strict";
import { realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FACTORY_START_RUN_SKILL } from "../../../apps/backend/src/factory-start-run-skill.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/** Factory reporting in the controlled Codex home, and the runtime contract T3 advertises. */
export async function reportingFixture({ factory, t3, home }: Host) {
  const targets = requireSuccess(await factory.getReportingInstallations());
  requireSuccess(await factory.installReporting({ targetId: targets[0]!.id }));
  const codex = join(home, "reporting-codex");
  return {
    actions: {
      incompleteRuntime() {
        t3.runtimeContractComplete = false;
      },
      async restoreReadiness() {
        t3.runtimeContractComplete = true;
        const targets = requireSuccess(await factory.getReportingInstallations());
        const target = targets.find((entry) => entry.instances.includes("codex-main"));
        assert(target);
        requireSuccess(await factory.installReporting({ targetId: target.id }));
      },
      async removeRegistration() {
        await rm(join(codex, "config.toml"));
      },
      async breakRequiredSkill() {
        await rm(join(codex, "skills", "factory-block", "SKILL.md"));
      },
      /** Replaces the optional Start a Run skill with its expected content, or a `linked` copy. */
      async replaceOptionalSkill({ linked }: { linked: boolean }) {
        const path = join(
          await realpath(home),
          "reporting-codex",
          "skills",
          "factory-start-run",
          "SKILL.md",
        );
        await rm(path);
        if (linked) await symlink(join(codex, "config.toml"), path);
        else await writeFile(path, FACTORY_START_RUN_SKILL);
        return { path };
      },
    },
    reset() {},
  };
}
