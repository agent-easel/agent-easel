/** A field's problem state: the tone of its status badge and the message that explains it. */
export interface FieldState {
  readonly tone: "error" | "attention";
  /** The id of the problem card or text, which the field names in `aria-describedby`. */
  readonly cardId: string;
}

/**
 * The ARIA wiring for a field that shows a state tag: invalid and described by the one message
 * that explains it. A field without a state gets neither attribute.
 */
export const fieldAria = (cardId: string | false | undefined) =>
  cardId ? { "aria-invalid": true as const, "aria-describedby": cardId } : {};

/** Classes for a field's border by its state; error borders come from `aria-invalid`. */
export const fieldBorder = (tone: FieldState["tone"] | undefined) =>
  tone === "attention" &&
  "border-attention aria-invalid:border-attention focus-visible:border-attention";
