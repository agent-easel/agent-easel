import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { MutationGate } from "@/client-gate";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type HeaderElementProps = Omit<ComponentProps<"header">, "children" | "title">;

/** The editable name in the Toolbar layout, edited in place. */
type StudioEditorNameField = {
  /** The field's accessible name, such as "Flow name". */
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

type TitleHeading = {
  title: ReactNode;
  /** The title's heading level within the editor's page. */
  headingLevel: 1 | 2;
};

type StudioEditorHeaderProps = HeaderElementProps &
  (
    | {
        /** One 52 px row above a canvas (Flow editor). */
        layout: "toolbar";
        owner: ReactNode;
        nameField: StudioEditorNameField;
        status: ReactNode;
        controls?: ReactNode;
        moreActions: ReactNode;
        save: ReactNode;
      }
    | ({
        /** The title row with its actions, then one status line (Agent editor). */
        layout: "stacked";
        status: ReactNode;
        controls?: ReactNode;
        moreActions?: ReactNode;
        save: ReactNode;
      } & TitleHeading)
    | ({
        /** A page title with its controls at the right, then a status strip; Save stays in the
         * page's own footer (Trigger editor). */
        layout: "page";
        status?: ReactNode;
        controls?: ReactNode;
      } & TitleHeading)
  );

/**
 * Figma 🧩 Studio/EditorHeader: one header for the Studio editors, in the element order owner,
 * name, save status, controls, More actions, Save.
 */
export function StudioEditorHeader(props: StudioEditorHeaderProps) {
  switch (props.layout) {
    case "toolbar": {
      const {
        layout: _layout,
        owner,
        nameField,
        status,
        controls,
        moreActions,
        save,
        className,
        ...rest
      } = props;
      return (
        <header
          className={cn("flex h-13 shrink-0 items-center gap-2.5 border-b px-4", className)}
          {...rest}
        >
          {owner}
          <Input
            aria-label={nameField.label}
            className="field-sizing-content h-8 w-auto max-w-80 min-w-24 border-transparent bg-transparent px-1.5 text-base font-semibold hover:border-border focus-visible:border-ring"
            value={nameField.value}
            disabled={nameField.disabled}
            onChange={(event) => nameField.onChange(event.target.value)}
          />
          {status}
          <span className="flex-1" />
          {controls}
          {moreActions}
          {save}
        </header>
      );
    }
    case "stacked": {
      const {
        layout: _layout,
        title,
        headingLevel,
        status,
        controls,
        moreActions,
        save,
        className,
        ...rest
      } = props;
      return (
        <header
          className={cn(
            "flex min-w-0 shrink-0 flex-col gap-1.5 border-b px-6 pt-5 pb-4",
            className,
          )}
          {...rest}
        >
          <div className="flex flex-wrap items-center gap-2">
            <EditorTitle level={headingLevel}>{title}</EditorTitle>
            {/* The actions wrap together, so Save never leaves More actions behind. */}
            <div className="ml-auto flex max-w-full min-w-0 items-center gap-2">
              {controls}
              {moreActions}
              {save}
            </div>
          </div>
          {status}
        </header>
      );
    }
    case "page": {
      const { layout: _layout, title, headingLevel, status, controls, className, ...rest } = props;
      return (
        <header className={cn("mb-5 grid gap-5", className)} {...rest}>
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <EditorTitle level={headingLevel}>{title}</EditorTitle>
            {controls}
          </div>
          {status}
        </header>
      );
    }
  }
}

function EditorTitle({ level, children }: { level: 1 | 2; children: ReactNode }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Heading className="min-w-0 max-w-full text-xl leading-tight font-semibold break-words">
      {children}
    </Heading>
  );
}

/**
 * The save state beside the name or on the status line: an attention dot while the draft differs
 * from its saved revision, a check once it matches.
 */
export function StudioSaveStatus({
  unsaved,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { unsaved: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    >
      {unsaved ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention" />
      ) : (
        <Check aria-hidden className="size-3 shrink-0 text-success" />
      )}
      {children}
    </span>
  );
}

/**
 * Save, the only primary action in a Studio editor: filled only while there are unsaved changes it
 * may send (or is sending), otherwise neutral and disabled. It reads "Saving…" while saving.
 */
export function StudioSaveButton({
  unsaved,
  ready,
  saving,
  children = "Save",
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "disabled" | "children"> & {
  /** The draft differs from its saved revision (a new definition is unsaved). */
  unsaved: boolean;
  /** Nothing else blocks the save, such as a blank required name or a refused draft. */
  ready: boolean;
  saving: boolean;
  /** The idle label, such as "Create Agent" for a new definition. */
  children?: string;
}) {
  const filled = unsaved && (ready || saving);
  return (
    <MutationGate>
      <Button
        {...props}
        variant={filled ? "default" : "outline"}
        disabled={saving || !unsaved || !ready}
      >
        {saving ? "Saving…" : children}
      </Button>
    </MutationGate>
  );
}
