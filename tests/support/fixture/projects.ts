import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/**
 * Available T3 Projects a journey adds with a title of its choosing. Reset removes their Flows,
 * drops them from T3 and restores the Project selection they replaced.
 */
export function projectsFixture({ factory, t3, home }: Host) {
  const added: { id: string; projectId: string }[] = [];
  let selection: string | null = null;

  return {
    actions: {
      /** Adds an available Project titled `title` and returns its Factory id. */
      async add({ title }: { title: string }) {
        if (added.length === 0)
          selection = requireSuccess(await factory.listProjects()).selectedProjectId;
        const root = join(home, "journey-projects", crypto.randomUUID());
        await mkdir(root, { recursive: true });
        await promisify(execFile)("git", ["init", root], {
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
        });
        const project = requireSuccess(await factory.addRepository({ path: root }));
        added.push(project);
        t3.projects = t3.projects.map((entry) =>
          entry.projectId === project.projectId ? { ...entry, title } : entry,
        );
        requireSuccess(await factory.recheckProjects());
        return { id: project.id };
      },
    },
    async reset() {
      if (added.length === 0) return;
      const ids = new Set(added.map((project) => project.id));
      for (const flow of requireSuccess(await factory.listFlows()))
        if (flow.projectId && ids.has(flow.projectId))
          requireSuccess(await factory.removeFlow(flow.id));
      const projectIds = new Set(added.map((project) => project.projectId));
      t3.projects = t3.projects.filter((entry) => !projectIds.has(entry.projectId));
      requireSuccess(await factory.recheckProjects());
      requireSuccess(await factory.selectProject({ id: selection }));
      added.length = 0;
    },
  };
}
