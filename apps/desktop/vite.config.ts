import "vite-plus/test/config";
import { fileURLToPath } from "node:url";
import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/bundle.mjs",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: {
          input: [{ auto: true }, "!build/**"],
          output: ["build/**"],
        },
      },
    },
  },
  // This config serves only the rule tests; the shipped bundle comes from
  // scripts/bundle.mjs, which resolves compiled workspace output.
  ssr: { resolve: { conditions: ["factory-source", ...defaultServerConditions] } },
  test: {
    environment: "node",
    include: ["test/*.test.ts"],
    // Parallel workspace runners must not clear or write each other's module cache.
    fsModuleCachePath: fileURLToPath(new URL("./node_modules/.vitest-cache", import.meta.url)),
  },
});
