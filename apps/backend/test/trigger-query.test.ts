import { assert, expect, it } from "@effect/vitest";
import { parseTriggerQuery } from "@agent-easel/domain-validation";

it("a quoted label is the ready label without its quotes", () => {
  // Act
  const parsed = parseTriggerQuery('label:"needs agent" author:@me');

  // Assert
  assert(parsed.ok);
  expect(parsed.value).toStrictEqual({
    query: 'label:"needs agent" author:@me',
    readyLabel: "needs agent",
    authorFilter: true,
  });
});

it("excluded labels and OR alternatives in parentheses keep the single ready label", () => {
  // Act
  const parsed = parseTriggerQuery(
    "label:factory:ready -label:blocked (author:alice OR author:bob)",
  );

  // Assert
  assert(parsed.ok);
  expect(parsed.value.readyLabel).toBe("factory:ready");
});

it("a query without a label is refused", () => {
  // Act
  const parsed = parseTriggerQuery("author:@me reactions:>2");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_label_missing");
});

it("a query with two positive labels is refused", () => {
  // Act
  const parsed = parseTriggerQuery("label:factory:ready label:bug");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_label_multiple");
});

it("a comma between labels is refused because it matches any of them", () => {
  // Act
  const parsed = parseTriggerQuery('label:"factory:ready,bug"');

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_label_or");
});

it("a negated label alone cannot be the ready label", () => {
  // Act
  const parsed = parseTriggerQuery("-label:factory:ready author:@me");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_label_negated");
});

it("no:label is refused because no label could mark an issue as ready", () => {
  // Act
  const parsed = parseTriggerQuery("label:factory:ready no:label");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_no_label");
});

it("an OR beside the label is refused because it would match issues without it", () => {
  // Act
  const parsed = parseTriggerQuery("label:factory:ready OR author:@me");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_or");
});

it("a label inside parentheses is refused", () => {
  // Act
  const parsed = parseTriggerQuery("(label:factory:ready author:@me)");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]?.code).toBe("trigger_query_parentheses");
});

it("a repository qualifier is refused because the Project chooses the repository", () => {
  // Act
  const parsed = parseTriggerQuery("label:factory:ready repo:someone/else");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]).toMatchObject({
    code: "trigger_query_scope",
    message: expect.stringContaining('"repo:"'),
  });
});

it("a state qualifier is refused because Factory reads open issues only", () => {
  // Act
  const parsed = parseTriggerQuery("label:factory:ready is:closed");

  // Assert
  assert(!parsed.ok);
  expect(parsed.error.issues[0]).toMatchObject({
    code: "trigger_query_scope",
    message: expect.stringContaining('"is:"'),
  });
});
