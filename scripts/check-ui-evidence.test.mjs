import assert from "node:assert/strict";
import test from "node:test";
import { checkUiEvidence } from "./check-ui-evidence.mjs";

await test("evidence images with nested brackets in their labels are accepted", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| ![state [open] view](https://example.com/before.png) | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("evidence images with escaped brackets in their labels are accepted", () => {
  // Arrange
  const body = String.raw`## UI screenshots
| Before | After |
| --- | --- |
| ![a \] b](https://example.com/before.png) | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("evidence images with a title after the HTTPS URL are accepted", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| ![before](https://example.com/before.png "Before view") | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("a missing After image is reported", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| ![before](https://example.com/before.png) | Pending capture. |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["After"]);
});

await test("an image inside an HTML comment does not satisfy Before evidence", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| <!-- ![before](https://example.com/before.png) --> | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before"]);
});

await test("an image inside a fenced code block does not satisfy Before evidence", () => {
  // Arrange
  const body = `## UI screenshots
\`\`\`markdown
| Before | After |
| --- | --- |
| ![before](https://example.com/before.png) | |
\`\`\`
| Before | After |
| --- | --- |
| | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before"]);
});

await test("CRLF evidence after a fenced block is accepted", () => {
  // Arrange
  const body = [
    "## Verification",
    "```sh",
    "pnpm check",
    "```",
    "## UI screenshots",
    "| Before | After |",
    "| --- | --- |",
    "| ![before](https://example.com/before.png) | ![after](https://example.com/after.png) |",
  ].join("\r\n");

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("an unmatched backtick does not hide later evidence", () => {
  // Arrange
  const body = `## Verification
Run \`pnpm dev to see it.

## UI screenshots
| Before | After |
| --- | --- |
| ![before](https://example.com/before.png) | ![after](https://example.com/after.png) uses \`code\`. |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("an image inside an inline code span does not satisfy Before evidence", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| \`![before](https://example.com/before.png)\` | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before"]);
});

await test("a stated reason under No UI evidence replaces Before and After images", () => {
  // Arrange
  const body = `## UI screenshots
### No UI evidence
Only renames an internal frontend type; no rendered output changes.
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, []);
});

await test("a No UI evidence heading without a reason still requires Before and After images", () => {
  // Arrange
  const body = `## UI screenshots
### No UI evidence
<!-- State why this change has no visible UI impact. -->
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before", "After"]);
});

await test("a header without a matching two-cell delimiter row is not an evidence table", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- |
| ![before](https://example.com/before.png) | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before", "After"]);
});

await test("reversed or extra evidence columns are not an evidence table", () => {
  // Arrange
  const body = `## UI screenshots
| After | Before |
| --- | --- |
| ![after](https://example.com/after.png) | ![before](https://example.com/before.png) |

| Before | After | Notes |
| --- | --- | --- |
| ![before](https://example.com/before.png) | ![after](https://example.com/after.png) | |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before", "After"]);
});

await test("Before and After images on separate rows do not form a pair", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| ![before](https://example.com/before.png) | |
| | ![after](https://example.com/after.png) |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["After"]);
});

await test("an image label split across rows does not satisfy its column", () => {
  // Arrange
  const body = `## UI screenshots
| Before | After |
| --- | --- |
| ![before | ![after](https://example.com/after.png) |
| view](https://example.com/before.png) | |
`;

  // Act
  const missing = checkUiEvidence(body);

  // Assert
  assert.deepEqual(missing, ["Before"]);
});
