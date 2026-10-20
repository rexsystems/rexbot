import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("saved address, connection errors and retry work without collecting credentials", async ({ page }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      if (command === "saved_website") return "https://rex.example.com";
      window.__connectionArgs = args;
      if (attempts++ === 0) throw "Could not reach the website securely.";
    } } };
  });
  await page.goto("/");
  await expect(page.getByLabel("Website address")).toHaveValue("https://rex.example.com");
  await page.getByRole("button", { name: "Connect to website" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not reach the website securely.");
  await page.getByRole("button", { name: "Connect to website" }).click();
  await expect(page.getByRole("status")).toContainText("Connected.");
  expect(await page.evaluate(() => window.__connectionArgs)).toEqual({ address: "https://rex.example.com" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 360, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/desktop-connection.png", fullPage: true });
});

test("browser preview explains that the native connection app is needed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Rex desktop app");
  await expect(page.getByRole("button", { name: "Connect to website" })).toBeDisabled();
});
