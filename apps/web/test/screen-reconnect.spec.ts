import { test, expect } from "@playwright/test";
import { DEFAULT_BOT } from "@rex/shared";
import { proxyVncHttp } from "../../api/src/computer/vncProxy.js";

const api = "http://127.0.0.1:18787";
const token = "reconnect-screen-token-1234";

test("expired screen links and dropped connections reconnect in place with a fresh session", async ({ page, request }) => {
  const bot = await (await request.post(`${api}/bots`, { data: { ...DEFAULT_BOT, name: "Reconnect" } })).json();
  let sessions = 0;
  let expired = true;
  let failNext = false;
  await page.route(`${api}/computer`, (route) => route.fulfill({ json: { desktop: true, available: true, running: true, vmState: "running" } }));
  await page.route(`${api}/computer/session/**`, (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { botId: bot.id, locked: false } });
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "Temporary connection failure" } }); }
    sessions++;
    return route.fulfill({ json: { botId: bot.id, width: 1280, height: 800, viewPath: `/computer/vnc/${token}/view.html?view_only=true` } });
  });
  await page.route(`${api}/computer/vnc/**`, async (route) => {
    if (route.request().url().endsWith("/core/rfb.js")) return route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: `export default class RFB { constructor() { this.listeners={}; setTimeout(()=>this.listeners.connect?.(),10); window.addEventListener('disconnect-fixture',()=>this.listeners.disconnect?.()); } addEventListener(name,fn){this.listeners[name]=fn;} focus(){} disconnect(){} }` });
    const response = await proxyVncHttp(new Request(route.request().url()), () => expired ? null : { localPort: 1 });
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`/bot/${bot.id}`);
    const reconnect = page.getByRole("button", { name: "Disconnected, click to reconnect", exact: true });
    await expect(reconnect).toBeVisible();
    await page.screenshot({ path: "test-results/computer-disconnected.png" });
    const beforeReconnect = sessions;
    expired = false;
    await reconnect.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Open Reconnect's computer", exact: true })).toBeVisible();
    expect(sessions).toBe(beforeReconnect + 1);
    await page.evaluate(() => window.postMessage({ type: "rex-screen-state", state: "disconnected" }, "*"));
    await expect(reconnect).toHaveCount(0);
    await page.getByRole("button", { name: "Open Reconnect's computer", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(page.frameLocator('.computer-screen-expanded iframe').getByText("Connected · viewing", { exact: true })).toBeVisible();
    await dialog.locator("iframe").evaluate((frame: HTMLIFrameElement) => frame.contentWindow!.postMessage("ignored", "*"));
    const frame = page.frames().find((item) => item.url().includes(`/computer/vnc/${token}/view.html`))!;
    await frame.evaluate(() => window.dispatchEvent(new Event("disconnect-fixture")));
    await expect(dialog.getByRole("button", { name: "Disconnected, click to reconnect" })).toBeVisible();
    failNext = true;
    await dialog.getByRole("button", { name: "Disconnected, click to reconnect" }).click();
    await expect(page.getByText(/Temporary connection failure/)).toBeVisible();
    await dialog.getByRole("button", { name: "Disconnected, click to reconnect" }).click();
    await expect(page.frameLocator('.computer-screen-expanded iframe').getByText("Connected · viewing", { exact: true })).toBeVisible();
    expect(sessions).toBe(beforeReconnect + 2);
    await expect(dialog.getByRole("button", { name: "Disconnected, click to reconnect" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await request.delete(`${api}/conversations/${bot.id}`);
  }
});
