import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { NoticeButton } from "./notice.tsx";
import { Textarea } from "./ui/textarea";

/** Recovery stays available without a server write or clipboard permission. */
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
    <Alert variant="attention" className="gap-y-1 px-5 py-3.5" role="status">
      <CircleAlert aria-hidden strokeWidth={1.5} />
      <AlertTitle>This {kind} was removed elsewhere. Your draft is kept.</AlertTitle>
      <AlertDescription>
        <p>
          You can keep editing and recover this draft with Copy as JSON.{" "}
          {kind === "Agent"
            ? "Save, Duplicate and Delete are unavailable because this Agent no longer exists."
            : "Save and Remove are unavailable because this Flow no longer exists."}
        </p>
        <NoticeButton onClick={() => void copy()}>Copy as JSON</NoticeButton>
        {copied === json && <p>Copied to clipboard.</p>}
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
      </AlertDescription>
    </Alert>
  );
}
