import { useState } from "react";
import { Surface } from "@/components/ui/surface";
import type { AppearancePreference } from "@agent-easel/contracts/desktop-bridge";
import { chooseAppearance, useAppearancePreference } from "../appearance.ts";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsRow } from "./settings-page.tsx";

const labels = { system: "System", light: "Light", dark: "Dark" };
const appearanceOptions = [
  ["system", labels.system],
  ["light", labels.light],
  ["dark", labels.dark],
] as const;

/** Local to this installation or browser profile. */
export function AppearanceChoice() {
  const appearance = useAppearancePreference();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ preference: AppearancePreference; message: string }>();
  const choose = (next: AppearancePreference) => {
    setPending(true);
    setFailure(undefined);
    void chooseAppearance(next)
      .then((message) => {
        if (message) setFailure({ preference: next, message });
      })
      .catch((cause: unknown) => {
        setFailure({
          preference: next,
          message: cause instanceof Error ? cause.message : "Try again.",
        });
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
            appearance === failure.preference
              ? `Couldn’t save ${labels[failure.preference]}`
              : `Couldn’t switch to ${labels[failure.preference]}`
          }
          details={appearance !== failure.preference ? failure.message : undefined}
        >
          {appearance === failure.preference
            ? failure.message
            : `Factory stays in ${labels[appearance]}. Try again.`}
        </ProblemCard>
      )}
    </>
  );
}
