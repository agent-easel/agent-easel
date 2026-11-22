import { useId, useRef, useState, type ChangeEvent } from "react";
import { RotateCcw, Upload } from "lucide-react";
import type { CustomThemePresentation } from "@t3-factory/contracts";
import { MAX_THEME_JSON_BYTES } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyCustomThemeJson,
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
  readonly title: string;
  readonly body: string;
  readonly details?: string;
}

function unreadWarning(count: number): ThemeNotice {
  const label = count === 1 ? "1 color" : `${count} colors`;
  return {
    tone: "neutral",
    title: `${label} Factory cannot read ${count === 1 ? "was" : "were"} ignored`,
    body: "Supported color formats are hex (#rgb, #rrggbb), rgb(), rgba() and oklch().",
  };
}

function keepPreviousBody(hasPrevious: boolean) {
  return hasPrevious
    ? "Factory keeps your previous custom colors."
    : "Factory keeps its own colors.";
}

function noticeForApply(result: ApplyCustomThemeResult, hasPrevious: boolean): ThemeNotice | null {
  if (!result.ok) {
    return {
      tone: "error",
      title: result.message,
      body: keepPreviousBody(hasPrevious),
      ...(result.details ? { details: result.details } : {}),
    };
  }
  if (result.storageWarning) {
    return {
      tone: "neutral",
      title: "Custom colors applied for this tab only",
      body: result.storageWarning,
    };
  }
  return result.unreadColors > 0 ? unreadWarning(result.unreadColors) : null;
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
  const [notice, setNotice] = useState<ThemeNotice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadGeneration = useRef(0);
  const errorCardId = useId();

  const draft = edited && edited.base === rawJson ? edited.value : (rawJson ?? "");
  const setDraft = (value: string) => setEdited({ base: rawJson, value });

  const applyJson = (text: string) => {
    uploadGeneration.current += 1;
    const result = applyCustomThemeJson(text);
    if (result.ok) setEdited(null);
    setNotice(noticeForApply(result, presentation !== null));
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const generation = ++uploadGeneration.current;
    void readThemeFile(file, presentation !== null).then((outcome) => {
      if (generation !== uploadGeneration.current) return;
      if (!outcome.ok) {
        setNotice(outcome.notice);
        return;
      }
      setDraft(outcome.text);
      applyJson(outcome.text);
    });
  };

  const handleReset = () => {
    uploadGeneration.current += 1;
    resetCustomTheme();
    setEdited(null);
    setNotice(null);
  };

  const canApply = draft.trim().length > 0 && draft !== (rawJson ?? "");
  const invalidCardId = notice?.tone === "error" ? errorCardId : undefined;

  return (
    <>
      {presentation && <ActiveThemeGroup presentation={presentation} />}
      <SettingsGroup label="Theme config">
        <SettingsRow
          title="JSON config"
          description="Paste or upload a T3 v1 color theme JSON. Saved on this device only."
          control={
            <ThemeConfigActions
              canApply={canApply}
              hasTheme={presentation !== null}
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
                {...fieldAria(invalidCardId)}
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
      {notice && (
        <ProblemCard
          id={invalidCardId}
          tone={notice.tone}
          title={notice.title}
          details={notice.details}
        >
          {notice.body}
        </ProblemCard>
      )}
    </>
  );
}

function ActiveThemeGroup({ presentation }: { presentation: CustomThemePresentation }) {
  return (
    <SettingsGroup label="Color theme">
      <SettingsDetailRow label="Theme" value={presentation.name} />
      <SettingsDetailRow
        label="Light"
        value={presentation.modes.light.kind === "custom" ? "Custom colors" : "Factory colors"}
      />
      <SettingsDetailRow
        label="Dark"
        value={presentation.modes.dark.kind === "custom" ? "Custom colors" : "Factory colors"}
      />
    </SettingsGroup>
  );
}

function ThemeConfigActions({
  canApply,
  hasTheme,
  onApply,
  onUpload,
  onReset,
}: {
  canApply: boolean;
  hasTheme: boolean;
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
      <Button size="sm" variant="outline" onClick={onUpload}>
        <Upload className="size-3.5" />
        Upload JSON
      </Button>
      {hasTheme && (
        <Button size="sm" variant="outline" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          Reset to Factory
        </Button>
      )}
    </>
  );
}
