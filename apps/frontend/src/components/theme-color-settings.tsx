import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { RotateCcw, Upload } from "lucide-react";
import type { CustomThemePresentation } from "@agent-easel/contracts";
import { MAX_THEME_JSON_BYTES } from "@agent-easel/domain-validation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyCustomThemeJson,
  beginThemeUpload,
  cancelThemeUploads,
  isCurrentThemeUpload,
  resetCustomTheme,
  useCustomTheme,
  type ApplyCustomThemeResult,
} from "../custom-theme.ts";
import { fieldAria } from "./field-state.ts";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsDetailRow, SettingsGroup, SettingsRow } from "./settings-page.tsx";

const EXAMPLE_THEME_JSON = JSON.stringify(
  {
    name: "Iris",
    appearance: "dark",
    canvas: "#14101d",
    accent: "#9d6cff",
  },
  null,
  2,
);

interface ThemeNotice {
  readonly tone: "error" | "neutral";
  readonly target?: "textarea" | "upload";
  readonly title: string;
  readonly body: string;
  readonly details?: string;
}

function unreadWarning(count: number): ThemeNotice {
  const label = count === 1 ? "1 color" : `${count} colors`;
  return {
    tone: "neutral",
    title: `${label} AgentEasel cannot read ${count === 1 ? "was" : "were"} ignored`,
    body: "Supported color formats are hex (#rgb, #rrggbb), rgb(), rgba() and oklch().",
  };
}

function keepPreviousBody(hasPrevious: boolean) {
  return hasPrevious
    ? "AgentEasel keeps your previous custom colors."
    : "AgentEasel keeps its own colors.";
}

export function noticesForApply(
  result: ApplyCustomThemeResult,
  hasPrevious: boolean,
): readonly ThemeNotice[] {
  if (!result.ok) {
    return [
      {
        tone: "error",
        target: "textarea",
        title: result.message,
        body: keepPreviousBody(hasPrevious),
        ...(result.details ? { details: result.details } : {}),
      },
    ];
  }
  const notices: ThemeNotice[] = [];
  if (result.storageWarning) {
    notices.push({
      tone: "neutral",
      title: "Custom colors applied for this tab only",
      body: result.storageWarning,
    });
  }
  if (result.unreadColors > 0) notices.push(unreadWarning(result.unreadColors));
  return notices;
}

async function readThemeFile(
  file: File,
  hasPrevious: boolean,
): Promise<
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly notice: ThemeNotice }
> {
  if (file.size > MAX_THEME_JSON_BYTES) {
    return {
      ok: false,
      notice: {
        tone: "error",
        target: "upload",
        title: "Theme config is larger than the 128 KB limit.",
        body: keepPreviousBody(hasPrevious),
      },
    };
  }
  try {
    return { ok: true, text: await file.text() };
  } catch {
    return {
      ok: false,
      notice: {
        tone: "error",
        target: "upload",
        title: "Couldn’t read the selected file",
        body: "Choose a readable JSON file or paste the config below.",
      },
    };
  }
}

export function ThemeColorSettings() {
  const { presentation, rawJson } = useCustomTheme();
  const [edited, setEdited] = useState<{
    readonly base: string | null;
    readonly value: string;
  } | null>(null);
  const [notices, setNotices] = useState<readonly ThemeNotice[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorCardId = useId();

  useEffect(() => () => cancelThemeUploads(), []);

  const draft = edited && edited.base === rawJson ? edited.value : (rawJson ?? "");
  const setDraft = (value: string) => setEdited({ base: rawJson, value });

  const applyJson = (text: string) => {
    const result = applyCustomThemeJson(text);
    if (result.ok) setEdited(null);
    setNotices(noticesForApply(result, presentation !== null));
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const token = beginThemeUpload();
    void readThemeFile(file, presentation !== null).then((outcome) => {
      if (!isCurrentThemeUpload(token)) return;
      if (!outcome.ok) {
        setNotices([outcome.notice]);
        return;
      }
      setDraft(outcome.text);
      applyJson(outcome.text);
    });
  };

  const handleReset = () => {
    resetCustomTheme();
    setEdited(null);
    setNotices([]);
  };

  const canApply = draft.trim().length > 0 && draft !== (rawJson ?? "");
  const invalidId = (target: "textarea" | "upload") =>
    notices.some((item) => item.target === target) ? errorCardId : undefined;

  return (
    <>
      {presentation && <ActiveThemeGroup presentation={presentation} />}
      <SettingsGroup label="Theme config">
        <SettingsRow
          title="JSON config"
          description="Paste or upload a T3 Code v1 color theme JSON. Saved on this device only."
          control={
            <ThemeConfigActions
              canApply={canApply}
              hasTheme={presentation !== null}
              uploadInvalidId={invalidId("upload")}
              onApply={() => applyJson(draft)}
              onUpload={() => fileInput.current?.click()}
              onReset={handleReset}
            />
          }
        />
        <SettingsRow
          description={
            <>
              <Textarea
                aria-label="Theme config JSON"
                {...fieldAria(invalidId("textarea"))}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={EXAMPLE_THEME_JSON}
                rows={8}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                onChange={handleUpload}
                className="hidden"
              />
            </>
          }
        />
      </SettingsGroup>
      <ThemeNoticeCards notices={notices} errorCardId={errorCardId} />
    </>
  );
}

function ThemeNoticeCards({
  notices,
  errorCardId,
}: {
  notices: readonly ThemeNotice[];
  errorCardId: string;
}) {
  return (
    <>
      {notices.map((notice) => (
        <ProblemCard
          key={notice.title}
          {...(notice.target ? { id: errorCardId } : {})}
          tone={notice.tone}
          title={notice.title}
          details={notice.details}
        >
          {notice.body}
        </ProblemCard>
      ))}
    </>
  );
}

function ActiveThemeGroup({ presentation }: { presentation: CustomThemePresentation }) {
  return (
    <SettingsGroup label="Color theme">
      <SettingsDetailRow label="Theme" value={presentation.name} />
      <SettingsDetailRow
        label="Light"
        value={presentation.modes.light.kind === "custom" ? "Custom colors" : "AgentEasel colors"}
      />
      <SettingsDetailRow
        label="Dark"
        value={presentation.modes.dark.kind === "custom" ? "Custom colors" : "AgentEasel colors"}
      />
    </SettingsGroup>
  );
}

function ThemeConfigActions({
  canApply,
  hasTheme,
  uploadInvalidId,
  onApply,
  onUpload,
  onReset,
}: {
  canApply: boolean;
  hasTheme: boolean;
  uploadInvalidId: string | undefined;
  onApply: () => void;
  onUpload: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <Button
        size="sm"
        variant={canApply ? "default" : "outline"}
        disabled={!canApply}
        onClick={onApply}
      >
        Apply
      </Button>
      <Button size="sm" variant="outline" {...fieldAria(uploadInvalidId)} onClick={onUpload}>
        <Upload className="size-3.5" />
        Upload JSON
      </Button>
      {hasTheme && (
        <Button size="sm" variant="outline" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          Reset to AgentEasel
        </Button>
      )}
    </>
  );
}
