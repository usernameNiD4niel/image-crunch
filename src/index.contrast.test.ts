import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The palette's own guard rail. Every `--ink-NN` tier is a TEXT colour —
 * row indices, the passthrough dash, the drop-zone limits, the editorial
 * numbers — so each one must clear WCAG AA for body text (4.5:1) against
 * both paper surfaces. Tokens that are deliberately not text (`--rule`,
 * hairlines) are named differently and are not checked here.
 *
 * This is a CSS-level fact, invisible to component tests: --ink-58 rendered
 * at 2.5:1 for the whole redesign and nothing caught it.
 */
const AA_BODY_TEXT = 4.5;

// Vitest runs with the project root as cwd; import.meta.url is a served
// http URL under Vite's transform, not a file path.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function token(name: string): string {
  const declaration = css
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`--${name}:`));
  if (!declaration) throw new Error(`token --${name} not found in index.css`);
  return declaration.slice(name.length + 3, declaration.indexOf(";")).trim();
}

function parseOklch(value: string): { l: number; c: number; h: number; alpha: number } {
  const match = value.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\s*\)/,
  );
  if (!match) throw new Error(`not an oklch() colour: ${value}`);
  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]) / 100,
  };
}

/** oklch -> linear sRGB -> gamma-encoded sRGB, the space CSS composites in. */
function srgb({ l: L, c: C, h: hDeg }: { l: number; c: number; h: number }): number[] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const lc = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  });
}

function luminance(color: number[]): number {
  const [r, g, b] = color.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: number[], bg: number[]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function composite(fg: number[], bg: number[], alpha: number): number[] {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
}

const inkTiers = [...css.matchAll(/--(ink-\d+):\s*([^;]+);/g)].map(([, name, value]) => ({
  name,
  ...parseOklch(value),
}));

const ink = srgb(parseOklch(token("ink")));
const surfaces = ["paper", "paper-2"].map((name) => ({ name, color: srgb(parseOklch(token(name))) }));

describe("ink tiers", () => {
  it("defines at least two muted tiers", () => {
    expect(inkTiers.length).toBeGreaterThanOrEqual(2);
  });

  for (const tier of inkTiers) {
    for (const surface of surfaces) {
      it(`--${tier.name} reads at AA on --${surface.name}`, () => {
        const ratio = contrast(composite(ink, surface.color, tier.alpha), surface.color);
        expect(ratio).toBeGreaterThanOrEqual(AA_BODY_TEXT);
      });
    }
  }

  it("keeps the tiers visibly distinct from each other and from solid ink", () => {
    const alphas = [...inkTiers.map((t) => t.alpha), 1].sort((a, b) => a - b);
    for (let i = 1; i < alphas.length; i += 1) {
      expect(alphas[i] - alphas[i - 1]).toBeGreaterThanOrEqual(0.1);
    }
  });
});
