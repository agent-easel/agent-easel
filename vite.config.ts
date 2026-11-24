import { defineConfig } from "vite-plus";
import reactHooks from "eslint-plugin-react-hooks";

// Generated output and hand-edited Markdown are not formatted or linted.
const ignorePatterns = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.e2e/**",
  "**/pnpm-lock.yaml",
  "**/*.md",
];

const privatePackageImports = {
  regex: "(^|/)(contracts|domain-validation)/(src|dist)(/|$)|^@agent-easel/[^/]+/(src|dist)(/|$)",
  message: "Use the workspace package's public exports instead of its implementation files.",
};
const sharedImportRestrictions = [
  privatePackageImports,
  {
    regex: "(^|/)(apps|backend|frontend|desktop)(/|$)",
    message: "Shared domain packages cannot depend on applications; put I/O in the owning app.",
  },
];

const backendImportRestrictions = [
  privatePackageImports,
  {
    regex: "(^|/)(frontend|desktop)(/|$)",
    message: "The backend owns Factory operations independently of its clients.",
  },
];

export default defineConfig({
  run: {
    cache: { scripts: true },
    tasks: {
      "gate:static": {
        command: "true",
        dependsOn: [
          "format:check",
          "check:e2e-configs",
          "check:product-name",
          "check:scenarios",
          "gate:fallow",
          "lint:workspace",
          "gate:typecheck",
        ],
        cache: false,
      },
      "gate:fallow": {
        command: "true",
        dependsOn: ["fallow:dead-code", "fallow:dupes", "fallow:complexity"],
        cache: false,
      },
      "gate:typecheck": {
        command: "true",
        dependsOn: [
          "typecheck:root",
          "@agent-easel/contracts#typecheck",
          "@agent-easel/domain-validation#typecheck",
          "@agent-easel/flow-layout#typecheck",
          "@agent-easel/backend#typecheck:src",
          "@agent-easel/backend#typecheck:test",
          "@agent-easel/frontend#typecheck",
          "@agent-easel/desktop#typecheck",
          "@agent-easel/landing#typecheck",
        ],
        cache: false,
      },
      "lint:oxlint": { command: "vp lint" },
      "lint:workspace": {
        command: "true",
        dependsOn: ["lint:comments", "lint:oxlint"],
        cache: false,
      },
      "lint:comments": { command: "node scripts/check-comments.mjs", cache: false },
      // Tests and the build start only after the static checks pass: they would compete with
      // them for CPU, and a static failure makes their result moot.
      "gate:dynamic": { command: "true", dependsOn: ["test", "build"], cache: false },
      "gate:check": {
        command:
          "vp run --concurrency-limit 8 gate:static && vp run --concurrency-limit 8 gate:dynamic",
        cache: false,
      },
    },
  },
  // Pre-commit: format, then fix lint, only the staged files. `vp staged` stashes unstaged hunks
  // of partially staged files while the tasks run and restores them afterwards, so only what was
  // staged is rewritten and re-staged. Generated output and Markdown are skipped as in `fmt`/`lint`.
  staged: {
    "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc,css,html,yml,yaml}": [
      "vp fmt --no-error-on-unmatched-pattern",
      "vp lint --fix --no-error-on-unmatched-pattern",
    ],
  },
  fmt: {
    printWidth: 100,
    ignorePatterns,
  },
  lint: {
    ignorePatterns,
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    categories: { correctness: "error" },
    options: { typeAware: true, denyWarnings: true, reportUnusedDisableDirectives: "error" },
    rules: {
      eqeqeq: "error",
      "no-empty": "error",
      "no-var": "error",
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "import/no-cycle": "error",
      "typescript/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false },
      ],
      "typescript/no-explicit-any": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-duplicate-type-constituents": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-floating-promises": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/switch-exhaustiveness-check": "error",
      "typescript/no-misused-spread": "error",
      "typescript/no-base-to-string": "error",
      "typescript/restrict-plus-operands": "error",
      // Flags destructured Node module functions and static methods, which do not use `this`.
      "typescript/unbound-method": "off",
    },
    overrides: [
      {
        files: ["**/*.test.{js,mjs,ts,tsx}", "tests/*.e2e.ts"],
        jsPlugins: [{ name: "test-bodies", specifier: "./scripts/lint/test-bodies.mjs" }],
        rules: { "test-bodies/straight-line": "error" },
      },
      {
        files: ["packages/*/src/**", "apps/frontend/src/**"],
        rules: { "import/no-nodejs-modules": "error" },
      },
      {
        files: ["packages/*/src/**"],
        rules: {
          "no-restricted-imports": ["error", { patterns: sharedImportRestrictions }],
          "no-restricted-globals": [
            "error",
            {
              checkGlobalObject: true,
              globals: ["fetch", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage"],
            },
          ],
        },
      },
      {
        files: ["packages/contracts/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                ...sharedImportRestrictions,
                {
                  regex: "(^|/)domain-validation(/|$)",
                  message:
                    "Contracts own shared types; validation depends on contracts, not vice versa.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/frontend/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                privatePackageImports,
                {
                  regex: "(^|/)(backend|desktop)(/|$)",
                  message:
                    "The browser uses shared contracts and its transport, not host implementation.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/backend/src/**"],
        rules: {
          "no-restricted-imports": ["error", { patterns: backendImportRestrictions }],
        },
      },
      {
        files: ["apps/backend/src/runner/**"],
        excludeFiles: ["apps/backend/src/runner/run-store/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                ...backendImportRestrictions,
                {
                  regex: "^effect/sql(/|$)|^@effect/sql",
                  message:
                    "Runner orchestration uses Run store transitions and reads, never the SQL client.",
                },
                {
                  group: ["**/run-store/**", "!**/run-store/run-store.ts"],
                  message:
                    "Runner orchestration imports only the Run store entry, never its internals.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/backend/src/runner/run-store/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                ...backendImportRestrictions,
                {
                  regex: "(^|/)(adapters|t3)/",
                  message:
                    "The Run store never reaches T3: its transactions cannot span a T3 call. Orchestration calls T3.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/backend/test/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  regex: "^@agent-easel/backend(/|$)|(^|/)dist(/|$)",
                  message:
                    "Backend tests import backend modules by relative source path, so one copy of the backend loads.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/desktop/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                privatePackageImports,
                {
                  regex: "(^|/)(backend|frontend)/(src|dist)(/|$)",
                  message: "The desktop hosts the backend through its public package exports.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/*/src/**"],
        rules: { "no-console": "error" },
      },
      {
        // The CLI entry point reports startup status on the terminal.
        files: ["apps/backend/src/main.ts"],
        rules: { "no-console": "off" },
      },
      {
        files: ["apps/frontend/**"],
        plugins: ["react"],
        jsPlugins: [{ name: "react-hooks-js", specifier: "eslint-plugin-react-hooks" }],
        env: { browser: true },
        rules: {
          ...Object.fromEntries(
            Object.keys(reactHooks.configs["recommended-latest"].rules).map((rule) => [
              rule.replace("react-hooks/", "react-hooks-js/"),
              "error" as const,
            ]),
          ),
          "react/jsx-key": "error",
        },
      },
    ],
  },
});
