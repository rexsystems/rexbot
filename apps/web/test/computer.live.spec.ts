import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BOT } from "@rex/shared";
import { QemuHost, QemuMachine } from "../../api/src/computer/qemu";
import { DesktopComputer } from "../../api/src/computer/desktop";
import { sshRunner, tunnelOpener } from "../../api/src/computer/ssh";
import { proxyVncHttp, attachVncProxy } from "../../api/src/computer/vncProxy";

test("real noVNC accepts owner mouse and keyboard through the computer preview", async ({ page, request }) => {
  test.skip(!process.env.REX_TEST_VM_TEMPLATE, "Set REX_TEST_VM_TEMPLATE to run the real desktop check.");
  test.setTimeout(180_000);
  const bot = await (await request.post("http://127.0.0.1:18787/bots", { data: { ...DEFAULT_BOT, name: "Live controls" } })).json();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rex-controls-live-"));
  const host = new QemuHost(root);
  const machine = new QemuMachine(host, { name: "controls-check", sshPort: 29300, memoryMb: 2048, cores: 2, diskGb: 16, hostname: "controls-check", instanceId: `qa-${Date.now()}`, backingFile: process.env.REX_TEST_VM_TEMPLATE! });
  const key = await host.ensureKey();
  const ssh = { host: "127.0.0.1", user: "rex", port: machine.spec.sshPort, keyFile: key.privateKey, knownHostsFile: machine.knownHostsPath };
  const computer = new DesktopComputer({ label: "Test desktop", state: () => machine.state(), start: () => machine.start(), stop: () => machine.stop() }, sshRunner(ssh), tunnelOpener(ssh), { pollMs: 1000, bootTimeoutMs: 120_000 });
  let vncPort = 0;
  const vncServer = http.createServer(async (request, response) => {
    const result = await proxyVncHttp(new Request(`http://127.0.0.1:${vncPort}${request.url}`), (value) => computer.resolveView(value));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  attachVncProxy(vncServer, (value) => computer.resolveView(value), () => []);
  await new Promise<void>((resolve) => vncServer.listen(0, "127.0.0.1", resolve));
  vncPort = (vncServer.address() as AddressInfo).port;
  try {
    await computer.start();
    const session = await computer.session(bot.id);
    await computer.execute(`nohup xterm -geometry 80x24+0+0 -e bash -lc 'read -r line; printf %s "$line" > /workspace/bots/${bot.id}/typed.txt; sleep 90' >/tmp/rex-control-test.log 2>&1 &`, bot.id);
    await page.route("http://127.0.0.1:18787/computer", (route) => route.fulfill({ json: { desktop: true, available: true, running: true, vmState: "running" } }));
    await page.route("http://127.0.0.1:18787/computer/session/**", async (route) => {
      if (route.request().method() === "POST") {
        const result = route.request().url().endsWith("/take-control") ? await computer.takeControl(bot.id) : computer.releaseControl(bot.id);
        await route.fulfill({ json: result });
      } else await route.fulfill({ json: session });
    });
    await page.route("http://127.0.0.1:18787/computer/vnc/**", (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({ status: 302, headers: { Location: `http://127.0.0.1:${vncPort}${url.pathname}${url.search}` } });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/bot/${bot.id}`);
    await page.getByRole("button", { name: "Open Live controls's computer", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Take control", exact: true }).click();
    const screen = page.frameLocator(".computer-screen-expanded iframe");
    await expect(screen.locator("#status")).toContainText("Connected · you control the computer", { timeout: 30_000 });
    expect(await screen.locator("html").evaluate(() => window.origin)).toBe("null");
    await page.screenshot({ path: "test-results/computer-controls-real-before.png" });
    await screen.locator("canvas").click({ position: { x: 100, y: 100 } });
    await page.keyboard.type("owner-control-verified");
    await page.keyboard.press("Enter");
    await page.screenshot({ path: "test-results/computer-controls-real-after.png" });
    await expect.poll(async () => (await sshRunner(ssh)(["cat", `/workspace/bots/${bot.id}/typed.txt`], undefined, 10000)).output, { timeout: 15000 }).toBe("owner-control-verified");
    await page.screenshot({ path: "test-results/computer-controls-real-vm.png" });
    await page.getByRole("dialog").getByRole("button", { name: "Return control", exact: true }).click();
  } finally {
    vncServer.closeAllConnections();
    vncServer.close();
    await computer.stop().catch(() => undefined);
    await machine.destroy();
    fs.rmSync(root, { recursive: true, force: true });
    await request.delete(`http://127.0.0.1:18787/conversations/${bot.id}`);
  }
});
