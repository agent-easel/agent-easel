import { Bot } from "lucide-react";
import type { TargetStatus } from "../reporting-state.tsx";
import { StatusBadge } from "./status-badge.tsx";

/**
 * Figma Setup/HarnessRow: one agent harness in First-run setup, with the configuration paths
 * Factory writes, the installation's own message and its install status. The group is named
 * after the harness, so its status is announced with it.
 */
export function HarnessRow({
  name,
  paths,
  message,
  status,
}: {
  name: string;
  paths: readonly string[];
  message?: string | undefined;
  status: TargetStatus;
}) {
  return (
    <div role="group" aria-label={name} className="flex items-center gap-3 px-3 py-2.5">
      <Bot aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-0.5 leading-normal">
        <span className="text-sm font-medium text-foreground">{name}</span>
        {paths.length > 0 && (
          <span className="font-mono text-label wrap-anywhere text-subtle-foreground">
            {paths.join(" · ")}
          </span>
        )}
        {message && <span className="text-2xs text-subtle-foreground">{message}</span>}
      </div>
      <StatusBadge role="status" kind={status.kind} {...status.badge}>
        {status.label}
      </StatusBadge>
    </div>
  );
}
