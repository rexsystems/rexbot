export const BOT_NAMES = [
  "Milo", "Luna", "Nova", "Atlas", "Echo", "Pixel", "Orbit", "Cosmo", "Astra", "Niko",
  "Koda", "Mochi", "Pico", "Ziggy", "Remy", "Cleo", "Juno", "Arlo", "Finn", "Theo",
  "Iris", "Sage", "Opal", "Onyx", "Ruby", "Jade", "Pearl", "Amber", "Indigo", "Violet",
  "Cobalt", "Copper", "Flint", "Slate", "Ash", "Ember", "Spark", "Blaze", "Sunny", "Sol",
  "Comet", "Meteor", "Nebula", "Vega", "Sirius", "Lyra", "Orion", "Pluto", "Mars", "Venus",
  "Nimbus", "Cirrus", "Storm", "Breeze", "Frost", "Snow", "Rain", "River", "Brook", "Ocean",
  "Coral", "Reef", "Pebble", "Clover", "Fern", "Moss", "Willow", "Maple", "Cedar", "Aspen",
  "Birch", "Olive", "Basil", "Pepper", "Ginger", "Cocoa", "Mocha", "Latte", "Toffee", "Cookie",
  "Waffle", "Noodle", "Bean", "Kiwi", "Mango", "Peach", "Yuzu", "Boba", "Dobby", "Bingo",
  "Bix", "Dex", "Otto", "Pip", "Toto", "Zuko", "Rumi", "Sora", "Yuki", "Taro",
] as const;

export function suggestBotName(existingNames: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const name of existingNames) {
    const normalized = name.trim().toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const lowestCount = Math.min(...BOT_NAMES.map((name) => counts.get(name.toLowerCase()) ?? 0));
  const candidates = BOT_NAMES.filter((name) => (counts.get(name.toLowerCase()) ?? 0) === lowestCount);
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/** Curated swatches for the color picker only — new bots do not pick from this list. */
export const BOT_COLORS = [
  "#66b8ff", "#f3aa57", "#83cba2", "#b8a3ee", "#eb8ba0", "#e4e0d8",
  "#7ec8c8", "#f0c27f", "#9bb7f0", "#d4a5c9", "#8fd1a8", "#e8b86d",
  "#6ec6a8", "#c9a0dc", "#f2a07b", "#7eb6d9", "#ff6b6b", "#4ecdc4",
  "#ffe66d", "#95e1d3", "#f38181", "#aa96da", "#fcbad3", "#a8d8ea",
  "#ff9a3c", "#2ec4b6", "#e71d36", "#ff9f1c", "#011627", "#fdfffc",
] as const;

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Convert HSL (h in degrees, s/l in 0–1) to #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${[r, g, b].map((channel) => clampByte((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  if (!match) return null;
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

function colorDistance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return Infinity;
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Random vivid hex for a new bot; avoids near-duplicates of colors already in use. */
export function suggestBotColor(existingColors: Iterable<string>): string {
  const used = [...existingColors]
    .map((color) => color.trim().toLowerCase())
    .filter((color) => /^#[a-f\d]{6}$/.test(color));

  const randomCandidate = (): string => {
    const h = Math.random() * 360;
    const s = 0.48 + Math.random() * 0.42; // 48–90%
    const l = 0.42 + Math.random() * 0.28; // 42–70%, readable on dark UI
    return hslToHex(h, s, l);
  };

  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = randomCandidate();
    if (used.every((existing) => colorDistance(candidate, existing) >= 48)) return candidate;
  }
  return randomCandidate();
}
