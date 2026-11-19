import { Plus, X } from "lucide-react";
import type { BlockExit } from "@t3-factory/contracts";
import { fieldLabelClass } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { randomId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import type { ExitProblem } from "../../agent-draft.ts";
import { StatusBadge } from "../status-badge.tsx";
import { removeIconButtonClass } from "./agent-project-overrides.tsx";

const columnHeadClass = "pb-1 text-left text-2xs font-normal text-subtle-foreground";

/**
 * Figma SA06/SA06j: the Agent's exits, which every Flow Block of this Agent offers. IDs stay
 * stable across renames, so wires in every Flow stay connected. A duplicate or empty name shows
 * only its border and tag; the card `problemCardId` names explains it.
 */
export function AgentExitsField({
  exits,
  disabled,
  problems,
  problemCardId,
  onChange,
}: {
  exits: readonly BlockExit[];
  disabled: boolean;
  problems: ReadonlyMap<string, ExitProblem> | undefined;
  problemCardId: string;
  onChange: (exits: BlockExit[]) => void;
}) {
  const update = (id: string, patch: Partial<BlockExit>) =>
    onChange(exits.map((exit) => (exit.id === id ? { ...exit, ...patch } : exit)));
  return (
    <fieldset className="grid min-w-0 gap-1" disabled={disabled}>
      <legend className={`${fieldLabelClass} mb-1`}>Exits</legend>
      <div className="min-w-0 overflow-x-auto">
        <table
          aria-label="Agent exits"
          className="w-full min-w-140 table-fixed border-separate border-spacing-0 text-sm"
        >
          <thead>
            <tr>
              <th scope="col" className={cn(columnHeadClass, "w-[34%] pr-2")}>
                Name
              </th>
              <th scope="col" className={cn(columnHeadClass, "pr-2")}>
                Description (optional)
              </th>
              <th scope="col" className={cn(columnHeadClass, "w-28 text-center")}>
                Message required
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exits.map((exit, index) => {
              const problem = problems?.get(exit.id);
              const label = exit.name.trim() || `exit ${index + 1}`;
              return (
                <tr key={exit.id}>
                  <td className="py-1 pr-2">
                    <div className="relative">
                      <Input
                        aria-label={`Exit ${index + 1} name`}
                        maxLength={200}
                        value={exit.name}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? problemCardId : undefined}
                        onChange={(event) => update(exit.id, { name: event.target.value })}
                        className={cn("h-8 bg-muted text-sm", problem && "pr-24")}
                      />
                      {problem && (
                        <StatusBadge
                          kind="error"
                          className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2"
                        >
                          {problem}
                        </StatusBadge>
                      )}
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Exit ${index + 1} description`}
                      maxLength={4000}
                      value={exit.description}
                      onChange={(event) => update(exit.id, { description: event.target.value })}
                      className="h-8 bg-muted text-sm"
                    />
                  </td>
                  <td className="py-1 text-center">
                    <Switch
                      aria-label={`Exit ${index + 1} message required`}
                      disabled={disabled}
                      checked={exit.messageRequired}
                      onCheckedChange={(checked) => update(exit.id, { messageRequired: checked })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove exit ${label}`}
                      className={removeIconButtonClass}
                      onClick={() => onChange(exits.filter((item) => item.id !== exit.id))}
                    >
                      <X aria-hidden strokeWidth={1.5} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          className="h-8"
          onClick={() =>
            onChange([
              ...exits,
              { id: randomId(), name: "", description: "", messageRequired: false },
            ])
          }
        >
          <Plus aria-hidden /> Add exit
        </Button>
      </div>
    </fieldset>
  );
}
