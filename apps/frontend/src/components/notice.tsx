import type { ComponentProps } from "react";
import { ProblemCard, ProblemCardButton } from "./problem-card.tsx";

// Only routes/flow-editor.tsx still uses these; it moves to ProblemCard (density "compact") and
// this file is removed once #519 lands.
export function Notice({
  tone,
  ...props
}: Omit<ComponentProps<typeof ProblemCard>, "tone" | "density"> & {
  tone: "critical" | "attention" | "info" | "neutral";
}) {
  return <ProblemCard {...props} tone={tone === "critical" ? "error" : tone} density="compact" />;
}

export const NoticeButton = ProblemCardButton;
