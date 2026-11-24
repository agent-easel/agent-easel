import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

await test("Git deployment is limited to main and the old domain redirects every path", () => {
  // Arrange
  const file = new URL("../vercel.json", import.meta.url);

  // Act
  const config = JSON.parse(readFileSync(file, "utf8"));

  // Assert
  assert.deepEqual(config.git.deploymentEnabled, { main: true, "*": false, "**": false });
  assert.deepEqual(config.redirects, [
    {
      source: "/:path*",
      has: [{ type: "host", value: "t3factory.app" }],
      destination: "https://agenteasel.app/:path*",
      permanent: true,
    },
  ]);
  assert.equal(config.rewrites, undefined);
});

function buildLanding(context, env) {
  const output = mkdtempSync(join(tmpdir(), "factory-landing-"));
  context.after(() => rmSync(output, { recursive: true, force: true }));
  execFileSync("pnpm", ["build", "--outDir", output, "--emptyOutDir"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ...env },
  });
  return output;
}

await test("the production canonical URL and root Release download appear in built assets", (context) => {
  // Arrange
  const { version } = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  );

  // Act
  const output = buildLanding(context, { FACTORY_SITE_URL: "https://agenteasel.app/" });

  // Assert
  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.ok(html.includes('<link rel="canonical" href="https://agenteasel.app/"'));
  assert.ok(html.includes('<meta property="og:url" content="https://agenteasel.app/"'));
  assert.ok(
    html.includes('<meta property="og:image" content="https://agenteasel.app/og-image.png"'),
  );
  assert.ok(
    html.includes('<meta name="twitter:image" content="https://agenteasel.app/og-image.png"'),
  );
  assert.ok(html.includes(`/releases/download/v${version}/AgentEasel-${version}-arm64.dmg`));
  assert.ok(
    readFileSync(join(output, "robots.txt"), "utf8").includes(
      "Sitemap: https://agenteasel.app/sitemap.xml",
    ),
  );
  assert.ok(
    readFileSync(join(output, "sitemap.xml"), "utf8").includes(
      "<loc>https://agenteasel.app/</loc>",
    ),
  );
});

await test("a build without a site URL uses the production domain", (context) => {
  // Arrange
  const env = { FACTORY_SITE_URL: "" };

  // Act
  const output = buildLanding(context, env);

  // Assert
  assert.ok(
    readFileSync(join(output, "index.html"), "utf8").includes(
      '<link rel="canonical" href="https://agenteasel.app/"',
    ),
  );
});
