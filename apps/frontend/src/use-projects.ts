import { useEffect, useState } from "react";
import type { FactoryProject } from "@t3-factory/contracts";
import { api } from "./api.ts";

/** The project catalog, read again when `key` changes; undefined until a read succeeds. */
export function useProjects(key?: string) {
  const [catalog, setCatalog] = useState<{
    key: string | undefined;
    projects: readonly FactoryProject[] | undefined;
  }>({ key, projects: undefined });
  if (catalog.key !== key) setCatalog({ key, projects: undefined });
  useEffect(() => {
    let active = true;
    void api.listProjects().then(
      (catalog) => {
        if (active) setCatalog({ key, projects: catalog.projects });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [key]);
  return catalog.key === key ? catalog.projects : undefined;
}
