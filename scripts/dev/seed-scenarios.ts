import { demoImages, demoPullRequest, type DemoImage } from "./seed-support.ts";
import type { ThreadFacts } from "../../apps/backend/test/support/controlled-t3-threads.ts";

/** The demo Agents the seeded Flows place, by stable key. */
export type DemoAgents = Record<"worker" | "reviewer" | "accessibility" | "releaseNotes", string>;
/** The ready demo Flows seed scenarios start in, by stable key. */
export type DemoFlows = Record<
  | "simple"
  | "review"
  | "parallel"
  | "parallelStart"
  | "worktree"
  | "continuation"
  | "wait"
  | "parallelWait"
  | "humanWait"
  | "conditionRounds"
  | "firstApproval"
  | "endings"
  | "approvedEnding"
  | "subflowReview"
  | "joinReview",
  string
>;
type Repository = NonNullable<ThreadFacts["repository"]>;
type Report = { exit: string; message: string };
export type SeedScenario = {
  key: string;
  title: string;
  flow: keyof DemoFlows;
  prompt: string;
  attachments?: { images: readonly DemoImage[]; referenced: number };
} & (
  | { state: "settled"; repository: Repository; result: Report }
  | { state: "archived" | "execution failed" | "snoozed" | "woke" }
  | { state: "settlement unresolved" }
  | { state: "progress overdue" }
  /** Generate Run titles was on for this Start only; the title thread's title was applied. */
  | { state: "generated title applied"; generatedTitle: string }
  | { state: "Run worktree bound" }
  | {
      state: "working reported and idle";
      message: string;
      repository?: Repository;
      /** Turns the user's T3 replies ran afterwards, each observed running then completed. */
      replies?: number;
    }
  | { state: "missing report"; rejected: Report }
  | ({ implementation: Report; review: Report } & (
      | { state: "result released to a Human review" }
      /** The worker applied the requested changes and its result is back with the reviewer. */
      | { state: "corrections back in review"; correction: string; corrected: Report }
    ))
  | { state: "result released to two workers"; first: Report; final: Report }
  | { state: "two workers started from one prompt"; repositories: readonly Repository[] }
  | { state: "result released to a Wait"; result: Report }
  | { state: "Wait continued now"; result: Report }
  | { state: "results released to a Wait"; results: readonly [Report, Report] }
  | { state: "review approved into a Wait"; result: Report; approval: string }
  /** The second worker is at work and the Condition after it has no arrival yet. */
  | { state: "result released to a second worker"; implementation: Report }
  /** Each worker's result is a Condition arrival in `results` order; the first is with your
   * Human review. */
  | {
      state: "results released to a Condition";
      results: readonly [Report, Report];
      /** The result of the Agent the Condition hands later approvals to. */
      extraApproval: Report;
    }
  | { state: "ending reached"; result: Report }
  | { state: "ending reached without output"; report: Report }
  | {
      state: "Join round forwarded, next round partial";
      implementation: Report;
      firstRound: readonly [Report, Report];
      correction: string;
      corrected: Report;
      secondReview: Report;
      recheck: Report;
      stillReviewing: string;
    }
  | { state: "subflow closing" }
  | { state: "subflow returned" }
  | { state: "delegated work pending"; repository: Repository; delegations: number }
  | ({ grill: Report; approval: string } & (
      | { state: "continuation prompt sent" }
      | { state: "continuation response forwarded"; spec: string }
    ))
);

const reviewContent = {
  prompt:
    "Improve Atlas search when there are no results. Keep the search query visible and offer a clear action to reset filters.",
  implementation: {
    exit: "Ready for review",
    message:
      "The empty state now preserves the query and offers Reset filters. Ready for a review.",
  },
  review: {
    exit: "Ready for your decision",
    message:
      "The search behavior looks good. Please review the empty-state wording and decide whether the reset action is clear enough.",
  },
};

/** A review written as Markdown: long enough for the Human step to preview it with Read full context. */
const longReviewContext = [
  "## Review summary",
  "",
  "The search behavior looks good. Two wording choices need your decision before release.",
  "The [empty-state notes](https://example.com/atlas/empty-state) list the options.",
  "",
  "### Empty state",
  "",
  '- Title: `No results for "{query}"`',
  "- The query stays visible in the search field.",
  "- The body suggests clearing filters instead of retrying the same search.",
  "",
  "### Reset action",
  "",
  "The button is labelled **Reset filters**. It clears `status`, `owner` and `tag` but keeps the query:",
  "",
  "```",
  "GET /search?q=atlas&status=any&owner=me",
  "→ GET /search?q=atlas",
  "```",
  "",
  'The reviewed markup is <button class="reset">Reset filters</button>.',
  "",
  "### Decide",
  "",
  "Approve if the reset action is clear enough.",
  "Request changes if it should also clear the query.",
  "Compare it with the [reset filters layout](https://example.com/atlas/reset-filters).",
].join("\n");

const continuationContent = {
  prompt:
    "Plan saved searches for Atlas. Interview me about scope first, then write the spec and the tickets in the same conversation.",
  grill: {
    exit: "Ready for review",
    message: "We agreed on saved searches per project, shareable links and no email alerts yet.",
  },
  approval: "Approved. Leave email alerts out of the first version.",
};

/** A long Markdown result as Agents write them; its raw HTML must stay inert text. */
const settledResult = `## Welcome copy updated

The first-run screen now says where recent projects live, in two short sentences.

### Changes

- Rewrote the heading and body in \`WelcomePanel\`.
- Gave every action a descriptive label.

### Copy

| Element | Before | After |
| --- | --- | --- |
| Heading | Welcome! | Welcome to Atlas |
| Body | Get started below. | Your recent projects are in the sidebar. |

\`\`\`ts
const body = t("welcome.recentProjects");
\`\`\`

### Checks

- [x] Every action has an accessible name
- [ ] Translations follow in a separate change

See the [Atlas copy guide](https://example.com/atlas/copy-guide) for tone.

<b>Raw HTML stays text</b> <img src="missing.png" onerror="window.resultHtmlRan = true">`;

/** A long Markdown Working report from an Agent that asks in T3 before it changes anything. */
const emptyStateQuestion = `I drafted three options for the empty state and need your pick before changing anything.

### Options

1. **Neutral** — “No results. Try fewer filters.”
2. **Helpful** — “No results for “atlas”. Clear filters to see 12 matches.”
3. **Minimal** — the illustration and a \`Reset filters\` button only.

### Open questions

- Should the button say **Reset filters** or **Clear all**?
- Keep the filter chips visible when nothing matches?

Reply in T3 with the option number and any wording changes.`;

/** Stable keys, titles and creation order are shared with journeys and the scenario catalog.
 * Reading this list needs no Factory; callers supply the saved Flow ids when instantiating it. */
export const seedScenarioList: readonly SeedScenario[] = [
  {
    key: "settlement-unresolved",
    title: "Settlement unresolved · Stop support unavailable",
    flow: "simple",
    prompt: "Check the empty-state wording.",
    state: "settlement unresolved",
  },
  {
    key: "settled",
    title: "Settled · Clearer onboarding copy",
    flow: "simple",
    state: "settled",
    prompt:
      "Polish the first-run welcome copy for Atlas. Explain where to find recent projects in two short sentences.",
    attachments: { images: [demoImages.welcomeCopy], referenced: 1 },
    repository: { branch: "copy/welcome", pullRequests: [demoPullRequest(41, "merged")] },
    result: { exit: "Done", message: settledResult },
  },
  {
    key: "archived",
    title: "Archived · Earlier navigation experiment",
    flow: "simple",
    state: "archived",
    prompt:
      "Explore a compact navigation layout for Atlas. This experiment was dropped after a design direction changed.",
    // The header and mockup images are shared with the Active parallel-start Run, so only the
    // compact navigation image is eligible for deletion.
    attachments: {
      images: [demoImages.compactNavigation, demoImages.headerDesktop, demoImages.mockup],
      referenced: 1,
    },
  },
  {
    key: "failed",
    title: "Problem · Search checks failed",
    flow: "simple",
    state: "execution failed",
    prompt:
      "Check the search result filters. Investigate why the local checks fail before making further changes.",
  },
  {
    key: "snoozed",
    title: "Snoozed · Navigation research",
    flow: "simple",
    state: "snoozed",
    prompt:
      "Compare the existing navigation labels with the Atlas product glossary. Keep notes for the next design session.",
  },
  {
    key: "woke",
    title: "Woke · A question about keyboard shortcuts",
    flow: "simple",
    state: "woke",
    prompt:
      "Document the search keyboard shortcut. Ask before choosing between slash and command-K.",
  },
  {
    key: "conversation",
    title: "Discussing · Agent asked about empty-state wording",
    flow: "simple",
    state: "working reported and idle",
    prompt:
      "Talk through the empty-state wording for Atlas search with me before changing anything.",
    message: emptyStateQuestion,
    replies: 4,
  },
  {
    key: "rejected-report",
    title: "Problem · Report exit needs correction",
    flow: "simple",
    state: "missing report",
    prompt: "Review the existing navigation wording and report through the Flow's captured exit.",
    rejected: {
      exit: "Unknown exit",
      message: "The review is complete; the exit needs correction.",
    },
  },
  {
    key: "human-review",
    title: "Waiting for your review",
    flow: "review",
    state: "result released to a Human review",
    ...reviewContent,
  },
  {
    key: "human-context",
    title: "Decision · Long review summary for the reset action",
    flow: "review",
    state: "result released to a Human review",
    ...reviewContent,
    review: { exit: "Ready for your decision", message: longReviewContext },
  },
  {
    key: "correction",
    title: "Corrections back in review",
    flow: "review",
    state: "corrections back in review",
    ...reviewContent,
    correction:
      "Rename Reset filters to Clear filters and keep keyboard focus in the search field.",
    corrected: {
      exit: "Ready for review",
      message:
        "Renamed Reset filters to Clear filters; focus now stays in the search field after clearing. Ready for another review.",
    },
  },
  {
    key: "parallel",
    title: "Two reviewers working in parallel",
    flow: "parallel",
    state: "result released to two workers",
    prompt:
      "Review the new project picker for code quality and keyboard accessibility. Each reviewer should report independently.",
    first: { exit: "Ready for review", message: "The picker is ready for a code review." },
    final: {
      exit: "Ready for review",
      message:
        "The picker is ready. Please review both implementation quality and keyboard navigation.",
    },
  },
  {
    key: "parallel-start",
    title: "Parallel review from one prompt",
    flow: "parallelStart",
    state: "two workers started from one prompt",
    prompt:
      "Review the Atlas settings page for code quality and for keyboard accessibility. Each reviewer starts from this prompt and reports independently.",
    attachments: {
      images: [
        demoImages.headerDesktop,
        demoImages.headerMobile,
        demoImages.focusRing,
        demoImages.mockup,
      ],
      referenced: 3,
    },
    repositories: [
      { branch: "review/project-picker", pullRequests: [demoPullRequest(42)] },
      {
        branch: "review/keyboard-accessibility",
        pullRequests: [demoPullRequest(42), demoPullRequest(43)],
      },
    ],
  },
  {
    key: "wait-pending",
    title: "Waiting · Release notes settle before review",
    flow: "wait",
    state: "result released to a Wait",
    prompt:
      "Draft the release notes for the Atlas search update, then let CI settle before a review.",
    result: {
      exit: "Ready for review",
      message:
        "Release notes drafted from the merged search changes. Ready for review once CI settles.",
    },
  },
  {
    key: "approved-wait",
    title: "Waiting · Approved release held for the window",
    flow: "humanWait",
    state: "review approved into a Wait",
    prompt: "Prepare the Atlas 2.4 release branch; I approve it before the release window opens.",
    result: {
      exit: "Ready for review",
      message: "Release branch prepared with the changelog and version bump. Ready for approval.",
    },
    approval: "Approved. Announce it once the release window opens.",
  },
  {
    key: "wait-continued",
    title: "Working · Hotfix notes reviewed without waiting for CI",
    flow: "wait",
    state: "Wait continued now",
    prompt:
      "Draft the release notes for the Atlas search hotfix; CI already passed, so the review need not wait.",
    result: {
      exit: "Ready for review",
      message: "Hotfix notes drafted; CI is green on the merged fix. Ready for review now.",
    },
  },
  {
    key: "wait-arrivals",
    title: "Waiting · Two reviews held for the morning sync",
    flow: "parallelWait",
    state: "results released to a Wait",
    prompt:
      "Review the Atlas filters panel for code quality and keyboard accessibility; we decide together at the morning sync.",
    results: [
      { exit: "Approved", message: "The filters code is ready; one naming nit is noted inline." },
      {
        exit: "Approved",
        message: "Keyboard navigation works; focus returns to the filter button after closing.",
      },
    ],
  },
  {
    key: "condition-unvisited",
    title: "Condition · First review before the rounds gate",
    flow: "conditionRounds",
    state: "result released to a second worker",
    prompt:
      "Add sorting by last-opened date to the Atlas project picker. Send it back to me after the third set of review changes.",
    implementation: {
      exit: "Ready for review",
      message:
        "The picker sorts by last-opened date, with a toggle back to name. Ready for review.",
    },
  },
  {
    key: "condition-arrivals",
    title: "Condition · Second approval ended at the gate",
    flow: "firstApproval",
    state: "results released to a Condition",
    prompt:
      "Review the Atlas share dialog for code quality and keyboard accessibility. The first approval comes to me; later approvals only go into the release notes.",
    results: [
      {
        exit: "Approved",
        message: "The share dialog code is ready; copy-link errors are handled.",
      },
      {
        exit: "Approved",
        message: "Focus stays inside the share dialog and Escape returns it to the Share button.",
      },
    ],
    extraApproval: {
      exit: "Done",
      message: "Noted the accessibility approval in the share dialog release notes.",
    },
  },
  {
    key: "join-partial",
    title: "Join · Second review round waits for accessibility",
    flow: "joinReview",
    state: "Join round forwarded, next round partial",
    prompt:
      "Add a keyboard shortcut to open the Atlas command bar. Both reviewers must report before I decide.",
    implementation: {
      exit: "Ready for review",
      message: "Cmd+K now opens the command bar from every screen. Ready for review.",
    },
    firstRound: [
      { exit: "Approved", message: "The shortcut handler is scoped correctly and has tests." },
      {
        exit: "Changes requested",
        message:
          "Focus does not return to the trigger after Escape.\n\n- Restore focus on close\n- Announce the open state",
      },
    ],
    correction: "Restore focus on Escape, then send it back to both reviewers.",
    corrected: {
      exit: "Ready for review",
      message: "Escape now restores focus to the element that opened the command bar.",
    },
    secondReview: {
      exit: "Changes requested",
      message: "The new focus code leaks a listener when the bar closes twice; remove it on close.",
    },
    recheck: {
      exit: "Approved",
      message: "The listener is removed on close now; approved on recheck.",
    },
    stillReviewing: "Checking focus order with VoiceOver on the corrected command bar.",
  },
  {
    key: "ending-reached",
    title: "Ended · Shipped while an alternative was stopped",
    flow: "endings",
    state: "ending reached",
    prompt:
      "Ship the Atlas search ranking fix. One worker ships it while another explores an alternative; whichever finishes first ends the Run.",
    result: {
      exit: "Done",
      message: "https://github.com/example/atlas/pull/44",
    },
  },
  {
    key: "ending-output-missing",
    title: "Ended · Approved without the required release notes link",
    flow: "approvedEnding",
    state: "ending reached without output",
    prompt: "Prepare the Atlas search release. I approve it once the change is ready for review.",
    report: {
      exit: "Ready for review",
      message: "The ranking fix is ready for your approval.",
    },
  },
  {
    key: "worktree",
    title: "Worktree · Search fix on its own branch",
    flow: "worktree",
    state: "Run worktree bound",
    prompt:
      "Fix the search highlighting in a separate worktree so the project checkout stays untouched, then hand off for review.",
  },
  {
    key: "working-report",
    title: "Monitoring · Agent is watching CI for the search fix",
    flow: "simple",
    state: "working reported and idle",
    prompt:
      "Fix the search ranking regression, open a pull request and wait for its CI checks before reporting.",
    message:
      "Opened pull request #42 with the ranking fix. CI checks are still running; I will report when they finish.",
    repository: { branch: null, pullRequests: [demoPullRequest(42)] },
  },
  {
    key: "continuation-sent",
    title: "Continuation · Spec prompt sent to the planning thread",
    flow: "continuation",
    state: "continuation prompt sent",
    ...continuationContent,
  },
  {
    key: "continuation-forwarded",
    title: "Continuation · Spec passed on to Tickets",
    flow: "continuation",
    state: "continuation response forwarded",
    ...continuationContent,
    spec: "Spec written to docs/saved-searches.md with four open questions.",
  },
  {
    key: "working",
    title: "Working · Improve the project picker",
    flow: "simple",
    state: "delegated work pending",
    prompt:
      "Add a concise empty state to the Atlas project picker, including a hint to open an existing repository.",
    repository: {
      branch: "feature/project-picker-empty-state-and-keyboard-navigation",
      pullRequests: [],
    },
    delegations: 2,
  },
  {
    key: "overdue",
    title: "Needs input · Search indexing has gone quiet",
    flow: "simple",
    state: "progress overdue",
    prompt: "Check the search indexing job and report progress.",
  },
  {
    key: "generated-title",
    title:
      "Generated title · Rank exact project-name matches above partial matches when someone searches Atlas",
    flow: "simple",
    state: "generated title applied",
    prompt:
      "Rank exact project-name matches above partial matches in Atlas search, and keep the current order for everything else.",
    generatedTitle: "Generated title · Exact matches first in search",
  },
  {
    key: "subflow-closing",
    title: "Subflow · Waiting for the second reviewer to stop",
    flow: "subflowReview",
    prompt: "Review the Atlas search design.",
    state: "subflow closing",
  },
  {
    key: "subflow-returned",
    title: "Subflow · Review returned to release notes",
    flow: "subflowReview",
    prompt: "Prepare Atlas search for release.",
    state: "subflow returned",
  },
];
