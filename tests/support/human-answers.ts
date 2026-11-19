import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { liveRun } from "./live.ts";
import { applyRunState } from "./scenarios.ts";

/**
 * Journey Run `key` of `flow`, whose Implement change result reached First review, where a person
 * approved it with a long Markdown answer by `decision`; open on its Run page.
 */
export async function approveFirstReviewAtLength(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  key: string,
  flow: "answerRelay" | "answerCondition",
  decision: string,
) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const runId = await liveRun(app, key, flow);
  await applyRunState(
    app,
    runId,
    "result reported",
    "The picker spacing is tidy; ready for review.",
  );
  await app.open(`/runs/${runId}`);
  const review = screen
    .getByRole("complementary", "Run inspector")
    .getByRole("form", "Answer First review", { exact: true });
  await review.getByRole("combobox", "Decision").selectOption({ label: decision });
  await review
    .getByRole("textbox", "Response", { exact: true })
    .fill(
      [
        "## First review notes",
        "",
        "The spacing change reads well in both themes.",
        "",
        "- Row height matches the sidebar.",
        "- Long project names truncate with an ellipsis.",
        "- Focus rings stay inside the popover.",
        "",
        "### For sign-off",
        "",
        "Check the picker once more on the narrow window before release.",
        "Nothing else blocks this change.",
      ].join("\n"),
    );
  await review.getByRole("button", "Submit answer", { exact: true }).tap();
  return runId;
}

/** The answer form of the Final sign-off step the relayed answer reached. */
export const finalSignoff = (screen: Screen) =>
  screen
    .getByRole("complementary", "Run inspector")
    .getByRole("form", "Answer Final sign-off", { exact: true });

/** The open Final sign-off context reader names First review, with no Agent or visit, as its author. */
export async function expectWrittenByFirstReview(screen: Screen) {
  const reader = screen.getByRole("dialog", "Final sign-off · context", { exact: true });
  await expect(reader).toContainText(/From First review · \d\d:\d\d/);
  await expect(reader.getByRole("heading", "First review notes", { exact: true })).toBeVisible();
  await expect(reader).not.toContainText("Implement change");
  await expect(reader).not.toContainText("Visit");
}
