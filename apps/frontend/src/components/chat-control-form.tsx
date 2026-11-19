import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApiError } from "../api.ts";
import { MutationGate } from "../client-gate.tsx";
import { fieldAria, fieldBorder, type FieldState } from "./field-state.ts";
import { SettingsDraftDialog, type useSettingsDraftGuard } from "./settings-draft-guard.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsPage } from "./settings-page.tsx";

/** The operation's message with its distinct issue messages, or `fallback` for a lost answer. */
export const chatControlError = (cause: unknown, fallback: string) =>
  cause instanceof ApiError
    ? [cause.message, ...cause.detail.issues.map((issue) => issue.message)]
        .filter((text, index, all) => all.indexOf(text) === index)
        .join(" ")
    : cause instanceof Error
      ? cause.message
      : fallback;

/** A refused or lost save: its explanation and the input fields the host named. */
export interface SaveFailure {
  readonly message: string;
  readonly paths: readonly string[];
}

/**
 * One Chat control section's saved settings and in-memory draft, read from the host. A save whose
 * answer is lost is resolved by reading the host's current state, never by saving again:
 * `committed` says whether that state holds exactly the submitted values. `save` resolves to
 * whether the section is now saved.
 */
export function useChatControlSection<Settings, Draft, Input>(section: {
  /** Module-level functions, so the section reads once per page and on reload. */
  readonly read: () => Promise<Settings>;
  readonly update: (input: Input) => Promise<Settings>;
  readonly draftOf: (settings: Settings) => Draft;
  readonly committed: (input: Input, current: Settings) => boolean;
  /** The section's name in failure messages, such as "the Discord connection". */
  readonly name: string;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loads, setLoads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const { read, update, draftOf, committed, name } = section;
  const adopt = (next: Settings) => {
    setSettings(next);
    setDraft(draftOf(next));
  };
  useEffect(() => {
    let active = true;
    read().then(
      (value) => {
        if (!active) return;
        setSettings(value);
        setDraft(draftOf(value));
      },
      (cause: unknown) =>
        active && setLoadError(chatControlError(cause, `Factory could not read ${name}.`)),
    );
    return () => {
      active = false;
    };
  }, [loads, read, draftOf, name]);
  const save = async (input: Input): Promise<boolean> => {
    setSaving(true);
    setSaveFailure(null);
    const refused = (cause: unknown) => {
      if (cause instanceof ApiError) {
        setSaveFailure({
          message: chatControlError(cause, ""),
          paths: cause.detail.issues.map((issue) => issue.path),
        });
        return Promise.resolve(false);
      }
      return read()
        .catch(() => null)
        .then((current) => {
          if (current !== null && committed(input, current)) {
            adopt(current);
            return true;
          }
          setSaveFailure({
            message: `${chatControlError(cause, `Factory could not save ${name}.`)} Your edits are kept; save again when Factory answers.`,
            paths: [],
          });
          return false;
        });
    };
    return await update(input)
      .then((next) => {
        adopt(next);
        return true;
      }, refused)
      .finally(() => {
        setSaving(false);
      });
  };
  const discard = () => {
    if (settings !== null) setDraft(draftOf(settings));
    setSaveFailure(null);
  };
  return {
    settings,
    setSettings,
    draft,
    setDraft,
    loadError,
    reload: () => {
      setLoadError("");
      setLoads((n) => n + 1);
    },
    saving,
    saveFailure,
    save,
    discard,
  };
}

/**
 * A Chat control page's header actions: Discard only while there are unsaved edits, the page's
 * own actions, then Save, primary only for a valid, decided draft.
 */
export function SaveActions({
  dirty,
  saving,
  onSave,
  onDiscard,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  /** Undefined while the draft cannot be saved. */
  onSave: (() => void) | undefined;
  onDiscard: () => void;
  /** Actions between Discard and Save, such as Test connection. */
  children?: ReactNode;
}) {
  return (
    <>
      {dirty && (
        <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
      )}
      {children}
      <Button
        type="button"
        variant={onSave ? "default" : "outline"}
        disabled={!onSave || saving}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
    </>
  );
}

/**
 * A Chat control Settings page on the shared Settings page template: header badge and actions,
 * then its cards once the host's settings are read, with the dialog that guards their unsaved
 * edits. A failed read shows one Error card and Try again as the header's primary action. The
 * pages are listed only on the host, the one client that can change them, so they show no
 * host-managed chip.
 */
export function ChatControlPage({
  title,
  badge,
  actions,
  loadError,
  onRetry,
  decision,
  children,
}: {
  title: string;
  badge: ReactNode;
  actions: ReactNode;
  loadError: string;
  onRetry: () => void;
  decision: ReturnType<typeof useSettingsDraftGuard>;
  /** The page's cards, or null until its settings are read. */
  children: ReactNode | null;
}) {
  return (
    <SettingsPage
      title={title}
      badge={loadError ? undefined : badge}
      action={
        loadError ? (
          <Button type="button" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          children !== null && <MutationGate>{actions}</MutationGate>
        )
      }
    >
      {loadError ? (
        <ProblemCard tone="error" title="Couldn’t read the settings" details={loadError}>
          Factory didn’t answer. Try again.
        </ProblemCard>
      ) : children !== null ? (
        <MutationGate>{children}</MutationGate>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Reading {title} settings…
        </p>
      )}
      <SettingsDraftDialog decision={decision} />
    </SettingsPage>
  );
}

/**
 * One editable setting in a labelled card: the label column, the field, then a field-state tag.
 * Secondary text such as resolved names sits under the field.
 */
export function FieldRow({
  label,
  htmlFor,
  tag,
  secondary,
  children,
}: {
  label: ReactNode;
  /** The field the label names; omit when the row holds several controls. */
  htmlFor?: string;
  tag?: ReactNode;
  secondary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 text-sm leading-tight">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="w-37.5 shrink-0 text-muted-foreground max-sm:w-24">
          {label}
        </label>
      ) : (
        <span className="w-37.5 shrink-0 text-muted-foreground max-sm:w-24">{label}</span>
      )}
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {children}
          {tag}
        </div>
        {secondary && (
          <div className="flex flex-wrap items-center gap-1 text-muted-foreground">{secondary}</div>
        )}
      </div>
    </div>
  );
}

/** What a save does with a stored secret. */
export type SecretChoice = "keep" | "replace" | "remove";

interface SecretFieldProps {
  id: string;
  label: string;
  stored: boolean;
  choice: SecretChoice;
  value: string;
  placeholder: string;
  state?: FieldState | undefined;
  /** The field-state tag, shown after Stored or after the open field. */
  tag?: ReactNode;
  disabled: boolean;
  onChoice: (choice: SecretChoice) => void;
  onValue: (value: string) => void;
}

/**
 * The API key or bot token as the standard bordered, masked field. A stored secret shows Stored
 * with Replace and Remove; Replace opens the masked field with Cancel, and Remove shows None with
 * Undo until Save. A blank field never clears a stored secret.
 */
export function SecretField(props: SecretFieldProps) {
  return props.stored && props.choice !== "replace" ? (
    <StoredSecret {...props} />
  ) : (
    <OpenSecret {...props} />
  );
}

function StoredSecret({ label, choice, state, tag, disabled, onChoice }: SecretFieldProps) {
  const removing = choice === "remove";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className={removing ? "text-muted-foreground" : "text-foreground"}>
        {removing ? "None" : "Stored"}
      </span>
      {tag}
      <span className="flex-1" />
      {removing ? (
        <Button
          type="button"
          variant="outline"
          aria-label={`Undo removing the ${label}`}
          disabled={disabled}
          onClick={() => onChoice("keep")}
        >
          Undo
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            aria-label={`Replace the ${label}`}
            aria-describedby={state?.cardId}
            disabled={disabled}
            onClick={() => onChoice("replace")}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label={`Remove the ${label}`}
            disabled={disabled}
            onClick={() => onChoice("remove")}
          >
            Remove
          </Button>
        </>
      )}
    </div>
  );
}

function OpenSecret({
  id,
  stored,
  value,
  placeholder,
  state,
  tag,
  disabled,
  onChoice,
  onValue,
}: SecretFieldProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        id={id}
        type="password"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        // Replace opens the field in its Open state.
        autoFocus={stored}
        disabled={disabled}
        className={cn("bg-muted font-mono text-label", fieldBorder(state?.tone))}
        {...fieldAria(state?.cardId)}
        onChange={(event) => onValue(event.target.value)}
      />
      {tag}
      {stored && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            onValue("");
            onChoice("keep");
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
