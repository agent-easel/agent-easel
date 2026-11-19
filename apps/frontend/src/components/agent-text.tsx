import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDismiss,
  DialogSurface,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { TechnicalDetails, type TechnicalDetail } from "./technical-details.tsx";

type Density = "card" | "reader";

const typography: Record<Density, { title: string; heading: string; text: string }> = {
  card: {
    title: "text-sm font-semibold text-foreground",
    heading: "text-sm font-semibold text-foreground",
    text: "text-sm text-muted-foreground",
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
      cn(
        text,
        "flex list-disc flex-col gap-1.5 pl-5 marker:text-subtle-foreground [&.contains-task-list]:list-none [&.contains-task-list]:pl-1",
      ),
    ),
    ol: styled(
      "ol",
      cn(text, "flex list-decimal flex-col gap-1.5 pl-5 marker:text-subtle-foreground"),
    ),
    li: styled(
      "li",
      "pl-0.5 [&.task-list-item]:flex [&.task-list-item]:items-center [&.task-list-item]:gap-2 [&>ol]:mt-1.5 [&>ul]:mt-1.5",
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
    a: ({ node: _node, ...props }) => (
      <a {...props} className="text-link hover:underline" target="_blank" rel="noreferrer" />
    ),
    // Agent text never fetches remote images: an image reads as a link to it.
    img: ({ src, alt }) =>
      typeof src === "string" ? (
        <a className="text-link hover:underline" href={src} target="_blank" rel="noreferrer">
          {alt || src}
        </a>
      ) : null,
    input: ({ checked }) => (
      <Checkbox checked={!!checked} disabled aria-label={checked ? "Done" : "Not done"} />
    ),
  };
}

const components = { card: markdownComponents("card"), reader: markdownComponents("reader") };

/**
 * One rendering of Agent-written text: CommonMark with GitHub tables and task lists. Raw HTML stays
 * literal text and links open outside Factory.
 */
export function AgentMarkdown({ text, density }: { text: string; density: Density }) {
  return (
    <div
      className={cn("flex min-w-0 flex-col break-words", density === "card" ? "gap-2" : "gap-3")}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components[density]}>
        {text}
      </Markdown>
    </div>
  );
}

/** What a reader dialog says about the text it shows, apart from the text itself. */
export type ReaderHeading = {
  title: string;
  /** Where the text came from; empty when there is nothing to say. */
  provenance: string;
  /** The T3 thread offered as **Open in T3** in the reader header. */
  t3Link: string | null;
  technicalDetails?: readonly TechnicalDetail[];
};

/** A reader uses the same actions for a result, Working report, or Human context. */
export function TextReader({
  title,
  provenance,
  t3Link,
  technicalDetails,
  text,
  onClose,
  children,
}: ReaderHeading & {
  /** The raw text **Copy Markdown** copies. */
  text: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const result = title.endsWith(" · result");
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
            <TechnicalDetails details={technicalDetails} />
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
  onClose,
}: {
  text: string;
  heading: ReaderHeading;
  empty?: string | undefined;
  onClose: () => void;
}) {
  return (
    <TextReader {...heading} text={text} onClose={onClose}>
      {text ? (
        <AgentMarkdown text={text} density="reader" />
      ) : (
        <p className="text-base text-muted-foreground">{empty}</p>
      )}
    </TextReader>
  );
}

/** Collapsed previews fade out only when the text is longer than the preview. */
function useOverflowing() {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, overflowing] as const;
}

/**
 * Agent-written Markdown clamped to its rendered beginning, faded when it continues, with a link
 * that opens it in full in the reader. The link appears when the reader shows more than the card:
 * text beyond the preview, or Technical details. `footer` shares the link's row.
 */
export function AgentTextPreview({
  text,
  readLabel,
  heading,
  empty,
  footer,
}: {
  text: string;
  readLabel: string;
  heading: ReaderHeading;
  /** What the reader says when `text` is empty. */
  empty?: string | undefined;
  footer?: ReactNode;
}) {
  const [reading, setReading] = useState(false);
  const [preview, overflowing] = useOverflowing();
  const readable = overflowing || !!heading.technicalDetails;
  return (
    <>
      {text && (
        <div
          ref={preview}
          data-result-preview
          className={cn(
            "max-h-16 overflow-hidden",
            overflowing && "mask-b-from-50% mask-b-to-100%",
          )}
        >
          <AgentMarkdown text={text} density="card" />
        </div>
      )}
      {(footer || readable) && (
        <footer className="flex min-w-0 items-center gap-1.5">
          {footer}
          {readable && (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="text-label"
              onClick={() => setReading(true)}
            >
              {readLabel}
              <Maximize2 aria-hidden />
            </Button>
          )}
        </footer>
      )}
      {reading && (
        <AgentTextReader
          text={text}
          heading={heading}
          empty={empty}
          onClose={() => setReading(false)}
        />
      )}
    </>
  );
}
