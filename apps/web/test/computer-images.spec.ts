import { test, expect } from "@playwright/test";
import { DEFAULT_BOT } from "@rex/shared";
import AxeBuilder from "@axe-core/playwright";

const api = "http://127.0.0.1:18787";

test("bot images appear in chat, enlarge, and survive reloading the conversation", async ({ page, request }) => {
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Screenshots" } })).json();
  await page.setContent('<html lang="en"><title>Guest image fixture</title><body style="background:#11100e;color:#ebe7df;font:24px system-ui;padding:48px"><h1>Guest image fixture</h1><p>A saved screenshot shared by the bot.</p></body></html>');
  const png = await page.screenshot();
  const image = await (await request.post(`${api}/uploads`, { multipart: { file: { name: "guest-screen.png", mimeType: "image/png", buffer: png } } })).json();
  const createdAt = new Date().toISOString();
  const user = { id: "fixture-user", conversationId: bot.id, role: "user", content: "Show me what you made", createdAt };
  const photo = { id: "fixture-photo", conversationId: bot.id, role: "assistant", botId: bot.id, botName: bot.bot.name, content: "The project screen", attachments: [image], createdAt };
  const answer = { id: "fixture-answer", conversationId: bot.id, role: "assistant", botId: bot.id, botName: bot.bot.name, content: "Screenshot attached.", createdAt };
  let posted = false;
  await page.route(`${api}/providers`, (route) => route.fulfill({ json: { connections: [], active: { connectionId: "fixture", model: "fixture" } } }));
  await page.route(`${api}/conversations/${bot.id}`, (route) => route.fulfill({ json: { conversation: bot, messages: posted ? [user, photo, answer] : [], busy: false } }));
  await page.route(`${api}/chat`, (route) => {
    posted = true;
    const events = [{ type: "conversation", conversation: bot }, { type: "user_message", message: user }, { type: "speaker", botId: bot.id, botName: bot.bot.name }, { type: "assistant_message", message: photo }, { type: "delta", text: answer.content }, { type: "message_done", messageId: answer.id }, { type: "done" }];
    return route.fulfill({ contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  try {
    await page.goto(`/bot/${bot.id}`);
    await page.getByRole("textbox", { name: "Message Screenshots" }).fill("Show me what you made");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const attachment = page.getByRole("button", { name: "Enlarge guest-screen.png", exact: true });
    await expect(attachment).toBeVisible();
    await expect(attachment.locator("img")).toHaveJSProperty("naturalWidth", 1280);
    await attachment.click();
    await expect(page.getByRole("dialog").getByRole("img", { name: "guest-screen.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(attachment).toHaveCount(1);
    await expect(page.getByText("The project screen", { exact: true })).toBeVisible();
    expect((await attachment.boundingBox())!.width).toBeGreaterThan(400);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: "test-results/bot-shared-image.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await attachment.click();
    await expect(page.getByRole("dialog").getByRole("img", { name: "guest-screen.png" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await request.delete(`${api}/conversations/${bot.id}`);
    await request.delete(`${api}/uploads/${image.id}`);
  }
});
