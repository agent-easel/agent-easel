import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";

const rootManifest: unknown = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const publishedReleaseVersion = process.env.FACTORY_RELEASE_VERSION?.trim();
if (process.env.VERCEL && !publishedReleaseVersion) {
  throw new Error("A Vercel build needs FACTORY_RELEASE_VERSION, the latest published Release.");
}
const version =
  publishedReleaseVersion ||
  (typeof rootManifest === "object" && rootManifest !== null && "version" in rootManifest
    ? String(rootManifest.version)
    : "");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unexpected product version "${version}".`);

const siteUrl = new URL(
  process.env.FACTORY_SITE_URL?.trim() || "https://agenteasel.app/",
).href.replace(/\/?$/, "/");

const placeholders: Record<string, string> = {
  "%FACTORY_VERSION%": version,
  "%SITE_URL%": siteUrl,
};
const fill = (source: string) =>
  source.replace(/%(FACTORY_VERSION|SITE_URL)%/g, (token) => placeholders[token] ?? token);

const sitePlaceholders = (): Plugin => ({
  name: "factory-landing-site",
  transformIndexHtml: fill,
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "robots.txt",
      source: fill("User-agent: *\nAllow: /\nSitemap: %SITE_URL%sitemap.xml\n"),
    });
    this.emitFile({
      type: "asset",
      fileName: "sitemap.xml",
      source: fill(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>%SITE_URL%</loc></url>\n</urlset>\n',
      ),
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), sitePlaceholders()],
});
