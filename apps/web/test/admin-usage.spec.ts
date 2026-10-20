import { test, expect } from "@playwright/test";

test("admin abbreviates tokens from one million and exposes exact counts on hover and focus", async ({ page }) => {
  await page.route("**/admin/usage?*", (route) => route.fulfill({ json: {
    days: 30,
    daily: [{ day: "2026-10-21", messages: 2, promptTokens: 1_000_000, completionTokens: 250_000 }],
    byUser: [{ userId: "fixture", name: "Usage fixture", email: "fixture@example.com", messages: 2, promptTokens: 1_000_000, completionTokens: 999_999 }],
    byModel: [{ provider: "custom", model: "fixture", requests: 2, promptTokens: 1_234_567_890, completionTokens: 0 }],
  } }));
  await page.goto("/admin/usage");
  const total = page.locator('span[aria-label="1,250,000 tokens"]');
  await expect(total).toHaveText("1.25M");
  await total.hover();
  await expect(page.getByRole("tooltip")).toHaveText("1,250,000");
  await page.mouse.move(0, 0);
  await total.focus();
  await expect(page.getByRole("tooltip")).toHaveText("1,250,000");
  await expect(page.locator('span[aria-label="1,000,000 tokens"]')).toHaveText("1M");
  await expect(page.getByRole("cell", { name: "999,999", exact: true })).toBeVisible();
  const billions = page.locator('span[aria-label="1,234,567,890 tokens"]');
  await expect(billions).toHaveText("1.23B");
  await billions.hover();
  await expect(page.getByRole("tooltip")).toHaveText("1,234,567,890");
  await page.screenshot({ path: "test-results/admin-token-counts.png" });
});
