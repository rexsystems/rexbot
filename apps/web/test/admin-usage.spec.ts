import { test, expect } from "@playwright/test";

test("admin abbreviates tokens from one million and exposes exact counts on hover and focus", async ({ page }) => {
  await page.route("**/admin/usage?*", (route) => route.fulfill({ json: {
    days: 30,
    daily: [{ day: "2026-10-21", requests: 2, toolCalls: 4, cacheReadTokens: 800000, cacheWriteTokens: null, reasoningTokens: 120, cacheReportedRequests: 1, messages: 2, promptTokens: 1_000_000, completionTokens: 250_000 }],
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
  await expect(page.getByText("800,000", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cache read reported on 1 of 2 requests/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Close menu" })).not.toBeInViewport();
  await page.mouse.move(0, 0);
  await page.locator("body").click({ position: { x: 380, y: 80 } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/admin-token-counts.png" });
});

test("changing usage periods ignores a slower previous response", async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/admin/usage?*", async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days"));
    if (days === 7) await waiting;
    await route.fulfill({ json: { days, daily: [], byUser: [], byModel: [] } });
  });
  await page.goto("/admin/usage");
  await expect(page.getByText("Yours and the bots', last 30 days")).toBeVisible();
  await page.getByText("7 days", { exact: true }).click();
  await page.getByText("90 days", { exact: true }).click();
  await expect(page.getByText("Yours and the bots', last 90 days")).toBeVisible();
  release();
  await expect(page.getByText("Yours and the bots', last 90 days")).toBeVisible();
});
