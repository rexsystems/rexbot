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

/** Palette used for new-bot defaults and the color picker swatches. */
export const BOT_COLORS = [
  "#66b8ff", "#f3aa57", "#83cba2", "#b8a3ee", "#eb8ba0", "#e4e0d8",
  "#7ec8c8", "#f0c27f", "#9bb7f0", "#d4a5c9", "#8fd1a8", "#e8b86d",
  "#6ec6a8", "#c9a0dc", "#f2a07b", "#7eb6d9",
] as const;

/** Prefer least-used palette colors among saved bots, then pick randomly among ties. */
export function suggestBotColor(existingColors: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const color of existingColors) {
    const normalized = color.trim().toLowerCase();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const lowestCount = Math.min(...BOT_COLORS.map((color) => counts.get(color.toLowerCase()) ?? 0));
  const candidates = BOT_COLORS.filter((color) => (counts.get(color.toLowerCase()) ?? 0) === lowestCount);
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
