import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BOT } from "@rex/shared";
import AxeBuilder from "@axe-core/playwright";

const api = "http://127.0.0.1:18787";

test("computer resize, owner control and memory settings work on desktop and mobile", async ({ page, request }) => {
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Controls" } })).json();
  let memories = [{ id: "one", content: "Prefers Romanian", createdAt: new Date().toISOString() }, { id: "two", content: "Works on Linux", createdAt: new Date().toISOString() }];
  const actions: string[] = [];
  await page.route(`${api}/computer`, (route) => route.fulfill({ json: { desktop: true, available: true, running: true, vmState: "running" } }));
  await page.route(`${api}/computer/session/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") { actions.push(path.split("/").at(-1)!); return route.fulfill({ json: { botId: bot.id, locked: false } }); }
    return route.fulfill({ json: { botId: bot.id, width: 1280, height: 800, viewPath: "/computer/vnc/fixture/vnc_lite.html?view_only=1" } });
  });
  await page.route(`${api}/computer/vnc/**`, (route) => route.fulfill({ contentType: "text/html", body: '<label>Desktop input<input aria-label="Desktop input"></label>' }));
  await page.route(`${api}/memories`, (route) => route.fulfill({ json: memories }));
  await page.route(`${api}/memories/*`, (route) => { memories = memories.filter((item) => !route.request().url().endsWith(item.id)); return route.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`/bot/${bot.id}`);
  const separator = page.getByRole("separator", { name: "Resize computer panel" });
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "600");
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(1050, box.y + 180);
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "390");
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", "390");
  const screen = page.locator('.computer-screen iframe');
  await expect(screen).toHaveAttribute("src", /view_only=1/);
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(screen).toHaveAttribute("src", /view_only=0/);
  await page.frameLocator('.computer-screen iframe').getByLabel("Desktop input").fill("Owner typing");
  await expect(page.frameLocator('.computer-screen iframe').getByLabel("Desktop input")).toHaveValue("Owner typing");
  await page.getByRole("button", { name: "Enlarge screen" }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute("src", /view_only=0/);
  await page.getByRole("dialog").getByRole("button", { name: "Return control" }).click();
  await page.keyboard.press("Escape");
  await expect(screen).toHaveAttribute("src", /view_only=1/);
  expect(actions).toContain("take-control");
  expect(actions).toContain("release-control");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Memory/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page.getByLabel("Search memories").fill("Romanian");
  await expect(page.getByText("Works on Linux", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete memory: Prefers Romanian" }).click();
  await expect(page.getByText("No memories match your search.")).toBeVisible();
  await page.getByLabel("Search memories").fill("");
  await expect(page.getByText("Works on Linux", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/memory-settings.png" });
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close computer", exact: true }).click();
  await page.getByRole("button", { name: "Toggle computer drawer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(page.getByRole("button", { name: "Return control", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/computer-controls-mobile.png" });
  await page.getByRole("button", { name: "Close computer", exact: true }).click();
  await request.delete(`${api}/conversations/${bot.id}`);
});

test("reload follows server work and routines execute through their saved provider", async ({ page, request }) => {
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const user = body.messages.filter((item: { role: string }) => item.role === "user").at(-1).content;
    if (user === "Wait for reload") await waiting;
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: user === "Wait for reload" ? "Work survived reload." : "Routine completed." } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const connection = await (await request.post(`${api}/providers/connections`, { data: { provider: "custom", label: "Routine fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, defaultModel: "fixture" } })).json();
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Reload" } })).json();
  try {
    await page.goto(`/bot/${bot.id}`);
    await page.getByRole("textbox", { name: "Message Reload" }).fill("Wait for reload");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${api}/conversations/${bot.id}`)).json()).busy).toBe(true);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Working…" })).toBeVisible();
    finish!();
    await expect(page.getByText("Work survived reload.", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Working…" })).toHaveCount(0);
    await page.getByRole("button", { name: "Routines", exact: true }).click();
    await page.getByRole("button", { name: "New routine", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Hourly check");
    await page.getByLabel("What to do", { exact: true }).fill("Check status");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    await expect(page.getByText(/^Ran /)).toBeVisible();
    await page.getByRole("switch", { name: "Pause Hourly check" }).click();
    await expect(page.getByRole("switch", { name: "Resume Hourly check" })).toBeVisible();
    await page.getByRole("switch", { name: "Resume Hourly check" }).click();
    await page.getByRole("button", { name: "Close routines" }).click();
    await expect(page.getByText("Routine completed.", { exact: true })).toBeVisible();
  } finally {
    finish!();
    await request.delete(`${api}/conversations/${bot.id}`);
    await request.delete(`${api}/providers/connections/${connection.connection.id}`);
    await new Promise<void>((resolve) => model.close(() => resolve()));
  }
});
