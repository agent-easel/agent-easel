import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { newId } from "../ids.ts";
import { now } from "../time.ts";
import type { ReportConsumer, ReportOrigin, RunReport } from "./run-reports.ts";
import { runReference } from "./run-tools.ts";

/** Discord's message length; a card or notice always fits one message. */
export const MESSAGE_LIMIT = 2000;
/** Entries each card list shows before summarizing the rest, shrunk until the card fits. */
const LIST_LIMITS = [8, 4, 2, 1, 0] as const;
const NAME_LIMIT = 100;
const TITLE_LIMIT = 200;

/** The first line of a card that replaced another application's cards in its thread. */
const APPLICATION_NOTICE =
  "Factory's Discord application changed. Messages the previous bot posted in this thread are no longer updated; this card replaces its status card.";

export const clip = (text: string, limit: number) => {
  const characters = Array.from(text);
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join("")}…`;
};
/**
 * Names come from users, so a zero-width space follows every `@`: no name can read as a user,
 * role or mass mention, independently of the allowed mentions every Factory message sends.
 */
export const inert = (text: string) => text.replaceAll("@", "@\u200b");
export const name = (text: string | null | undefined) =>
  inert(clip(text ?? "Unnamed Block", NAME_LIMIT));
const runTitle = (text: string) => inert(clip(text, TITLE_LIMIT));
/** A card's or notice's bold Run line start: reference and title. */
export const runHeading = (reference: string, title: string) =>
  `**Run ${reference} · ${runTitle(title)}**`;
/**
 * A relative Discord timestamp ("in 5 minutes", "2 hours ago"): every reader's client renders it
 * in their own time zone, with the exact time on hover.
 */
export const at = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:R>`;

/** How every Chat control message shows a Run's lifecycle. */
export const LIFECYCLE: Record<RunReport["run"]["state"], string> = {
  active: "🟢 Active",
  snoozed: "💤 Snoozed",
  settled: "✅ Settled",
  archived: "🗄️ Archived",
};
const ACTIVE_BLOCKS = new Set(["working", "waiting", "sent"]);
const BLOCK_STATES: Record<string, string> = {
  working: "⚙️ {block} — working",
  waiting: "⏳ {block} — waiting",
  sent: "⚙️ {block} — Continuation sent",
};
const OBSERVATIONS: Record<string, string> = {
  stale: " · observation stale",
  unknown: " · not observed yet",
};
const NEEDS_INPUT: Record<string, string> = {
  human: "Human step",
  "native-request": "T3 request (answer it in T3)",
  "conversation-waiting": "Agent question",
};
const PROBLEMS: Record<string, string> = {
  "missing-report": "report missing",
  "execution-failed": "execution failed",
  "report-problem": "report problem",
  "condition-integrity": "Condition cannot number its next arrival",
  "settlement-unresolved": "Settle could not stop workers",
};

/** At most `limit` lines of one kind, summarizing the rest as `what`; nothing when empty. */
function section(what: string, lines: readonly string[], limit: number) {
  const shown = lines.slice(0, limit);
  const rest = lines.length - shown.length;
  return [...shown, ...(rest > 0 ? [`… and ${rest} more ${what}`] : [])];
}

/**
 * A Run's status card: identity, lifecycle and Flow, then only what is happening now: active
 * Blocks, pending Waits with deadlines, Needs input and Problems, from Factory's own facts. It never
 * carries results, report bodies or prompts, and always fits one Discord message: long lists are
 * summarized.
 */
function statusCardText(report: RunReport, replacedApplication: boolean) {
  const { run } = report;
  const head = [
    ...(replacedApplication ? [`_${APPLICATION_NOTICE}_`, ""] : []),
    `${runHeading(runReference(run), run.title)} · ${LIFECYCLE[run.state]} · 🔀 ${name(run.flow)}`,
    ...(report.settlement === null
      ? []
      : [
          report.settlement === "stopping"
            ? "⏹️ Settle confirmed: Factory is stopping this Run's workers."
            : "⚠️ Settle confirmed, but some workers could not be confirmed stopped.",
        ]),
  ];
  const blocks = report.blocks
    .filter((block) => ACTIVE_BLOCKS.has(block.state))
    .map(
      (block) =>
        `${BLOCK_STATES[block.state]!.replace("{block}", name(block.name))}${OBSERVATIONS[block.observation] ?? ""}`,
    );
  const waits = report.pendingWaits.map(
    (wait) => `⏰ ${name(wait.block)} — waits until ${at(wait.deadlineAt)}`,
  );
  const needsInput = report.needsInput.map(
    (matter) =>
      `🙋 ${NEEDS_INPUT[matter.kind]} in ${name(matter.block)}${OBSERVATIONS[matter.observation] ?? ""}`,
  );
  const problems = report.problems.map(
    (matter) =>
      `⚠️ ${matter.block === null ? "" : `${name(matter.block)} — `}${PROBLEMS[matter.kind]}${
        OBSERVATIONS[matter.observation] ?? ""
      }`,
  );
  const render = (limit: number) =>
    [
      ...head,
      ...section("active Blocks", blocks, limit),
      ...section("Waits", waits, limit),
      ...section("Needs input", needsInput, limit),
      ...section("Problems", problems, limit),
    ].join("\n");
  for (const limit of LIST_LIMITS) {
    const text = render(limit);
    if (text.length <= MESSAGE_LIMIT) return text;
  }
  return clip(render(0), MESSAGE_LIMIT);
}

/** A card that replaces another application's card carries the notice once, as its first line. */
export const withApplicationNotice = (text: string) =>
  text.startsWith(`_${APPLICATION_NOTICE}_`) ? text : `_${APPLICATION_NOTICE}_\n\n${text}`;

type CardRow = {
  delivery_id: string;
  replaced_application_id: string | null;
};

type CardDeliveryRow = {
  id: string;
  state: "owed" | "sending" | "delivered" | "failed" | "unknown" | "cancelled" | "lost" | "retired";
  text: string;
  message_id: string | null;
  sent_by_application_id: string | null;
};

/** Card message states in which nothing more is owed. */
const SETTLED_STATES = new Set<CardDeliveryRow["state"]>(["delivered", "retired", "cancelled"]);

/**
 * The state a card's message record moves to for `text`. A cancelled card is current again once
 * its channel grants the Run once more: a known message is corrected silently, and a card never
 * created is created only if the Run warrants one. Other states keep their state and take the text.
 */
function nextState(current: CardDeliveryRow, text: string, reportable: boolean) {
  if (current.state !== "delivered" && current.state !== "cancelled") return current.state;
  if (current.message_id !== null) return current.text === text ? "delivered" : "owed";
  return reportable ? "owed" : current.state;
}

/** Whether a Run warrants a card now: Active or Snoozed, or with pending attention. */
const reportableNow = (report: RunReport) =>
  report.run.state === "active" ||
  report.run.state === "snoozed" ||
  report.needsInput.length > 0 ||
  report.problems.length > 0;

/**
 * The status card's capture: one maintained card per chat-started Run, owed from the first
 * capture after Start and kept equal to the Run's current report. A delivered card owes an edit
 * whenever its text changes; an owed or uncertain card simply carries the newest text. After a
 * revocation the card accrues nothing; once its channel grants the Run again, a known card is
 * corrected silently and a never-created one is created only while the Run warrants a card.
 */
export const statusCards = (sql: SqlClient.SqlClient): ReportConsumer => {
  const insertCard = (origin: ReportOrigin, report: RunReport, text: string) =>
    Effect.gen(function* () {
      const id = yield* newId;
      const createdAt = yield* now;
      const { destination } = origin;
      yield* sql`INSERT INTO chat_deliveries (id,purpose,run_id,guild_id,parent_channel_id,thread_id,project_ids_json,text,state,created_at)
        VALUES (${id},'status-card',${origin.runId},${destination.guildId},${destination.parentChannelId},${destination.threadId},
          ${JSON.stringify([report.run.project.id])},${text},'owed',${createdAt})`;
      return id;
    });

  /** Creates the Run's first card, owed since its Start whatever the Run's state now. */
  const firstCard = (origin: ReportOrigin, report: RunReport) =>
    Effect.gen(function* () {
      const id = yield* insertCard(origin, report, statusCardText(report, false));
      yield* sql`INSERT INTO chat_status_cards (run_id,delivery_id,reportable) VALUES (${origin.runId},${id},${reportableNow(report) ? 1 : 0})`;
    });

  /** Brings the card's current message record to `text`. */
  const updateCard = (current: CardDeliveryRow, text: string, reportable: boolean) =>
    Effect.gen(function* () {
      const state = nextState(current, text, reportable);
      if (state !== current.state)
        yield* sql`UPDATE chat_deliveries SET text=${text},state=${state},next_attempt_at=NULL,problem=NULL,problem_at=NULL WHERE id=${current.id}`;
      else if (current.text !== text)
        yield* sql`UPDATE chat_deliveries SET text=${text} WHERE id=${current.id}`;
      return state;
    });

  /** A retired card's application no longer serves; a Run warranting a card gets a new one. */
  const renewRetired = (
    origin: ReportOrigin,
    report: RunReport,
    current: CardDeliveryRow,
    text: string,
  ) =>
    Effect.gen(function* () {
      if (!reportableNow(report)) return current.state;
      const id = yield* insertCard(origin, report, withApplicationNotice(text));
      yield* sql`UPDATE chat_status_cards SET delivery_id=${id},replaced_application_id=${current.sent_by_application_id} WHERE run_id=${origin.runId}`;
      return "owed" as const;
    });

  return {
    capture: (origin, report) =>
      Effect.gen(function* () {
        if (!report) return;
        const [card] =
          yield* sql<CardRow>`SELECT delivery_id,replaced_application_id FROM chat_status_cards WHERE run_id=${origin.runId}`;
        if (!card) return yield* firstCard(origin, report);
        const text = statusCardText(report, card.replaced_application_id !== null);
        const [current] =
          yield* sql<CardDeliveryRow>`SELECT id,state,text,message_id,sent_by_application_id FROM chat_deliveries WHERE id=${card.delivery_id}`;
        const reportable = reportableNow(report);
        const state =
          current!.state === "retired"
            ? yield* renewRetired(origin, report, current!, text)
            : yield* updateCard(current!, text, reportable);
        const final = report.run.state === "archived" && SETTLED_STATES.has(state);
        yield* sql`UPDATE chat_status_cards SET reportable=${reportable ? 1 : 0},final=${final ? 1 : 0} WHERE run_id=${origin.runId}`;
      }),
  };
};
