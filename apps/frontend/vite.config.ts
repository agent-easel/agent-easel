import "vite-plus/test/config";
import type { ClientRequest, IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { defaultServerConditions, defineConfig } from "vite-plus";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { uiBuildSignature, uiBuildSignatureFile } from "../../scripts/ui-build.ts";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ panicThreshold: "all_errors" })] }),
    tailwindcss(),
    {
      name: "factory-ui-build-inputs",
      apply: "build",
      buildStart() {
        // Record before compilation; an input edited during the build must invalidate it.
        this.emitFile({
          type: "asset",
          fileName: uiBuildSignatureFile,
          source: uiBuildSignature(fileURLToPath(new URL("../../", import.meta.url))),
        });
      },
    },
  ],
  resolve: {
    ...(command === "serve"
      ? { conditions: ["factory-source", "module", "browser", "development"] }
      : {}),
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Only Node-run tests use SSR resolution; the shipped UI is a client build, so this
  // reaches no shipping output.
  ssr: { resolve: { conditions: ["factory-source", ...defaultServerConditions] } },
  test: {
    environment: "node",
    include: ["test/*.test.ts"],
    isolate: false,
    // Parallel workspace runners must not clear or write each other's module cache.
    fsModuleCachePath: fileURLToPath(new URL("./node_modules/.vitest-cache", import.meta.url)),
  },
  server: {
    host: process.env.FACTORY_DEV_HOST?.trim() || "127.0.0.1",
    proxy: {
      "/api": {
        target: process.env.FACTORY_DEV_BACKEND_URL ?? "http://127.0.0.1:4310",
        changeOrigin: true,
        // The live connection upgrades `/api/live` to a WebSocket.
        ws: true,
        configure(proxy) {
          // Translate only the development UI's own Origin. Cross-site origins must still fail
          // the backend mutation guard and the live upgrade's Origin admission.
          const translateOrigin = (outgoing: ClientRequest, incoming: IncomingMessage) => {
            if (incoming.headers.origin === `http://${incoming.headers.host}`)
              outgoing.setHeader("origin", `http://${String(outgoing.getHeader("host"))}`);
          };
          proxy.on("proxyReq", translateOrigin);
          proxy.on("proxyReqWs", translateOrigin);
        },
      },
    },
  },
}));
