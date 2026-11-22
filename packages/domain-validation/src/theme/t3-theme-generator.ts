import { linearFromOklch, toOklch, type Oklch } from "./color.ts";

interface Rgb255 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = new RegExp(
  String.raw`^rgba?\(\s*(${NUMBER})(?:\s*,\s*|\s+)(${NUMBER})(?:\s*,\s*|\s+)(${NUMBER})(?:\s*[,/]\s*(${NUMBER}%?))?\s*\)$`,
  "i",
);
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER}%?)\s+(${NUMBER}%?)\s+(${NUMBER})(?:deg)?(?:\s*/\s*(${NUMBER}%?))?\s*\)$`,
  "i",
);

const scaled = (text: string, whole: number) =>
  text.endsWith("%") ? (Number.parseFloat(text) / 100) * whole : Number.parseFloat(text);
const unit = (value: number) => Math.min(1, Math.max(0, value));

const fromRgb = (r: number, g: number, b: number) =>
  toOklch({ r: r / 255, g: g / 255, b: b / 255 });

function parseHex(digits: string) {
  const size = digits.length <= 4 ? 1 : 2;
  const channels = Array.from({ length: digits.length / size }, (_, index) => {
    const part = digits.slice(index * size, (index + 1) * size);
    return Number.parseInt(size === 1 ? part + part : part, 16);
  }) as [number, number, number, number?];
  const [r, g, b, a = 255] = channels;
  return { color: fromRgb(r, g, b), alpha: a / 255 };
}

function parseRgb([, r, g, b, a]: RegExpExecArray) {
  const channels = [r!, g!, b!].map(Number.parseFloat) as [number, number, number];
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return { color: fromRgb(...channels), alpha: a === undefined ? 1 : unit(scaled(a, 1)) };
}

function parseOklch([, l, c, h, a]: RegExpExecArray) {
  return {
    color: { l: unit(scaled(l!, 1)), c: Math.max(0, scaled(c!, 0.4)), h: Number.parseFloat(h!) },
    alpha: a === undefined ? 1 : unit(scaled(a, 1)),
  };
}

function parseThemeColor(text: string): { color: Oklch; alpha: number } | null {
  const input = text.trim();
  const hex = HEX.exec(input);
  if (hex) return parseHex(hex[1]!);
  const rgb = RGB.exec(input);
  if (rgb) return parseRgb(rgb);
  const oklch = OKLCH.exec(input);
  return oklch ? parseOklch(oklch) : null;
}

function formatNumber(value: number, precision: number) {
  const rounded = Math.abs(value) < 10 ** -precision / 2 ? 0 : value;
  return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
}

function formatThemeColor(color: Oklch, alpha = 1) {
  const hue = color.c < 0.0000005 ? 0 : ((color.h % 360) + 360) % 360;
  const body = `${formatNumber(color.l, 6)} ${formatNumber(color.c, 6)} ${formatNumber(hue, 3)}`;
  return alpha < 1 ? `oklch(${body} / ${formatNumber(alpha, 4)})` : `oklch(${body})`;
}

export function canonicalThemeColor(text: string) {
  const parsed = parseThemeColor(text);
  return parsed && formatThemeColor(parsed.color, parsed.alpha);
}

function toGamut(color: Oklch): Oklch {
  const inGamut = (c: number) =>
    linearFromOklch({ ...color, c }).every((channel) => channel >= -0.0001 && channel <= 1.0001);
  if (inGamut(color.c)) return color;
  let [low, high] = [0, color.c];
  const resolution = 0.000001;
  const steps = Math.max(
    1,
    Math.ceil(Math.log2(Math.max(color.c, resolution)) - Math.log2(resolution)),
  );
  for (let step = 0; step < steps; step++) {
    const mid = (low + high) / 2;
    if (inGamut(mid)) low = mid;
    else high = mid;
  }
  return { ...color, c: low };
}

function toRgb255(color: Oklch): Rgb255 {
  const [r, g, b] = linearFromOklch(toGamut(color)).map((channel) => {
    const gamma = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.round(unit(gamma) * 255);
  });
  return { r: r!, g: g!, b: b! };
}

const oklchText = (color: Oklch) => formatThemeColor(toGamut(color));
const rgbText = ({ r, g, b }: Rgb255) => formatThemeColor(fromRgb(r, g, b));

function luminance({ r, g, b }: Rgb255) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(first: Rgb255, second: Rgb255) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function solveLightness(base: Oklch, surface: Rgb255, minimum: number, lighter: boolean): Oklch {
  const reaches = (color: Oklch) => contrast(toRgb255(color), surface) >= minimum;
  if (reaches(base)) return base;
  let [low, high] = lighter ? [base.l, 1] : [0, base.l];
  for (let step = 0; step < 18; step++) {
    const mid = (low + high) / 2;
    if (reaches({ ...base, l: mid }) === lighter) high = mid;
    else low = mid;
  }
  return { ...base, l: lighter ? high : low };
}

const blend = (from: Rgb255, to: Rgb255, amount: number): Rgb255 => ({
  r: from.r + (to.r - from.r) * amount,
  g: from.g + (to.g - from.g) * amount,
  b: from.b + (to.b - from.b) * amount,
});

function softenedText(background: Rgb255, foreground: Rgb255, minimum: number): Rgb255 {
  let readable = foreground;
  let [lower, upper] = [0, 1];
  for (let step = 0; step < 12; step++) {
    const amount = (lower + upper) / 2;
    const candidate = blend(foreground, background, amount);
    if (contrast(candidate, background) >= minimum) {
      readable = candidate;
      lower = amount;
    } else upper = amount;
  }
  return readable;
}

const LIGHT_FOREGROUND: Rgb255 = { r: 255, g: 250, b: 255 };
const DARK_FOREGROUND: Rgb255 = { r: 36, g: 21, b: 35 };
const WHITE: Rgb255 = { r: 255, g: 255, b: 255 };
const BLACK: Rgb255 = { r: 0, g: 0, b: 0 };

function readableForeground(background: Rgb255): Rgb255 {
  const light = contrast(background, LIGHT_FOREGROUND);
  const dark = contrast(background, DARK_FOREGROUND);
  if (Math.max(light, dark) >= 4.5) return light >= dark ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  return contrast(background, WHITE) >= contrast(background, BLACK) ? WHITE : BLACK;
}

export function generateSeedColors(canvasSeed: string, accentSeed: string) {
  const canvasRgb = toRgb255(parseThemeColor(canvasSeed)!.color);
  const accentRgb = toRgb255(parseThemeColor(accentSeed)!.color);
  const canvas = fromRgb(canvasRgb.r, canvasRgb.g, canvasRgb.b);
  const accent = fromRgb(accentRgb.r, accentRgb.g, accentRgb.b);

  const dark = luminance(canvasRgb) < 0.179;
  const hue = accent.c < 0.02 ? canvas.h : accent.h;
  const tint = Math.min(0.045, Math.max(0.008, accent.c * 0.22));
  const surfaceAt = (delta: number, chroma = tint): Oklch => ({
    l: Math.min(0.98, Math.max(0.05, canvas.l + (dark ? delta : -delta))),
    c: chroma,
    h: hue,
  });
  const textBase: Oklch = { l: dark ? 0.95 : 0.2, c: Math.min(0.035, accent.c * 0.25), h: hue };
  const textRgb = toRgb255(solveLightness(textBase, canvasRgb, 7, dark));
  const surfaceRaised = surfaceAt(0.05);
  const sidebar = surfaceAt(0.045, tint * 1.4);
  const accentText = rgbText(accentRgb);
  return {
    canvas: rgbText(canvasRgb),
    text: rgbText(textRgb),
    textMuted: rgbText(softenedText(canvasRgb, textRgb, dark ? 5.082 : 4.705)),
    placeholder: rgbText(softenedText(toRgb255(surfaceRaised), textRgb, 4.6)),
    surfaceRaised: oklchText(surfaceRaised),
    border: oklchText(surfaceAt(dark ? 0.16 : 0.12, Math.min(0.07, accent.c * 0.35))),
    input: oklchText(surfaceAt(dark ? 0.21 : 0.16, Math.min(0.08, accent.c * 0.4))),
    focus: accentText,
    accent: accentText,
    accentForeground: rgbText(readableForeground(accentRgb)),
    sidebar: oklchText(sidebar),
    sidebarForeground: oklchText(solveLightness(textBase, toRgb255(sidebar), 4.6, dark)),
  };
}
