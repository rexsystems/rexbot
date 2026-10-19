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
