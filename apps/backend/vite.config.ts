import "vite-plus/test/config";
import { fileURLToPath } from "node:url";
import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      typecheck: {
        command: "true",
        dependsOn: ["typecheck:src", "typecheck:test"],
        cache: false,
      },
      build: {
        command: "tsc -p tsconfig.build.json && node ../../scripts/copy-migrations.mjs",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: {
          input: [{ auto: true }, "!dist/**"],
          output: ["dist/**"],
        },
      },
    },
  },
  // Tests run the shared packages from source, so a result reflects the working tree.
  ssr: { resolve: { conditions: ["factory-source", ...defaultServerConditions] } },
  test: {
    environment: "node",
    include: ["test/*.test.ts"],
    // Parallel workspace runners must not clear or write each other's module cache.
    fsModuleCachePath: fileURLToPath(new URL("./node_modules/.vitest-cache", import.meta.url)),
    pool: "forks",
    isolate: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    restoreMocks: true,
  },
});
