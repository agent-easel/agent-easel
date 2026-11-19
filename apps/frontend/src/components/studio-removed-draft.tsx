import { useState } from "react";
import { TextLink } from "@/components/ui/text-link";
import { ProblemCard } from "./problem-card.tsx";
import { Textarea } from "./ui/textarea";

/**
 * Figma SA06l: the definition was removed elsewhere and the draft is kept. Recovery stays
 * available without a server write or clipboard permission.
 */
export function StudioRemovedDraft({ kind, json }: { kind: "Agent" | "Flow"; json: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(json);
      setFallback(false);
    } catch {
      setCopied(null);
      setFallback(true);
    }
  }
  return (
    <ProblemCard
      tone="attention"
      title={`This ${kind} was removed elsewhere`}
      action={
        <div className="grid gap-2">
          <TextLink onClick={() => void copy()}>Copy as JSON</TextLink>
          {copied === json && <p role="status">Copied to clipboard.</p>}
          {fallback && (
            <div className="grid w-full gap-2">
              <p>Clipboard unavailable. Select and copy the JSON below.</p>
              <Textarea
                aria-label={`${kind} draft JSON`}
                readOnly
                value={json}
                rows={8}
                className="max-h-48 overflow-y-auto font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
        </div>
      }
    >
      Your draft is kept.
    </ProblemCard>
  );
}
