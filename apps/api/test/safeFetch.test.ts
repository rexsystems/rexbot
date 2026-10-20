import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPublicAddress, safeGet } from "../src/tools/safeFetch.js";

test("only public addresses count as public", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not an ip"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(address), true, address);
});

test("bots cannot fetch the host or follow redirects into it", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/hop") { response.writeHead(302, { Location: "http://127.0.0.1/secret" }); response.end(); return; }
    response.end("local secret");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const options = { timeoutMs: 5_000, maxBytes: 10_000 };
  try {
    await assert.rejects(safeGet(`http://127.0.0.1:${port}/`, options), /private address/);
    await assert.rejects(safeGet(`http://localhost:${port}/`, options), /private address/);
    await assert.rejects(safeGet(`http://[::1]:${port}/`, options), /private address/);
    await assert.rejects(safeGet("file:///etc/passwd", options), /Only http/);
    process.env.REX_ALLOW_PRIVATE_FETCH = "1";
    const allowed = await safeGet(`http://localhost:${port}/`, options);
    assert.equal(allowed.body.toString(), "local secret");
  } finally {
    delete process.env.REX_ALLOW_PRIVATE_FETCH;
    server.close();
  }
});
