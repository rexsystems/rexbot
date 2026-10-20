import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RexComputer } from "../src/computer.js";

test("rootless computer isolates files, resources and networking", { timeout: 45_000, skip: !hasPodman() && "Podman is not installed" }, async () => {
  const name = `rex-computer-test-${process.pid}`;
  const computer = new RexComputer(name);
  const markerDirectory = mkdtempSync(path.join(tmpdir(), "rex-host-marker-"));
  const hostMarker = path.join(markerDirectory, "host-only.txt");
  writeFileSync(hostMarker, "This file must not be visible inside the computer.");
  try {
    assert.equal((await computer.status()).available, true);
    await assert.rejects(computer.execute("id"), /off/);
    assert.equal((await computer.start()).running, true);
    const [inspect] = JSON.parse(execFileSync("podman", ["inspect", name], { encoding: "utf8" }));
    assert.equal(inspect.HostConfig.NetworkMode, "none");
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspect.HostConfig.Privileged, false);
    assert.deepEqual(inspect.HostConfig.Binds, []);
    assert.equal(inspect.Config.User, "1000:1000");
    assert.equal(inspect.HostConfig.Memory, 512 * 1024 * 1024);
    assert.equal(inspect.HostConfig.MemorySwap, inspect.HostConfig.Memory);
    assert.equal(inspect.HostConfig.PidsLimit, 64);
    assert.equal(inspect.HostConfig.CpuQuota / inspect.HostConfig.CpuPeriod, 1);
    assert.ok(inspect.HostConfig.SecurityOpt.includes("no-new-privileges"));
    const result = await computer.execute(`python - <<'PY'
import os, socket
assert os.getuid() == 1000
assert not os.path.exists(${JSON.stringify(hostMarker)})
assert not os.path.exists('/run/podman/podman.sock')
assert not os.path.exists('/var/run/docker.sock')
assert os.environ.get('LLM_API_KEY') is None
for key in ['CapEff:\\t0000000000000000', 'NoNewPrivs:\\t1', 'Seccomp:\\t2']:
    assert key in open('/proc/self/status').read(), key
try:
    open('/etc/rex-test', 'w')
    raise AssertionError('Root filesystem is writable')
except OSError:
    pass
try:
    socket.create_connection(('1.1.1.1', 443), timeout=1)
    raise AssertionError('Network is reachable')
except OSError:
    pass
open('/workspace/result.txt', 'w').write('42')
print('ISOLATION_OK')
PY`);
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /ISOLATION_OK/);
    assert.equal((await computer.execute("cat /workspace/result.txt")).output, "42");
    assert.equal((await computer.execute("exit 7")).exitCode, 7);
    const large = await computer.execute("python -c 'print(\"x\" * 100000)' ");
    assert.ok(large.output.length <= 32_000);
    await computer.stop();
    await computer.start();
    assert.notEqual((await computer.execute("cat /workspace/result.txt")).exitCode, 0);
    const slow = computer.execute("sleep 30");
    await assert.rejects(computer.execute("id"), /busy/);
    const timed = await slow;
    assert.equal(timed.timedOut, true);
    assert.equal((await computer.status()).running, false);
  } finally {
    await computer.stop();
    rmSync(markerDirectory, { recursive: true, force: true });
  }
});
