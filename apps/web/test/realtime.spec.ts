import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BOT } from "@rex/shared";

const api = "http://127.0.0.1:18787";

test("the composer stays usable while the bot works and new messages steer the live reply", async ({ page, request }) => {
  const received: string[][] = [];
  let finishReply!: () => void;
  const replyReady = new Promise<void>((resolve) => { finishReply = resolve; });
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const messages = body.messages.filter((item: { role: string }) => item.role === "user").map((item: { content: string }) => item.content);
    received.push(messages);
    res.setHeader("Content-Type", "text/event-stream");
    const last = messages.at(-1);
    const content = last === "Use green" ? "Changing the color." : last === "Add a menu too" ? "Green layout and menu ready." : "Starting the layout.";
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    if (last === "Add a menu too") { await replyReady; res.end("data: [DONE]\n\n"); }
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const { connection } = await (await request.post(`${api}/providers/connections`, { data: { provider: "custom", label: "Realtime fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, defaultModel: "fixture" } })).json();
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Realtime" } })).json();
  const other = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Other chat" } })).json();
  try {
    await page.goto(`/bot/${bot.id}`);
    const composer = page.getByRole("textbox", { name: "Message Realtime", exact: true });
    await composer.fill("Build a site");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Starting the layout.", { exact: true })).toBeVisible();
    await expect(composer).toBeEnabled();
    await composer.fill("Use green");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Changing the color.", { exact: true })).toBeVisible();
    await composer.fill("Add a menu too");
    await composer.press("Enter");
    await expect(page.getByText("Green layout and menu ready.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Other chat Your teammate", exact: true }).click();
    await expect(page).toHaveURL(`/bot/${other.id}`);
    finishReply();
    await expect(page.getByText("Green layout and menu ready.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Realtime Your teammate", exact: true }).click();
    await expect(page.getByText("Green layout and menu ready.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Working", { exact: true })).toHaveCount(0);
    expect(received.at(-1)).toEqual(["Build a site", "Use green", "Add a menu too"]);
    await page.reload();
    for (const content of ["Use green", "Add a menu too", "Green layout and menu ready."]) await expect(page.getByText(content, { exact: true })).toHaveCount(1);
    await page.screenshot({ path: "test-results/realtime-chat.png" });
  } finally {
    finishReply();
    await request.delete(`${api}/conversations/${bot.id}`);
    await request.delete(`${api}/conversations/${other.id}`);
    await request.delete(`${api}/providers/connections/${connection.id}`);
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
  }
});
