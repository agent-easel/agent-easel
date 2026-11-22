import { useRef, useState, type ChangeEvent } from "react";
import { RotateCcw, Upload } from "lucide-react";
import type { CustomThemePresentation } from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { applyCustomThemeJson, resetCustomTheme, useCustomTheme } from "../custom-theme.ts";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsDetailRow, SettingsGroup } from "./settings-page.tsx";

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

export function ThemeColorSettings() {
  const { presentation, rawJson } = useCustomTheme();
  const [edited, setEdited] = useState<{
    readonly base: string | null;
    readonly value: string;
  } | null>(null);
  const [notice, setNotice] = useState<ThemeNotice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const draft = edited && edited.base === rawJson ? edited.value : (rawJson ?? "");
  const setDraft = (value: string) => setEdited({ base: rawJson, value });

  const applyJson = (text: string) => {
    const result = applyCustomThemeJson(text);
    if (!result.ok) {
      setNotice({
        tone: "error",
        title: result.message,
        body: presentation
          ? "Factory keeps your previous custom colors."
          : "Factory keeps its own colors.",
        ...(result.details ? { details: result.details } : {}),
      });
      return;
    }
    setEdited(null);
    if (result.storageWarning) {
      setNotice({
        tone: "neutral",
        title: "Custom colors applied for this tab only",
        body: result.storageWarning,
      });
      return;
    }
    if (result.unreadColors > 0) {
      setNotice(unreadWarning(result.unreadColors));
      return;
    }
    setNotice(null);
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void file
      .text()
      .then((text) => {
        setDraft(text);
        applyJson(text);
      })
      .catch(() => {
        setNotice({
          tone: "error",
          title: "Couldn’t read the selected file",
          body: "Choose a readable JSON file or paste the config below.",
        });
      });
  };

  const handleReset = () => {
    resetCustomTheme();
    setEdited(null);
    setNotice(null);
  };

  const canApply = draft.trim().length > 0 && draft !== (rawJson ?? "");

  return (
    <>
      {presentation && (
        <SettingsGroup label="Color theme">
          <SettingsDetailRow label="Theme" value={presentation.name} />
          <ThemeModes modes={presentation.modes} />
        </SettingsGroup>
      )}
      <SettingsGroup label="Theme config">
        <div className="grid gap-3 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">
            Paste or upload a color theme JSON (T3 theme format: appearance, canvas, accent, colors,
            variants). Saved on this device only.
          </p>
          <Textarea
            aria-label="Theme config JSON"
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={canApply ? "default" : "outline"}
              disabled={!canApply}
              onClick={() => applyJson(draft)}
            >
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload className="size-3.5" />
              Upload JSON
            </Button>
            {presentation && (
              <Button size="sm" variant="outline" onClick={handleReset}>
                <RotateCcw className="size-3.5" />
                Reset to Factory
              </Button>
            )}
          </div>
        </div>
      </SettingsGroup>
      {notice && (
        <ProblemCard tone={notice.tone} title={notice.title} details={notice.details}>
          {notice.body}
        </ProblemCard>
      )}
    </>
  );
}

function ThemeModes({ modes }: { modes: CustomThemePresentation["modes"] }) {
  return (
    <>
      <SettingsDetailRow
        label="Light"
        value={modes.light.kind === "custom" ? "Custom colors" : "Factory colors"}
      />
      <SettingsDetailRow
        label="Dark"
        value={modes.dark.kind === "custom" ? "Custom colors" : "Factory colors"}
      />
    </>
  );
}
