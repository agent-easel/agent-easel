import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const GUTTER = 8;
const MAX_SHEET_WIDTH = 1800;
const GUTTER_COLOR = [128, 128, 128, 255];

// pixelmatch's colour-distance threshold. Identical builds can differ by a few 1/255 steps of
// compositing dither (6 at most, measured) and must read as unchanged, while a 1px border moved
// by 12/255 or a changed label must not. 0.05 flags a grey step of about 13/255 or more.
const PIXEL_THRESHOLD = 0.05;

const byName = (a, b) => a.localeCompare(b);

function listPngs(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listPngs(root, path);
    return entry.name.toLowerCase().endsWith(".png") ? [relative(root, path)] : [];
  });
}

function pad(png, width, height) {
  if (png.width === width && png.height === height) return png.data;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < png.height; y++) {
    png.data.copy(out, y * width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return out;
}

/** Pixel-diffs two same-named images after padding both to a common canvas. */
export function compareImages(beforePng, afterPng) {
  const width = Math.max(beforePng.width, afterPng.width);
  const height = Math.max(beforePng.height, afterPng.height);
  const before = pad(beforePng, width, height);
  const after = pad(afterPng, width, height);
  const diff = Buffer.alloc(width * height * 4);
  const changedPixels = pixelmatch(before, after, diff, width, height, {
    threshold: PIXEL_THRESHOLD,
  });
  return { width, height, before, after, diff, changedPixels };
}

function sheetOf({ width, height, before, after, diff }) {
  const sheetWidth = width * 3 + GUTTER * 2;
  const sheet = new PNG({ width: sheetWidth, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < sheetWidth; x++) sheet.data.set(GUTTER_COLOR, (y * sheetWidth + x) * 4);
    [before, after, diff].forEach((panel, index) => {
      panel.copy(
        sheet.data,
        (y * sheetWidth + index * (width + GUTTER)) * 4,
        y * width * 4,
        (y + 1) * width * 4,
      );
    });
  }
  return sheet.width <= MAX_SHEET_WIDTH ? sheet : downscale(sheet, MAX_SHEET_WIDTH / sheet.width);
}

// Box average keeps thin diff highlights visible, unlike nearest-neighbour sampling.
function downscale(source, factor) {
  const width = Math.max(1, Math.round(source.width * factor));
  const height = Math.max(1, Math.round(source.height * factor));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / factor);
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) / factor)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / factor);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) / factor)));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          for (let c = 0; c < 4; c++) sum[c] += source.data[(sy * source.width + sx) * 4 + c];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      out.data.set(
        sum.map((value) => Math.round(value / count)),
        (y * width + x) * 4,
      );
    }
  }
  return out;
}

/** Writes one before | after | diff sheet per changed view and returns the text summary. */
export function buildEvidenceDiff(beforeDir, afterDir, outDir) {
  const beforeViews = new Set(listPngs(beforeDir));
  const afterViews = new Set(listPngs(afterDir));
  const changed = [];
  const unchanged = [];
  rmSync(outDir, { recursive: true, force: true });
  for (const view of [...beforeViews].filter((name) => afterViews.has(name)).sort(byName)) {
    const result = compareImages(
      PNG.sync.read(readFileSync(join(beforeDir, view))),
      PNG.sync.read(readFileSync(join(afterDir, view))),
    );
    if (result.changedPixels === 0) {
      unchanged.push(view);
      continue;
    }
    const sheetPath = join(outDir, view);
    mkdirSync(dirname(sheetPath), { recursive: true });
    writeFileSync(sheetPath, PNG.sync.write(sheetOf(result)));
    const percent = (result.changedPixels / (result.width * result.height)) * 100;
    changed.push({ view, percent, sheetPath });
  }
  const onlyBefore = [...beforeViews].filter((name) => !afterViews.has(name)).sort(byName);
  const onlyAfter = [...afterViews].filter((name) => !beforeViews.has(name)).sort(byName);

  const lines = [
    `Evidence diff: ${changed.length} changed, ${unchanged.length} unchanged, ${onlyBefore.length + onlyAfter.length} unpaired`,
    "Contact sheets are before | after | diff; read each changed sheet once, after the final build.",
    "",
    "Changed:",
    ...changed.map(
      ({ view, percent, sheetPath }) => `  ${percent.toFixed(2)}%  ${view}  ${sheetPath}`,
    ),
    "Unchanged (no image to read):",
    ...unchanged.map((view) => `  ${view}`),
    "Unpaired (read the raw PNG):",
    ...onlyBefore.map((view) => `  only in before: ${view}`),
    ...onlyAfter.map((view) => `  only in after: ${view}`),
  ];
  const summary = lines.join("\n");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "summary.txt"), `${summary}\n`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [beforeDir, afterDir, outArg] = process.argv.slice(2);
  if (!beforeDir || !afterDir) {
    console.error("Usage: pnpm e2e:evidence-diff <before-dir> <after-dir> [out-dir]");
    process.exit(2);
  }
  // Default beside the sets: .e2e/proof/<change>/before + after -> .e2e/proof/<change>/contact-sheets.
  const out = resolve(outArg ?? join(dirname(resolve(beforeDir)), "contact-sheets"));
  console.log(buildEvidenceDiff(resolve(beforeDir), resolve(afterDir), out));
}
