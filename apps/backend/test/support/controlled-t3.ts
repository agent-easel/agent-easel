import type { T3Modules } from "../../src/t3/modules.ts";
import { ControlledT3Connection } from "./controlled-t3-connection.ts";
import { ControlledT3Contract } from "./controlled-t3-contract.ts";
import { ControlledT3Projects } from "./controlled-t3-projects.ts";
import { ControlledT3Threads } from "./controlled-t3-threads.ts";

/** Independent external-engine lifetime; no SQL or Factory internals. */
export class ControlledT3 implements T3Modules {
  readonly connection = new ControlledT3Connection();
  readonly contract = new ControlledT3Contract(this.connection);
  readonly projects: ControlledT3Projects = this.makeProjects();
  readonly threads: ControlledT3Threads = this.makeThreads((projectId) =>
    this.projects.workspaceFor(projectId),
  );

  protected makeProjects() {
    return new ControlledT3Projects(this.connection, this.contract);
  }

  protected makeThreads(projectWorkspace: (projectId: string) => string | null) {
    return new ControlledT3Threads(this.connection, projectWorkspace);
  }

  async close() {}
}

/** The inspections a Start makes before it accepts: its T3 contract snapshot, which its Project
 * catalog refresh and every Agent's runtime readiness check reuse. */
export const START_INSPECTIONS = 1;
