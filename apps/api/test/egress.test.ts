import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { createEgressProxy, publicTarget } from "../src/computer/egress.js";

test("VM egress always rejects host, private, metadata, mapped IPv6 and configured host addresses", async () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.2.2", "192.168.1.1", "169.254.169.254", "::1", "::ffff:7f00:1"]) await assert.rejects(publicTarget(host));
  await assert.rejects(publicTarget("8.8.8.8", new Set(["8.8.8.8"])));
  assert.equal(await publicTarget("8.8.8.8"), "8.8.8.8");
});

test("proxy rejects private HTTP and CONNECT destinations and non-web ports", async () => {
  const proxy = createEgressProxy();
  await new Promise<void>((resolve) => proxy.server.listen(0, "127.0.0.1", resolve));
  const port = (proxy.server.address() as AddressInfo).port;
  try {
    const code = await new Promise<number>((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path: "http://127.0.0.1/health" }, (response) => { response.resume(); resolve(response.statusCode!); }).on("error", reject);
    });
    assert.equal(code, 403);
    for (const target of ["127.0.0.1:443", "169.254.169.254:443", "8.8.8.8:22"]) {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
        socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); });
        socket.once("error", reject);
      });
      assert.match(response, /^HTTP\/1.1 403/);
    }
  } finally { proxy.close(); }
});
