import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/**
 * Available T3 Projects a journey adds with a title of its choosing, and can drop from Factory's
 * catalog. Reset removes their Flows, drops them from T3 and restores the Project selection they
 * replaced.
 */
export function projectsFixture({ factory, t3, home }: Host) {
  const added: { id: string; projectId: string }[] = [];
  const withdrawn: (typeof t3.projects.catalog)[number][] = [];
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
        t3.projects.catalog = t3.projects.catalog.map((entry) =>
          entry.projectId === project.projectId ? { ...entry, title } : entry,
        );
        requireSuccess(await factory.recheckProjects());
        return { id: project.id };
      },
      /**
       * Drops the added Project `id`, which nothing owns, from T3 and from Factory's catalog, which
       * Factory itself never does, so a journey can show a reference the catalog no longer holds.
       */
      async forget({ id }: { id: string }) {
        const project = added.find((entry) => entry.id === id);
        if (!project) throw new Error(`Project ${id} was not added by this journey.`);
        t3.projects.catalog = t3.projects.catalog.filter(
          (entry) => entry.projectId !== project.projectId,
        );
        {
          using database = new DatabaseSync(join(home, "factory.sqlite"));
          database.prepare("DELETE FROM projects WHERE id = ?").run(id);
        }
        // Selecting the current Project again publishes the catalog to live clients.
        const { selectedProjectId } = requireSuccess(await factory.listProjects());
        requireSuccess(await factory.selectProject({ id: selectedProjectId }));
      },
      async withdraw({ id }: { id: string }) {
        const { projects } = requireSuccess(await factory.listProjects());
        const project = projects.find((entry) => entry.id === id);
        if (!project) throw new Error(`Project ${id} is not in Factory's catalog.`);
        withdrawn.push(
          ...t3.projects.catalog.filter((entry) => entry.projectId === project.projectId),
        );
        t3.projects.catalog = t3.projects.catalog.filter(
          (entry) => entry.projectId !== project.projectId,
        );
        requireSuccess(await factory.recheckProjects());
      },
    },
    async reset() {
      if (withdrawn.length > 0) {
        t3.projects.catalog = [...t3.projects.catalog, ...withdrawn.splice(0)];
        requireSuccess(await factory.recheckProjects());
      }
      if (added.length === 0) return;
      const ids = new Set(added.map((project) => project.id));
      for (const flow of requireSuccess(await factory.listFlows()))
        if (flow.projectId && ids.has(flow.projectId))
          requireSuccess(await factory.removeFlow(flow.id));
      const projectIds = new Set(added.map((project) => project.projectId));
      t3.projects.catalog = t3.projects.catalog.filter((entry) => !projectIds.has(entry.projectId));
      requireSuccess(await factory.recheckProjects());
      requireSuccess(await factory.selectProject({ id: selection }));
      added.length = 0;
    },
  };
}
