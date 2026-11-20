import { createElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDismiss,
  DialogSurface,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { fieldLabelClass } from "./page.tsx";
import { TechnicalDetails, type TechnicalDetail } from "./technical-details.tsx";

/**
 * `card` is secondary card text, such as a result preview; `primary` is card-size text that is
 * the card's own content, such as a Needs input card's text or a held Wait message.
 */
type Density = "card" | "primary" | "reader";

const typography: Record<Density, { title: string; heading: string; text: string }> = {
  card: {
    title: "text-sm font-semibold text-foreground",
    heading: "text-sm font-semibold text-foreground",
    text: "text-sm text-muted-foreground",
  },
  primary: {
    title: "text-sm font-semibold text-foreground",
    heading: "text-sm font-semibold text-foreground",
    text: "text-sm text-foreground",
  },
  reader: {
    title: "text-lg font-semibold text-foreground",
    heading: "text-base font-semibold text-foreground",
    text: "text-base text-muted-foreground",
  },
};

/** Gives a Markdown element its design-system classes; react-markdown's `node` stays out of the DOM. */
function styled(tag: string, className: string) {
  return function Styled({
    node: _node,
    className: own,
    ...props
  }: ExtraProps & { className?: string | undefined }) {
    return createElement(tag, { ...props, className: cn(className, own) });
  };
}

function markdownComponents(density: Density): Components {
  const { title, heading, text } = typography[density];
  return {
    h1: styled("h1", title),
    h2: styled("h2", title),
    h3: styled("h3", heading),
    h4: styled("h4", heading),
    h5: styled("h5", heading),
    h6: styled("h6", heading),
    p: styled("p", text),
    ul: styled(
      "ul",
      cn(text, "flex list-disc flex-col gap-1.5 pl-5 marker:text-subtle-foreground"),
    ),
    ol: styled(
      "ol",
      cn(text, "flex list-decimal flex-col gap-1.5 pl-5 marker:text-subtle-foreground"),
    ),
    li: styled(
      "li",
      // A task item stays a block with its checkbox inline, so its text and a long unbroken link
      // wrap like any list item; only task items drop the bullet in a mixed list.
      "pl-0.5 [&.task-list-item]:-ml-4 [&.task-list-item]:list-none [&>ol]:mt-1.5 [&>ul]:mt-1.5",
    ),
    blockquote: styled("blockquote", "flex flex-col gap-2 border-l-2 pl-3"),
    hr: styled("hr", "border-border"),
    code: styled("code", "font-mono text-foreground"),
    pre: styled(
      "pre",
      "overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground",
    ),
    table: ({ node: _node, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props} className={cn(text, "border-collapse")} />
      </div>
    ),
    th: styled("th", "border px-2 py-1 text-left font-semibold text-foreground"),
    td: styled("td", "border px-2 py-1 align-top"),
    a: ({ node: _node, target: _target, rel: _rel, href, children, className, ...props }) =>
      href === undefined ? (
        children
      ) : (
        <TextLink
          {...props}
          href={href}
          className={cn("inline p-0 [font-weight:inherit]", className)}
        >
          {children}
        </TextLink>
      ),
    // Agent text never fetches remote images: an image reads as a link to it.
    img: ({ src, alt }) =>
      typeof src === "string" ? (
        <TextLink href={src} className="inline p-0 [font-weight:inherit]">
          {alt || src}
        </TextLink>
      ) : null,
    input: ({ checked }) => (
      <Checkbox
        checked={!!checked}
        disabled
        aria-label={checked ? "Done" : "Not done"}
        className="mr-2 align-[-0.1875rem]"
      />
    ),
  };
}

const components = {
  card: markdownComponents("card"),
  primary: markdownComponents("primary"),
  reader: markdownComponents("reader"),
};

/**
 * One rendering of Agent-written text: CommonMark with GitHub tables and task lists, keeping single
 * line breaks. Raw HTML stays literal text and links open outside Factory.
 */
export function AgentMarkdown({ text, density }: { text: string; density: Density }) {
  return (
    <div
      className={cn("flex min-w-0 flex-col break-words", density === "reader" ? "gap-3" : "gap-2")}
    >
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components[density]}>
        {text}
      </Markdown>
    </div>
  );
}

/** What a reader dialog says about the text it shows, apart from the text itself. */
export type ReaderHeading = {
  /** A result's reader names its close action and text after the result. */
  kind: "result" | "text";
  title: string;
  /** Where the text came from; empty when there is nothing to say. */
  provenance: string;
  /** The T3 thread offered as **Open in T3** in the reader header. */
  t3Link: string | null;
  technicalDetails?: readonly TechnicalDetail[];
};

/** A reader uses the same actions for a result, Working report, or Human context. */
function TextReader({
  kind,
  title,
  provenance,
  t3Link,
  technicalDetails,
  detailsOpen,
  text,
  onClose,
  children,
}: ReaderHeading & {
  /** The raw text **Copy Markdown** copies. */
  text: string;
  /** Opens with Technical details expanded. */
  detailsOpen?: boolean | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const result = kind === "result";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogSurface
        {...(!provenance && { "aria-describedby": undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          body.current?.focus();
        }}
        className="flex max-h-[85dvh] w-[min(calc(100vw-32px),45rem)] flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex min-w-0 shrink-0 items-center gap-2 border-b py-3.5 pr-3 pl-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.75">
            <DialogTitle className="truncate text-title font-semibold">{title}</DialogTitle>
            {provenance && (
              <DialogDescription className="truncate text-label text-subtle-foreground">
                {provenance}
              </DialogDescription>
            )}
          </div>
          <CopyButton text={text} label="Copy Markdown" />
          {t3Link && <OpenInT3 href={t3Link} className="text-sm" />}
          <DialogDismiss label={result ? "Close result" : "Close reader"} />
        </header>
        <div
          ref={body}
          data-result-body
          tabIndex={0}
          role="region"
          aria-label={result ? "Result text" : "Reader text"}
          className="min-h-0 flex-1 overflow-y-auto px-7 py-5.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {children}
        </div>
        {technicalDetails && (
          <footer className="shrink-0 border-t px-5 pt-1.5 pb-2.5">
            <TechnicalDetails details={technicalDetails} defaultOpen={detailsOpen} />
          </footer>
        )}
      </DialogSurface>
    </Dialog>
  );
}

/** The reader showing Agent-written Markdown in full; `empty` stands in for text that is empty. */
export function AgentTextReader({
  text,
  heading,
  empty,
  detailsOpen,
  onClose,
}: {
  text: string;
  heading: ReaderHeading;
  empty?: string | undefined;
  detailsOpen?: boolean | undefined;
  onClose: () => void;
}) {
  return (
    <TextReader {...heading} text={text} detailsOpen={detailsOpen} onClose={onClose}>
      {text ? (
        <AgentMarkdown text={text} density="reader" />
      ) : (
        <p className="text-base text-muted-foreground">{empty}</p>
      )}
    </TextReader>
  );
}

/**
 * Collapsed previews fade out only when the text is longer than the preview. While clamped, a
 * link or scrolling block (code, table) reaching into the fade or below it is inert, so focus never
 * lands on what is barely visible or scrolls the preview; the reader keeps every one of them.
 * `fadeStart` is where the fade begins as a share of the preview's maximum height; both scale with
 * the root font size, so the cutoff is measured from the rendered maximum height.
 */
function useClampedPreview(text: string, fadeStart: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      setOverflowing(false);
      return;
    }
    const measure = () => {
      const clamped = element.scrollHeight > element.clientHeight + 1;
      const fade =
        element.getBoundingClientRect().top +
        parseFloat(getComputedStyle(element).maxHeight) * fadeStart;
      for (const stop of element.querySelectorAll<HTMLElement>("a, pre, div:has(> table)"))
        stop.inert = clamped && stop.getBoundingClientRect().bottom > fade;
      setOverflowing(clamped);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [text, fadeStart]);
  return [ref, overflowing] as const;
}

/** Each preview size; `fadeStart` repeats where its `fade` class begins, over its `clamp` height. */
const previews = {
  result: {
    density: "card",
    clamp: "max-h-16",
    fade: "mask-b-from-8",
    fadeStart: 8 / 16,
    gap: "gap-2.5",
  },
  // Figma RD42: the 64 px fade ends a 198 px preview, and the decision follows it.
  "needs-input": {
    density: "primary",
    clamp: "max-h-49.5",
    fade: "mask-b-from-33.5",
    fadeStart: 33.5 / 49.5,
    gap: "gap-1.5",
  },
} as const;

type PreviewSize = keyof typeof previews;

/**
 * Agent-written Markdown clamped to its rendered beginning, faded when it continues, with a link
 * that opens it in full in the reader when it continues. Text that fits offers its Technical
 * details, when it has them, as a link opening the reader with them expanded instead. `footer`
 * shares the link's row.
 */
export function AgentTextPreview({
  text,
  readLabel,
  heading,
  empty,
  footer,
  variant = "result",
}: {
  text: string;
  readLabel: string;
  heading: ReaderHeading;
  /** What the reader says when `text` is empty. */
  empty?: string | undefined;
  footer?: ReactNode;
  /** A Needs input card previews more of its text, in the card's own text colour. */
  variant?: PreviewSize;
}) {
  const [reading, setReading] = useState<"text" | "details" | null>(null);
  const { density, clamp, fade, fadeStart } = previews[variant];
  const [preview, overflowing] = useClampedPreview(text, fadeStart);
  const opens = overflowing ? "text" : heading.technicalDetails ? "details" : null;
  return (
    <>
      {text && (
        <div
          ref={preview}
          data-result-preview
          className={cn("overflow-hidden", clamp, overflowing && cn(fade, "mask-b-to-100%"))}
        >
          <AgentMarkdown text={text} density={density} />
        </div>
      )}
      {(footer || opens) && (
        <footer className="flex min-w-0 items-center gap-1.5">
          {footer}
          {opens && (
            <TextLink
              trailingIcon={Maximize2}
              // Figma RD42: alone on its row, the link lines up with the text above it.
              className={cn("shrink-0 text-label whitespace-nowrap", !footer && "px-0 py-0.5")}
              onClick={() => setReading(opens)}
            >
              {opens === "text" ? readLabel : "Technical details"}
            </TextLink>
          )}
        </footer>
      )}
      {reading && (
        <AgentTextReader
          text={text}
          heading={heading}
          empty={empty}
          detailsOpen={reading === "details"}
          onClose={() => setReading(null)}
        />
      )}
    </>
  );
}

/**
 * An Agent's current Working report under its label (Figma RD19), previewed with **Read full
 * report**; its reader adds **Open in T3** for `t3Link`. `children` follow the preview.
 */
export function WorkingReport({
  text,
  blockName,
  provenance,
  t3Link,
  size,
  children,
}: {
  text: string;
  blockName: string;
  provenance: string;
  t3Link: string | null;
  size: PreviewSize;
  children?: ReactNode;
}) {
  const label = useId();
  return (
    <section aria-labelledby={label} className={cn("flex min-w-0 flex-col", previews[size].gap)}>
      <h4 id={label} className={fieldLabelClass}>
        Working report
      </h4>
      <AgentTextPreview
        text={text}
        readLabel="Read full report"
        variant={size}
        heading={{ kind: "text", title: `${blockName} · Working report`, provenance, t3Link }}
      />
      {children}
    </section>
  );
}
