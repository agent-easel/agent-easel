import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

await test("Vercel never deploys from Git and the old domain redirects every path", () => {
  // Arrange
  const file = new URL("../vercel.json", import.meta.url);

  // Act
  const config = JSON.parse(readFileSync(file, "utf8"));

  // Assert
  assert.equal(config.git.deploymentEnabled, false);
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

await test("a Vercel build links the published Release it is given, not the root manifest version", (context) => {
  // Arrange
  const version = "9.8.7";

  // Act
  const output = buildLanding(context, {
    VERCEL: "1",
    FACTORY_RELEASE_VERSION: version,
    FACTORY_SITE_URL: "https://agenteasel.app/",
  });

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
  assert.ok(html.includes(`/releases/download/v${version}/SHA256SUMS.txt`));
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

await test("a Vercel build without a published Release version fails instead of linking a draft", (context) => {
  // Arrange
  const env = { VERCEL: "1", FACTORY_RELEASE_VERSION: "" };

  // Act
  const build = () => buildLanding(context, env);

  // Assert
  assert.throws(build);
});

await test("the built hero screenshot exists and its declared dimensions match the PNG", (context) => {
  // Arrange
  const env = { FACTORY_SITE_URL: "" };

  // Act
  const output = buildLanding(context, env);

  // Assert
  const html = readFileSync(join(output, "index.html"), "utf8");
  const hero = html.match(
    /<img\s+src="\.\/screens\/run-detail\.png"\s+width="(\d+)"\s+height="(\d+)"/,
  );
  assert.ok(hero);
  const png = readFileSync(join(output, "screens/run-detail.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(Number(hero[1]), png.readUInt32BE(16));
  assert.equal(Number(hero[2]), png.readUInt32BE(20));
});
