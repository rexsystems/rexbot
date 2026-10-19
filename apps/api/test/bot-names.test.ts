import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_NAMES, suggestBotName } from "@rex/shared";

test("100 default names stay unique until exhausted and repeat evenly afterward", () => {
  assert.equal(BOT_NAMES.length, 100);
  assert.equal(new Set(BOT_NAMES.map((name) => name.toLowerCase())).size, 100);
  const used: string[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const batch = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const name = suggestBotName(used);
      assert.ok(BOT_NAMES.some((candidate) => candidate === name));
      assert.ok(!batch.has(name));
      batch.add(name);
      used.push(name);
    }
    assert.equal(batch.size, 100);
  }
});

test("suggestions account for case, whitespace, custom names, and uneven reuse", () => {
  const allExceptMilo = BOT_NAMES.filter((name) => name !== "Milo").map((name) => ` ${name.toUpperCase()} `);
  assert.equal(suggestBotName([...allExceptMilo, "My custom bot"]), "Milo");
  assert.equal(suggestBotName([...allExceptMilo, ...allExceptMilo, " milo "]), "Milo");
});
