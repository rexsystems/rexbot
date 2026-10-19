import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DEFAULT_BOT } from "@rex/shared";

test("Google settings and Live audio handshake, tools, transcripts, mute and cleanup", async ({ page, request }) => {
  const bot = await (await request.post("http://127.0.0.1:18787/bots", { data: { ...DEFAULT_BOT, name: "Google demo" } })).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as any).__voiceTracks = stream.getTracks();
      return stream;
    };
  });
  let audioPackets = 0;
  let toolResponses = 0;
  let ended = false;
  const turns: Array<{ user: string; assistant: string }> = [];
  await page.route("**/voice", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.settings.liveModel).toBe("gemini-3.8-live");
    expect(body.settings.googleApiKey).toBe("test-only-google-key");
    await route.fulfill({ json: { id: "ui-session", url: "wss://generativelanguage.googleapis.com/ws/ui-test?access_token=short-lived", setup: { model: "models/gemini-3.8-live", generationConfig: { responseModalities: ["AUDIO"] } }, history: [] } });
  });
  await page.route("**/voice/ui-session/tool", (route) => route.fulfill({ json: { output: "Verified tool fixture" } }));
  await page.route("**/voice/ui-session/turn", async (route) => { turns.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); });
  await page.route("**/voice/ui-session", async (route) => { ended = true; await route.fulfill({ json: { ok: true } }); });
  await page.routeWebSocket("wss://generativelanguage.googleapis.com/**", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) { expect(message.setup.model).toBe("models/gemini-3.8-live"); socket.send(JSON.stringify({ setupComplete: {} })); }
      if (message.realtimeInput?.audio) {
        audioPackets++;
        expect(message.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
        expect(Buffer.from(message.realtimeInput.audio.data, "base64").length).toBeGreaterThan(100);
        if (audioPackets === 1) socket.send(JSON.stringify({ toolCall: { functionCalls: [{ id: "voice-tool", name: "http_fetch", args: { url: "https://example.com" } }] } }));
      }
      if (message.toolResponse) {
        toolResponses++;
        expect(message.toolResponse.functionResponses[0].response.output).toBe("Verified tool fixture");
        socket.send(JSON.stringify({ serverContent: { inputTranscription: { text: "Hello voice." }, outputTranscription: { text: "Hello from Live." }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(480).toString("base64") } }] }, turnComplete: true } }));
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Embedding model", exact: true })).toHaveValue("gemini-embedding-2");
  await expect(page.getByRole("textbox", { name: "Live voice model", exact: true })).toHaveValue("gemini-3.8-live");
  await page.getByLabel("Google AI Studio API key", { exact: true }).fill("test-only-google-key");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Google demo Your teammate", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Google demo" })).toBeVisible();
  await page.getByRole("button", { name: "Live voice", exact: true }).click();
  await expect(page.getByRole("region", { name: "Live voice" })).toBeVisible();
  await expect(page.getByText("Hello from Live.", { exact: true })).toBeVisible();
  await expect.poll(() => toolResponses).toBe(1);
  expect(audioPackets).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceTracks.every((track: MediaStreamTrack) => !track.enabled))).toBe(true);
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceTracks.every((track: MediaStreamTrack) => track.enabled))).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "End call", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Ended");
  expect(ended).toBe(true);
  expect(turns).toEqual([expect.objectContaining({ user: "Hello voice.", assistant: "Hello from Live." })]);
  expect(await page.evaluate(() => (window as any).__voiceTracks.every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/live-voice.png", fullPage: true });
  await page.unroute("**/voice");
  await page.route("**/voice", (route) => route.fulfill({ status: 502, json: { error: "Google model unavailable. Check your key and quota." } }));
  await page.getByRole("button", { name: "Start call", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Google model unavailable");
  expect(await page.evaluate(() => (window as any).__voiceTracks.every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  await page.getByRole("button", { name: "Close voice call", exact: true }).click();
  expect(errors).toEqual([]);
  await request.delete(`http://127.0.0.1:18787/conversations/${bot.id}`);
});

test("deletion confirms, cancels, animates, recovers from errors and respects reduced motion", async ({ page, request }) => {
  const bot = await (await request.post("http://127.0.0.1:18787/bots", { data: { ...DEFAULT_BOT, name: "Delete demo" } })).json();
  await page.goto("/");
  await page.getByRole("button", { name: "Delete demo Your teammate", exact: true }).click();
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Are you sure?");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  expect((await request.get(`http://127.0.0.1:18787/conversations/${bot.id}`)).status()).toBe(200);
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.route(`**/conversations/${bot.id}`, async (route) => route.request().method() === "DELETE" ? route.fulfill({ status: 503, json: { error: "Try deleting again." } }) : route.continue());
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Try deleting again.");
  await expect(page.locator(".delete-scene")).not.toHaveClass(/deleting/);
  expect((await request.get(`http://127.0.0.1:18787/conversations/${bot.id}`)).status()).toBe(200);
  await page.unroute(`**/conversations/${bot.id}`);
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.locator(".delete-target")).toHaveCSS("animation-name", "delete-squash");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await request.get(`http://127.0.0.1:18787/conversations/${bot.id}`)).status()).toBe(404);
  const reduced = await (await request.post("http://127.0.0.1:18787/bots", { data: { ...DEFAULT_BOT, name: "Reduced motion" } })).json();
  await page.reload();
  await page.getByRole("button", { name: "Reduced motion Your teammate", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(`**/conversations/${reduced.id}`, async (route) => { if (route.request().method() === "DELETE") await new Promise((resolve) => setTimeout(resolve, 350)); await route.continue(); });
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.locator(".delete-target")).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
