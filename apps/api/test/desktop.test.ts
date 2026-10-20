import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { ChildProcess } from "node:child_process";
import { DesktopComputer, validateInput, type VmPower, type VmState } from "../src/computer/desktop.js";
import type { SshResult, SshRunner, TunnelOpener } from "../src/computer/ssh.js";
import { attachVncProxy, parseVncPath, proxyVncHttp } from "../src/computer/vncProxy.js";

function fakeVm() {
  const calls: string[] = [];
  let state: VmState = "stopped";
  const vm: VmPower = {
    label: "Test VM",
    state: async () => { calls.push("state"); return state; },
    start: async () => { calls.push("start"); state = "running"; },
    stop: async () => { calls.push("stop"); state = "stopped"; },
  };
  return { calls, vm, setState: (next: VmState) => { state = next; } };
}

function fakeGuest() {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const slots = new Map<string, number>();
  const ssh: SshRunner = async (args, input) => {
    calls.push({ args, input });
    const [, command, botId] = args;
    const ok = (output: string): SshResult => ({ code: 0, output, timedOut: false });
    if (args[0] === "python3") {
      const payload = JSON.parse(Buffer.from(input!.match(/bytes.fromhex\("([a-f0-9]+)"\)/)![1]!, "hex").toString());
      return ok(JSON.stringify({ operation: payload.operation, browser_launched: payload.open_browser }));
    }
    if (command === "ping") return ok("ok");
    if (command === "ensure") {
      if (!slots.has(botId!)) slots.set(botId!, slots.size);
      const slot = slots.get(botId!)!;
      return ok(JSON.stringify({ botId, slot, display: `:${10 + slot}`, wsPort: 6080 + slot, width: 1280, height: 800, locked: false }));
    }
    if (command === "lock" || command === "unlock") return ok("ok");
    if (command === "exec") return input?.includes("sleep") ? { code: 124, output: "", timedOut: false } : ok(`ran ${input} as ${botId}`);
    if (command === "input") return ok("click done");
    if (command === "screenshot") return ok(JSON.stringify({ path: "/workspace/bots/x/.screens/a.png", width: 1280, height: 800, windows: [] }));
    return { code: 2, output: "unknown", timedOut: false };
  };
  const tunnels: Array<[number, number]> = [];
  const openTunnel: TunnelOpener = (localPort, remotePort) => {
    tunnels.push([localPort, remotePort]);
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { exitCode: null, killed: false, kill: () => true });
    return child;
  };
  return { calls, ssh, tunnels, openTunnel };
}

function computerWith(vm = fakeVm(), guest = fakeGuest(), lockIdleMs = 60_000) {
  let port = 46_080;
  return { vm, guest, computer: new DesktopComputer(vm.vm, guest.ssh, guest.openTunnel, { pollMs: 1, bootTimeoutMs: 200, lockIdleMs, allocatePort: async () => port++ }) };
}

test("starts the VM on demand and powers it off on request", async () => {
  const { vm, computer } = computerWith();
  assert.equal((await computer.status()).running, false);
  const status = await computer.start();
  assert.equal(status.running, true);
  assert.equal(status.desktop, true);
  assert.equal(status.backend, "qemu");
  assert.equal(vm.calls.filter((call) => call === "start").length, 1);
  await computer.start();
  assert.equal(vm.calls.filter((call) => call === "start").length, 1, "a running VM is not started twice");
  const stopped = await computer.stop();
  assert.equal(stopped.running, false);
  assert.ok(vm.calls.includes("stop"));
});

test("idle detection ignores busy computers", async () => {
  const { computer } = computerWith();
  await computer.start();
  computer.lastUsed = Date.now() - 10_000;
  assert.equal(computer.isIdle(5_000), true);
  assert.equal(computer.isIdle(60_000), false);
});

test("each bot gets its own screen, tunnel and view token", async () => {
  const { vm, guest, computer } = computerWith();
  vm.setState("running");
  const first = await computer.session("bot_a");
  const second = await computer.session("bot_b");
  assert.notEqual(first.slot, second.slot);
  assert.notEqual(first.viewPath, second.viewPath);
  assert.deepEqual(guest.tunnels, [[46080, 6080], [46081, 6081]]);
  const token = parseVncPath(first.viewPath.split("?")[0]!)!.token;
  assert.deepEqual(computer.resolveView(token), { botId: "bot_a", localPort: 46080 });
  assert.equal(computer.resolveView("x".repeat(24)), null);
  assert.equal((await computer.session("bot_a")).viewPath, first.viewPath);
  await assert.rejects(computer.session("../etc"), /Invalid bot id/);
});

test("commands run in the bot's session with text only on stdin", async () => {
  const { vm, guest, computer } = computerWith();
  vm.setState("running");
  const result = await computer.execute("echo 'hi; rm -rf /'", "bot_a");
  assert.equal(result.exitCode, 0);
  const exec = guest.calls.find((call) => call.args[1] === "exec")!;
  assert.deepEqual(exec.args, ["rex-sessiond", "exec", "bot_a"]);
  assert.equal(exec.input, "echo 'hi; rm -rf /'");
  assert.equal((await computer.execute("sleep 99", "bot_a")).timedOut, true);
  assert.match((await computer.execute("pwd")).output, /as owner/);
});

test("mouse input locks the screen and the lock expires", async () => {
  const { vm, guest, computer } = computerWith(undefined, undefined, 40);
  vm.setState("running");
  await computer.input("bot_a", { action: "click", x: 10, y: 20 });
  assert.equal(computer.sessionState("bot_a").locked, true);
  assert.equal(computer.sessionState("bot_b").locked, false);
  assert.equal(guest.calls.find((call) => call.args[1] === "input")?.input, JSON.stringify({ action: "click", x: 10, y: 20 }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(computer.sessionState("bot_a").locked, false);
  assert.ok(guest.calls.some((call) => call.args[1] === "unlock" && call.args[2] === "bot_a"));
});

test("one action at a time per bot", async () => {
  const { vm, computer } = computerWith();
  vm.setState("running");
  const first = computer.execute("echo one", "bot_a");
  await assert.rejects(computer.execute("echo two", "bot_a"), /already using/);
  await computer.execute("echo three", "bot_b");
  await first;
});

test("owner control reserves keyboard input while background work continues", async () => {
  const { vm, guest, computer } = computerWith();
  vm.setState("running");
  await computer.input("bot_a", { action: "key", keys: "Return" });
  await computer.takeControl("bot_a");
  assert.equal(computer.sessionState("bot_a").locked, false);
  await assert.rejects(computer.input("bot_a", { action: "click", x: 1, y: 2 }), /user has the mouse and keyboard/);
  assert.equal((await computer.execute("echo one", "bot_a")).exitCode, 0);
  assert.match(guest.calls.find((call) => call.args[1] === "exec")!.input!, /^unset DISPLAY DBUS_SESSION_BUS_ADDRESS\n/);
  assert.ok(JSON.parse(await computer.screenshot("bot_a")).path);
  assert.equal(JSON.parse(await computer.workspace("bot_a", "files", { action: "write", path: "index.html", content: "working" })).operation, "files");
  assert.equal(JSON.parse(await computer.workspace("bot_a", "project", { action: "start" })).browser_launched, false);
  computer.lastUsed = 0;
  assert.equal(computer.isIdle(1), false);
  computer.releaseControl("bot_a");
  assert.equal((await computer.execute("echo one", "bot_a")).exitCode, 0);
  assert.equal(JSON.parse(await computer.workspace("bot_a", "project", { action: "open" })).browser_launched, true);
  await computer.input("bot_a", { action: "key", keys: "Return" });
  await computer.unlock("bot_a");
});

test("taking control wins over a bot action already waiting to lock the screen", async () => {
  const guest = fakeGuest();
  const original = guest.ssh;
  let waiting!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => { waiting = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  guest.ssh = async (args, input, timeout) => {
    if (args[1] === "lock") { waiting(); await gate; }
    return original(args, input, timeout);
  };
  const { vm, computer } = computerWith(undefined, guest);
  vm.setState("running");
  const action = computer.input("bot_a", { action: "click", x: 10, y: 20 });
  await started;
  await computer.takeControl("bot_a");
  resume();
  await assert.rejects(action, /user has the mouse and keyboard/);
  assert.equal(computer.sessionState("bot_a").locked, false);
  assert.ok(!guest.calls.some((call) => call.args[1] === "input"));
});

test("input validation rejects malformed actions", () => {
  assert.throws(() => validateInput({ action: "drag" }), /action must be/);
  assert.throws(() => validateInput({ action: "click", x: 5 }), /both x and y/);
  assert.throws(() => validateInput({ action: "key", keys: "ctrl+l; reboot" }), /xdotool combo/);
  assert.throws(() => validateInput({ action: "type", text: "" }), /1-2000/);
  assert.deepEqual(validateInput({ action: "scroll", amount: 99 }), { action: "scroll", x: undefined, y: undefined, direction: "down", amount: 20 });
});

async function listen(server: net.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

test("noVNC files and websocket are proxied only for valid tokens", async () => {
  const token = "t".repeat(24);
  const files = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(`page ${req.url}`); });
  const filesPort = await listen(files);
  const resolve = (value: string) => value === token ? { localPort: filesPort } : null;
  try {
    const ok = await proxyVncHttp(new Request(`http://localhost/computer/vnc/${token}/vnc_lite.html?x=1`), resolve);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "page /vnc_lite.html?x=1");
    assert.equal((await proxyVncHttp(new Request(`http://localhost/computer/vnc/${"u".repeat(24)}/vnc_lite.html`), resolve)).status, 404);
    const expired = await proxyVncHttp(new Request(`http://localhost/computer/vnc/${"u".repeat(24)}/view.html`), resolve);
    assert.equal(expired.status, 404);
    assert.match(expired.headers.get("Content-Type")!, /text\/html/);
    assert.match(await expired.text(), /Disconnected, click to reconnect/);
  } finally { files.close(); }

  const websockify = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const head = chunk.toString();
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Path: ${head.split(" ")[1]}\r\n\r\n`);
      socket.on("data", (data) => socket.write(data));
    });
  });
  const wsPort = await listen(websockify);
  const api = http.createServer();
  attachVncProxy(api, (value) => value === token ? { localPort: wsPort } : null, () => ["http://localhost:5173"]);
  const apiPort = await listen(api);
  const upgrade = (origin: string, path = `/computer/vnc/${token}/websockify`) => new Promise<{ status: number; socket?: net.Socket; headers?: http.IncomingHttpHeaders }>((done) => {
    const req = http.request({ port: apiPort, host: "127.0.0.1", path, headers: { Connection: "Upgrade", Upgrade: "websocket", Origin: origin } });
    req.on("upgrade", (res, socket) => done({ status: res.statusCode ?? 0, socket, headers: res.headers }));
    req.on("response", (res) => done({ status: res.statusCode ?? 0 }));
    req.end();
  });
  try {
    assert.equal((await upgrade("http://evil.test")).status, 403);
    assert.equal((await upgrade("http://localhost:5173", `/computer/vnc/${"u".repeat(24)}/websockify`)).status, 404);
    const good = await upgrade("http://localhost:5173");
    assert.equal(good.status, 101);
    assert.equal(good.headers?.["x-path"], "/websockify");
    const echoed = await new Promise<string>((done) => { good.socket!.once("data", (data) => done(data.toString())); good.socket!.write("ping"); });
    assert.equal(echoed, "ping");
    good.socket!.destroy();
  } finally { api.close(); websockify.close(); }
});
