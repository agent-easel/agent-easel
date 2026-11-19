import type { FlowWorkspace } from "@t3-factory/contracts";
import { ChevronDown, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The workspace in one line; a custom ref appears exactly. */
function workspaceSummary(workspace: FlowWorkspace) {
  if (workspace.mode === "checkout") return "Project checkout";
  if (workspace.base.kind === "default") return "New worktree · default branch";
  return `New worktree · ${workspace.base.ref.trim() || "custom ref"}`;
}

/**
 * The Flow's workspace setting, edited as part of the unsaved Flow draft: Project checkout, or
 * New worktree with its Base submenu (Default branch, or Custom ref with its ref field).
 */
export function FlowWorkspaceControl({
  workspace,
  disabled,
  onChange,
}: {
  workspace: FlowWorkspace;
  disabled: boolean;
  onChange: (workspace: FlowWorkspace) => void;
}) {
  const summary = workspaceSummary(workspace);
  const worktree = workspace.mode === "worktree";
  const base = worktree ? workspace.base : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`Workspace: ${summary}`}
          className="h-8 max-w-80 justify-start gap-1.5 bg-card pr-2 pl-3 font-normal has-[>svg]:pr-2 has-[>svg]:pl-3 data-[state=open]:border-ring"
        >
          <GitBranch aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="text-subtle-foreground">Workspace:</span>
          <span className="min-w-0 truncate font-medium">{summary}</span>
          <ChevronDown aria-hidden className="ml-auto size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup
          value={workspace.mode}
          onValueChange={(mode) => {
            if (mode === "checkout") onChange({ mode: "checkout" });
          }}
        >
          <DropdownMenuRadioItem value="checkout" indicatorPosition="right">
            Project checkout
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={cn(worktree && "font-medium")}>
            New worktree
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuRadioGroup
              aria-label="Base"
              value={base?.kind ?? ""}
              onValueChange={(kind) =>
                onChange({
                  mode: "worktree",
                  base: kind === "ref" ? { kind: "ref", ref: "" } : { kind: "default" },
                })
              }
            >
              <DropdownMenuRadioItem value="default" indicatorPosition="right">
                Default branch
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="ref"
                indicatorPosition="right"
                // Keeps the submenu open so the ref can be typed.
                onSelect={(event) => event.preventDefault()}
              >
                Custom ref
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {base?.kind === "ref" && (
              <div className="px-2 pt-1 pb-1.5">
                <Input
                  aria-label="Custom ref"
                  placeholder="develop"
                  autoFocus
                  value={base.ref}
                  // Typing stays in the field rather than moving through the menu.
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    onChange({ mode: "worktree", base: { kind: "ref", ref: event.target.value } })
                  }
                />
              </div>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
