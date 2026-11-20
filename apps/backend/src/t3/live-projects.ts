import { stat } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";
import type { T3Projects, T3Project, T3ProviderCapability } from "./projects.ts";
import {
  T3Failure,
  structured,
  type T3Calls,
  type T3Endpoint,
  type T3EnvironmentTarget,
  type T3ListedTool,
  type T3ProjectTarget,
  type T3Session,
} from "./connection.ts";
import { hasEnvironmentIdentity } from "./environment-identity.ts";
import type { AgentEnvironment } from "@t3-factory/contracts";
import { parseProjectFaviconPath, parseProjectIcon } from "@t3-factory/domain-validation";
import { isLocalEndpoint } from "../endpoint-local.ts";
import { parseProviderCapabilities } from "./project-capabilities.ts";

const PROJECT_TOOL_FIELDS = [
  ["t3_project_list", ["environmentId", "cursor", "limit"]],
  [
    "t3_project_create",
    ["environmentId", "title", "workspaceRoot", "createWorkspaceRootIfMissing"],
  ],
] as const;

const projectFieldType = (field: string) =>
  field === "cursor" || field === "limit"
    ? "integer"
    : field === "createWorkspaceRootIfMissing"
      ? "boolean"
      : "string";

function supportsProjectTool(
  tools: readonly T3ListedTool[],
  name: string,
  fields: readonly string[],
): boolean {
  const schema = tools.find((tool) => tool.name === name)?.inputSchema;
  const properties = schema?.properties as Record<string, { type?: string }> | undefined;
  if (schema?.type !== "object" || !properties) return false;
  return (
    fields.every((field) => properties[field]?.type === projectFieldType(field)) &&
    (schema.required ?? []).every((field) => fields.includes(field))
  );
}

export class LiveT3Projects implements T3Projects {
  private readonly connection: T3Calls;

  constructor(connection: T3Calls) {
    this.connection = connection;
  }
  async readEnvironment(target: T3Endpoint): Promise<AgentEnvironment> {
    return this.connection.authorized(target, async (session) => {
      const body = structured(await session.call("t3_environment_read", {}, 10_000));
      if (!hasEnvironmentIdentity(body))
        throw new Error("t3_environment_read did not return an environment identity.");
      const label =
        "label" in body && typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : body.environmentId;
      return { environmentId: body.environmentId, label };
    });
  }
  async orchestratorCapabilities(target: T3Endpoint): Promise<readonly T3ProviderCapability[]> {
    return this.connection.authorized(target, async (session) =>
      parseProviderCapabilities(
        structured(await session.call("orchestrator_capabilities", {}, 15_000)),
      ),
    );
  }
  /** Every Project call first checks that T3 still lists both Project tools as Factory uses them. */
  private withProjectContract<A>(
    target: T3Endpoint,
    action: (session: T3Session) => Promise<A>,
  ): Promise<A> {
    return this.connection.authorized(target, async (session) => {
      const tools = await session.tools();
      for (const [name, fields] of PROJECT_TOOL_FIELDS)
        if (!supportsProjectTool(tools, name, fields))
          throw new T3Failure("refused", "Unsupported project contract");
      return action(session);
    });
  }
  private async projectCall(
    session: T3Session,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const answer = await session.call(name, args, 10_000);
    if (answer.isError) throw new T3Failure("refused", "T3 project operation failed.");
    if (answer.content === undefined) throw new Error("Invalid project result.");
    return answer.content;
  }
  private async projectValue(endpoint: string, value: unknown): Promise<T3Project | null> {
    if (!value || typeof value !== "object") throw new Error("Invalid project");
    const project = value as Record<string, unknown>;
    if (
      typeof project.id !== "string" ||
      !project.id ||
      typeof project.title !== "string" ||
      typeof project.workspaceRoot !== "string" ||
      !isAbsolute(project.workspaceRoot)
    )
      throw new Error("Invalid project");
    if (project.deletedAt || project.archivedAt) return null;
    let available = false;
    // Only local T3 paths can be checked on this backend host. Remote execution is unverified.
    if (isLocalEndpoint(endpoint)) {
      available = await stat(project.workspaceRoot).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
    }
    return {
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      available,
      projectIcon: parseProjectIcon(project.projectIcon),
      faviconPath: parseProjectFaviconPath(project.faviconPath),
    };
  }
  async listProjects(target: T3EnvironmentTarget): Promise<readonly T3Project[]> {
    return this.withProjectContract(target, async (session) => {
      const projects: T3Project[] = [];
      const ids = new Set<string>();
      const add = (project: T3Project | null) => {
        if (!project) return;
        if (ids.has(project.projectId)) throw new Error("Project pages shifted; recheck.");
        ids.add(project.projectId);
        projects.push(project);
      };
      let cursor: number | undefined;
      const seen = new Set<number>();
      do {
        const page = await this.projectPage(session, target.environmentId, cursor);
        for (const raw of page.projects) add(await this.projectValue(target.endpoint, raw));
        cursor = page.nextCursor ?? undefined;
        if (cursor !== undefined && (seen.has(cursor) || seen.size >= 100))
          throw new Error("Invalid project pagination");
        if (cursor !== undefined) seen.add(cursor);
      } while (cursor !== undefined);
      return projects;
    });
  }
  private async projectPage(
    session: T3Session,
    environmentId: string,
    cursor: number | undefined,
  ): Promise<{ projects: unknown[]; nextCursor: number | null }> {
    const body = (await this.projectCall(session, "t3_project_list", {
      environmentId,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })) as { projects?: unknown; nextCursor?: unknown };
    if (
      !body ||
      !Array.isArray(body.projects) ||
      !(
        body.nextCursor === null ||
        (Number.isInteger(body.nextCursor) && (body.nextCursor as number) >= 0)
      )
    )
      throw new Error("Invalid project page");
    return { projects: body.projects, nextCursor: body.nextCursor as number | null };
  }
  async createProject(target: T3ProjectTarget): Promise<T3Project> {
    return this.withProjectContract(target, async (session) => {
      const value = await this.projectCall(session, "t3_project_create", {
        environmentId: target.environmentId,
        title: basename(target.workspaceRoot),
        workspaceRoot: target.workspaceRoot,
        createWorkspaceRootIfMissing: false,
      });
      const project = await this.projectValue(target.endpoint, value);
      if (!project) throw new Error("Project unavailable");
      return project;
    });
  }
}
