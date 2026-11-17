import { useRef } from "react";

/**
 * A menu whose item actions run once it has closed and refocused its trigger, so a dialog an action
 * opens returns focus to the trigger when it closes.
 */
export function useMenuActions() {
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);
  return {
    trigger,
    queue(action: () => void) {
      pending.current = action;
    },
    onCloseAutoFocus(event: Event) {
      const action = pending.current;
      if (!action) return;
      pending.current = null;
      event.preventDefault();
      trigger.current?.focus();
      action();
    },
  };
}
