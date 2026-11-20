import type { ReactNode } from "react";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProblemCard } from "./problem-card.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { fieldAria } from "./field-state.ts";

/** The T3 address field names the card that explains why its value is not allowed. */
const addressProblemId = "connection-address-problem";

/** The same rule the backend applies to a saved or detected T3 address. */
export function allowedAddress(value: string) {
  const url = URL.parse(value.trim());
  return (
    !!url &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}

/**
 * Where a T3 address comes from, shown wherever one is typed (First-run setup and Settings → T3
 * connection), so the explanations cannot diverge. A form placed inside, and its validation
 * message, sit between the explanation and the rule.
 */
export function T3AddressHelp({
  children,
  invalid,
}: {
  children?: ReactNode;
  /** Shows the existing validation message for the typed address. */
  invalid: boolean;
}) {
  return (
    <div className="grid gap-2.5 text-sm text-muted-foreground">
      <p>
        T3 serves Factory’s connection at /mcp on its own address. With T3’s default port that is
        http://127.0.0.1:3773/mcp — if you started T3 on another port, use that port. T3 must run on
        this computer, as the same user as Factory.
      </p>
      {children}
      {invalid && <AddressProblem />}
      <p className="text-2xs font-medium text-subtle-foreground">
        HTTPS, or HTTP on this computer. Never paste tokens into the URL.
      </p>
    </div>
  );
}

function AddressProblem() {
  return (
    <ProblemCard id={addressProblemId} tone="error" title="Use HTTPS, or HTTP on this computer">
      Leave credentials, queries and fragments out of the address.
    </ProblemCard>
  );
}

export function T3AddressForm({
  value,
  invalid,
  disabled,
  submitLabel,
  onChange,
  onSave,
}: {
  value: string;
  invalid: boolean;
  disabled: boolean;
  submitLabel: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const blocked = disabled || invalid || !value.trim();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onSave();
      }}
    >
      <Input
        type="url"
        aria-label="Address"
        {...fieldAria(invalid && addressProblemId)}
        disabled={disabled}
        value={value}
        placeholder="http://127.0.0.1:3773/mcp"
        className="min-w-28 flex-1 bg-muted font-mono text-label"
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid && <StatusBadge kind="error">Not allowed</StatusBadge>}
      <MutationGate>
        <Button type="submit" disabled={blocked}>
          {submitLabel}
        </Button>
      </MutationGate>
    </form>
  );
}
