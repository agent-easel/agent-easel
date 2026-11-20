import { useState } from "react";
import { Surface } from "@/components/ui/surface";
import type { Appearance } from "@t3-factory/contracts/desktop-bridge";
import { chooseAppearance, useAppearance } from "../appearance.ts";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsRow } from "./settings-page.tsx";

const appearanceOptions = [
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

/** Local to this installation or browser profile. */
export function AppearanceChoice() {
  const appearance = useAppearance();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ mode: Appearance; message: string }>();
  const choose = (next: Appearance) => {
    setPending(true);
    setFailure(undefined);
    void chooseAppearance(next)
      .then((message) => {
        if (message) setFailure({ mode: next, message });
      })
      .catch((cause: unknown) => {
        setFailure({ mode: next, message: cause instanceof Error ? cause.message : "Try again." });
      })
      .finally(() => setPending(false));
  };
  return (
    <>
      <Surface tone="group">
        <SettingsRow
          title="Mode"
          control={(text) => (
            <SegmentedChoice
              labelledBy={text.title}
              value={appearance}
              options={appearanceOptions}
              disabled={pending}
              onChange={choose}
            />
          )}
        />
      </Surface>
      {failure && (
        <ProblemCard
          tone="error"
          title={
            appearance === failure.mode
              ? "Couldn’t save the mode"
              : `Couldn’t switch to ${failure.mode === "light" ? "Light" : "Dark"}`
          }
          details={appearance !== failure.mode ? failure.message : undefined}
        >
          {appearance === failure.mode
            ? failure.message
            : `Factory stays in ${appearance === "light" ? "Light" : "Dark"}. Try again.`}
        </ProblemCard>
      )}
    </>
  );
}
