import { test, expect } from "@playwright/test";
import { DEFAULT_BOT } from "@rex/shared";
import AxeBuilder from "@axe-core/playwright";

const api = "http://127.0.0.1:18787";

test("sidebar context actions target the clicked bot and work with keyboard, groups and mobile", async ({ page, request }) => {
  const bots = [];
  for (const name of ["Menu first", "Menu second"]) bots.push(await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name } })).json());
  const group = await (await request.post(`${api}/groups`, { data: { title: "Menu group", memberIds: bots.map((bot) => bot.id) } })).json();
  try {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`/bot/${bots[0].id}`);
    const second = page.getByRole("button", { name: "Menu second Your teammate", exact: true });
    const secondActions = page.getByRole("button", { name: "Actions for Menu second", exact: true });
    await page.mouse.move(900, 80);
    await expect(secondActions).toHaveCSS("opacity", "0");
    await second.hover();
    await expect(secondActions).toHaveCSS("opacity", "1");
    await expect(second).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await secondActions.hover();
    await expect(secondActions).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await second.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Menu second" });
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL(`/bot/${bots[0].id}`);
    await menu.getByRole("menuitem", { name: "Customize bot" }).click();
    await expect(page.getByRole("textbox", { name: "Bot name" })).toHaveValue("Menu second");
    await page.keyboard.press("Escape");
    await second.focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await second.click();
    await expect(page).toHaveURL(`/bot/${bots[1].id}`);
    await page.getByRole("button", { name: "Menu first Your teammate", exact: true }).hover();
    await page.getByRole("button", { name: "Actions for Menu first", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open chat", exact: true }).click();
    await expect(page).toHaveURL(`/bot/${bots[0].id}`);
    await second.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Open computer" }).click();
    await expect(page).toHaveURL(`/bot/${bots[1].id}`);
    await expect(page.getByRole("dialog", { name: "Rex Computer" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Menu group 2 members", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Group settings" }).click();
    await expect(page.getByRole("dialog", { name: "Group settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Menu group 2 members", exact: true }).hover();
    await page.getByRole("button", { name: "Actions for Menu group", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete group" }).click();
    await expect(page.getByRole("dialog", { name: "Delete group?" })).toContainText("Menu group");
    await page.getByRole("button", { name: "Keep it" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await secondActions.focus();
    await expect(secondActions).toHaveCSS("opacity", "1");
    await secondActions.click();
    await expect(menu).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="menu"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/sidebar-context-mobile.png" });
    await menu.getByRole("menuitem", { name: "Delete conversation" }).click();
    await expect(page.getByRole("dialog", { name: "Delete conversation?" })).toContainText("Menu second");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByRole("dialog", { name: "Delete conversation?" })).not.toBeVisible();
    const conversations = await (await request.get(`${api}/conversations`)).json();
    expect(conversations.some((item: { id: string }) => item.id === bots[1].id)).toBe(false);
    expect(conversations.some((item: { id: string }) => item.id === bots[0].id)).toBe(true);
  } finally {
    await request.delete(`${api}/conversations/${group.id}`).catch(() => undefined);
    for (const bot of bots) await request.delete(`${api}/conversations/${bot.id}`).catch(() => undefined);
  }
});

test("touch devices expose transparent sidebar actions without hover", async ({ browser, page, request }) => {
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Touch menu" } })).json();
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const touch = await context.newPage();
    await touch.goto(`http://127.0.0.1:15173/bot/${bot.id}`);
    await touch.getByRole("button", { name: "Menu", exact: true }).tap();
    const actions = touch.getByRole("button", { name: "Actions for Touch menu", exact: true });
    await expect(actions).toHaveCSS("opacity", "1");
    await expect(actions).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await actions.tap();
    await expect(touch.getByRole("menu", { name: "Actions for Touch menu" })).toBeVisible();
    await touch.screenshot({ path: "test-results/sidebar-touch-menu.png" });
  } finally {
    await context.close();
    await request.delete(`${api}/conversations/${bot.id}`);
  }
});
