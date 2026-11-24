import type { OperationError, Result, ValidationIssue } from "@agent-easel/contracts";

export const failure = (
  code: OperationError["code"],
  message: string,
  issues: readonly ValidationIssue[] = [],
): Result<never> => ({ ok: false, error: { code, message, issues } });
