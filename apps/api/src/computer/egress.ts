import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { isPublicAddress } from "../tools/safeFetch.js";

const HOP = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);
export const GUEST_PROXY = "http://10.0.2.100:3128";

export async function publicTarget(hostname: string, denied = new Set<string>()) {
  if (net.isIP(hostname) === 6) throw new Error("IPv6 destinations are not supported by the guest proxy.");
  const answers = net.isIP(hostname) ? [{ address: hostname, family: 4 }] : await lookup(hostname, { family: 4, all: true });
  const local = new Set(Object.values(networkInterfaces()).flatMap((entries) => entries?.map((entry) => entry.address) ?? []));
  if (!answers.length || answers.some(({ address }) => !isPublicAddress(address) || local.has(address) || denied.has(address))) throw new Error("The computer may access public websites only, never the host or private networks.");
  return answers[0]!.address;
}

export function createEgressProxy(resolve = publicTarget) {
  const sockets = new Set<net.Socket>();
  const server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 60000 }, (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "");
      if (url.protocol !== "http:" || url.username || url.password || (url.port && url.port !== "80")) throw new Error("Use HTTP on port 80 or HTTPS on port 443.");
      const address = await resolve(url.hostname);
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !HOP.has(key)));
      headers.host = url.host;
      const upstream = http.request({ hostname: address, port: 80, path: `${url.pathname}${url.search}`, method: request.method, headers, timeout: 60000 }, (result) => {
        response.writeHead(result.statusCode ?? 502, Object.fromEntries(Object.entries(result.headers).filter(([key]) => !HOP.has(key))));
        result.pipe(response);
      });
      upstream.on("timeout", () => upstream.destroy(new Error("Upstream timeout")));
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("The public website is not reachable."); });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    })().catch(() => { response.writeHead(403); response.end("Only public HTTP/HTTPS websites are reachable from this computer."); });
  });
  server.maxConnections = 256;
  server.on("connection", (socket) => { sockets.add(socket); socket.setTimeout(60000, () => socket.destroy()); socket.once("close", () => sockets.delete(socket)); });
  server.on("connect", (request, client, head) => {
    void (async () => {
      const url = new URL(`https://${request.url ?? ""}`);
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.port && url.port !== "443")) throw new Error("Invalid CONNECT target");
      const address = await resolve(url.hostname);
      if (client.destroyed) return;
      const upstream = net.connect({ host: address, port: 443 });
      upstream.setTimeout(60000, () => upstream.destroy());
      const close = () => { upstream.destroy(); client.destroy(); };
      upstream.on("error", close);
      client.on("error", close);
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    })().catch(() => client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"));
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  return { server, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}

let started: Promise<number> | undefined;
export function ensureEgressProxy(port = Number(process.env.REX_VM_PROXY_PORT || 19382)): Promise<number> {
  if (started) return started;
  started = (async () => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("REX_VM_PROXY_PORT must be between 1024 and 65535.");
    const denied = new Set<string>();
    if (process.env.REX_WEB_ORIGIN) {
      const hostname = new URL(process.env.REX_WEB_ORIGIN).hostname;
      for (const answer of await lookup(hostname, { family: 4, all: true })) denied.add(answer.address);
    }
    const proxy = createEgressProxy((host) => publicTarget(host, denied));
    await new Promise<void>((resolve, reject) => { proxy.server.once("error", reject); proxy.server.listen(port, "127.0.0.1", resolve); });
    proxy.server.unref();
    return port;
  })().catch((error) => { started = undefined; throw error; });
  return started;
}
