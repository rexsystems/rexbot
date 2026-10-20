import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { QemuHost, QemuMachine, waitForSsh } from "../src/computer/qemu.js";
import { sshRunner } from "../src/computer/ssh.js";
import { GUEST_PROXY } from "../src/computer/egress.js";
import { DesktopComputer } from "../src/computer/desktop.js";

test("live guest reaches public websites through the proxy and cannot reach the host", { timeout: 300_000 }, async () => {
  const backingFile = process.env.REX_TEST_VM_TEMPLATE;
  assert.ok(backingFile, "Set REX_TEST_VM_TEMPLATE to a provisioned qcow2 image.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rex-isolation-live-"));
  const host = new QemuHost(root);
  let hostHits = 0;
  const canary = http.createServer((_request, response) => { hostHits++; response.end("host must not be reached"); });
  await new Promise<void>((resolve) => canary.listen(0, "127.0.0.1", resolve));
  const hostPort = (canary.address() as AddressInfo).port;
  const machine = new QemuMachine(host, { name: "isolation-check", sshPort: 29299, memoryMb: 2048, cores: 2, diskGb: 16, hostname: "isolation-check", instanceId: `qa-${Date.now()}`, backingFile });
  try {
    const key = await host.ensureKey();
    await machine.start();
    assert.equal(machine.networkRestricted(), true);
    await waitForSsh(machine, key.privateKey, 240_000);
    const ssh = sshRunner({ host: "127.0.0.1", user: "rex", port: machine.spec.sshPort, keyFile: key.privateKey, knownHostsFile: machine.knownHostsPath });
    const run = (command: string) => ssh(["bash", "-s"], command, 60_000);
    const publicSite = await run(`curl -fsS --max-time 20 -x ${GUEST_PROXY} https://example.com | head -c 200`);
    assert.equal(publicSite.code, 0, publicSite.output);
    assert.match(publicSite.output, /doctype|Example Domain/i);
    for (const target of ["http://127.0.0.1:8787/health", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1/"]) {
      const result = await run(`curl --noproxy '' -s --max-time 10 -o /dev/null -w '%{http_code}' -x ${GUEST_PROXY} ${target}`);
      assert.equal(result.output, "403", `${target}: ${result.output}`);
    }
    const direct = await run(`curl --noproxy '*' -s --max-time 3 http://10.0.2.2:${hostPort}/health`);
    assert.notEqual(direct.code, 0, "direct guest-to-host traffic must fail");
    assert.equal(hostHits, 0);
    const desktop = new DesktopComputer(machine, (args, input, timeout) => ssh(["env", `http_proxy=${GUEST_PROXY}`, `https_proxy=${GUEST_PROXY}`, ...args], input, timeout), () => { throw new Error("No screen tunnel needed in this check"); });
    const workspace = async (operation: "files" | "project", args: Record<string, unknown>) => JSON.parse(await desktop.workspace("project-check", operation, args));
    const original = '<!doctype html><title>Guest project check</title><h1>Before edit</h1>';
    assert.equal((await workspace("files", { action: "write", path: "site/index.html", content: original })).saved, true);
    assert.equal((await workspace("files", { action: "read", path: "site/index.html" })).content, original);
    await assert.rejects(workspace("files", { action: "write", path: "../../outside.txt", content: "blocked" }), /inside this bot/);
    const started = await workspace("project", { action: "start", directory: "site" });
    assert.equal(started.running, true);
    assert.equal(started.check.http_status, 200);
    assert.equal(started.check.title, "Guest project check");
    assert.equal(started.browser_launched, true);
    let windows = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      windows = (await desktop.screenshot("project-check"));
      if (windows.includes("Guest project check")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.match(windows, /Guest project check/, "the guest browser must load the local project");
    await workspace("files", { action: "replace", path: "site/index.html", old_text: "Before edit", new_text: "After edit" });
    assert.match((await workspace("project", { action: "inspect" })).check.source_excerpt, /After edit/);
    assert.equal((await workspace("project", { action: "stop" })).running, false);
    assert.equal((await workspace("project", { action: "status" })).running, false);
    const custom = await workspace("project", { action: "start", directory: "site", command: "exec python3 -m http.server $PORT --bind $HOST" });
    assert.equal(custom.check.http_status, 200);
    await workspace("project", { action: "stop" });
    console.log("Live VM: public HTTPS works; host, private IPs, metadata and direct host access blocked.");
    console.log("Live VM: structured file editing, browser launch, persistent static/custom servers, inspection and shutdown work.");
  } finally {
    await machine.destroy();
    canary.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
