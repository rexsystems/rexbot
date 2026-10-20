import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BOT } from "@rex/shared";
import AxeBuilder from "@axe-core/playwright";
const api = "http://127.0.0.1:18787";

test("question cards survive reload, accept custom answers and continue the bot on mobile", async ({ page, request }) => {
  const model = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const answered = body.messages.some((message: any) => message.role === "user" && message.content.includes("My own layout"));
    const delta = answered ? { content: "I will use your own layout." } : { tool_calls: [{ index: 0, id: "questions", function: { name: "ask_user", arguments: JSON.stringify({ questions: [{ question: "What should match the reference?", options: ["Visual style", "Product functionality"] }] }) } }] };
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const { connection } = await (await request.post(`${api}/providers/connections`, { data: { provider: "custom", label: "Questions fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, defaultModel: "fixture" } })).json();
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Questions" } })).json();
  try {
    await page.goto(`/bot/${bot.id}`);
    expect(await page.locator('.thread-scroll').evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
    await page.getByRole("textbox", { name: "Message Questions", exact: true }).fill("Make it like the reference");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Answer question", exact: true })).toBeVisible();
    await expect(page.getByLabel("Working", { exact: true })).toHaveCount(0);
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Answer question", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Answer questions", exact: true });
    await expect(dialog.getByRole("button", { name: "Send answers" })).toBeDisabled();
    await dialog.getByRole("radio", { name: "Write my own answer", exact: true }).check();
    await dialog.getByRole("textbox", { name: "Your answer: What should match the reference?", exact: true }).fill("My own layout");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/chat-questions-mobile.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Answer question", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Your answer: What should match the reference?", exact: true })).toHaveValue("My own layout");
    let failAnswer = true;
    await page.route(`${api}/questions/*/answer`, (route) => {
      if (failAnswer) { failAnswer = false; return route.fulfill({ status: 503, json: { error: "Temporary answer failure" } }); }
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Send answers" }).click();
    await expect(dialog.getByText(/Temporary answer failure/)).toBeVisible();
    await dialog.getByRole("button", { name: "Send answers" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("I will use your own layout.", { exact: true })).toBeVisible();
    await expect(page.getByText("Answered", { exact: true })).toBeVisible();
  } finally {
    await request.delete(`${api}/conversations/${bot.id}`);
    await request.delete(`${api}/providers/connections/${connection.id}`);
    model.closeAllConnections(); await new Promise<void>((resolve) => model.close(() => resolve()));
  }
});
