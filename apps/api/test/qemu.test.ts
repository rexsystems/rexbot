import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudConfig, QemuHost, QemuMachine } from "../src/computer/qemu.js";

const spec = { name: "u-test", sshPort: 22_299, memoryMb: 2048, cores: 1, diskGb: 16, hostname: "rex-computer", instanceId: "rex-1", backingFile: "/nonexistent.qcow2" };

test("cloud-init config creates the rex user with only the API key and no passwords", () => {
  const text = cloudConfig({ hostname: "rex-computer", publicKey: "ssh-ed25519 AAAA rex" });
  assert.ok(text.startsWith("#cloud-config\n"));
  const config = JSON.parse(text.slice("#cloud-config\n".length));
  assert.equal(config.ssh_pwauth, false);
  assert.equal(config.users[0].name, "rex");
  assert.equal(config.users[0].lock_passwd, true);
  assert.deepEqual(config.users[0].ssh_authorized_keys, ["ssh-ed25519 AAAA rex"]);
});

test("machine names are validated and state comes from the disk and a verified pidfile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rex-qemu-"));
  const host = new QemuHost(root, { REX_QEMU_ACCEL: "tcg" });
  assert.throws(() => new QemuMachine(host, { ...spec, name: "../evil" }), /Invalid VM name/);
  const machine = new QemuMachine(host, spec);
  assert.equal(await machine.state(), "missing");
  fs.mkdirSync(machine.dir, { recursive: true });
  fs.writeFileSync(machine.diskPath, "");
  assert.equal(await machine.state(), "stopped");
  // A live PID that is not this VM's QEMU process must never count as running (or be killed).
  fs.writeFileSync(machine.pidPath, String(process.pid));
  assert.equal(machine.pid(), null);
  assert.equal(await machine.state(), "stopped");
  await machine.kill();
  assert.ok(fs.existsSync(machine.diskPath));
  await machine.destroy();
  assert.equal(fs.existsSync(machine.dir), false);
  await assert.rejects(machine.start(), /image is missing|qemu-system|seed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("host info reports missing tools instead of throwing", () => {
  const host = new QemuHost(fs.mkdtempSync(path.join(os.tmpdir(), "rex-qemu-")), { REX_QEMU_BINARY: "", REX_QEMU_ACCEL: "tcg" });
  const info = host.info();
  assert.equal(info.accel, "tcg");
  assert.equal(info.template, null);
  assert.ok(Array.isArray(info.problems));
});
