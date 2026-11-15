import type { ProjectCatalog, Result } from "@t3-factory/contracts";
import type { Checked } from "./runner-types.ts";
export const verified = <A>(value: A): Checked<A> => ({ ok: true, value });
export const unverified = (problem: string): Checked<never> => ({ ok: false, problem });
export const catalogProject = (catalog: Result<ProjectCatalog>, projectId: string) =>
  catalog.ok ? catalog.value.projects.find((project) => project.id === projectId) : undefined;
