import net from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

export type ViewResolver = (token: string) => { localPort: number } | null;

const VNC_PATH = /^\/computer\/vnc\/([A-Za-z0-9_-]{16,64})\/(.*)$/;
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "content-encoding", "content-length"]);

export function parseVncPath(pathname: string): { token: string; rest: string } | null {
  const match = VNC_PATH.exec(pathname);
  return match ? { token: match[1]!, rest: match[2]! } : null;
}

async function retry<T>(attempts: number, work: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await work(); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 300)); }
  }
  throw lastError;
}

/** Serves the guest's noVNC files through the API so the browser never talks to the VM directly. */
export async function proxyVncHttp(request: Request, resolve: ViewResolver): Promise<Response> {
  const url = new URL(request.url);
  const target = parseVncPath(url.pathname);
  const view = target ? resolve(target.token) : null;
  if (!target || !view) return new Response("This screen link expired. Reopen the computer panel.", { status: 404 });
  if (target.rest.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const upstream = await retry(10, () => fetch(`http://127.0.0.1:${view.localPort}/${target.rest}${url.search}`, { signal: AbortSignal.timeout(8_000) }));
    const headers = new Headers();
    upstream.headers.forEach((value, key) => { if (!HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value); });
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Security-Policy", "frame-ancestors *");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response("Rex Computer's screen is not reachable yet. Retry in a few seconds.", { status: 502 });
  }
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function reject(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Relays noVNC's WebSocket to websockify inside the VM via the local SSH tunnel. */
export function attachVncProxy(server: Server, resolve: ViewResolver, allowedOrigins: () => string[]) {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const target = parseVncPath(pathname);
    if (!target || target.rest !== "websockify") return reject(socket, "404 Not Found");
    const origin = request.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) return reject(socket, "403 Forbidden");
    const view = resolve(target.token);
    if (!view) return reject(socket, "404 Not Found");
    void retry(10, () => connect(view.localPort)).then((upstream) => {
      const lines = [`GET /websockify HTTP/1.1`];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]!;
        if (name.toLowerCase() === "host") continue;
        lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
      }
      lines.push(`Host: 127.0.0.1:${view.localPort}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
      const close = () => { upstream.destroy(); socket.destroy(); };
      upstream.on("error", close);
      socket.on("error", close);
      upstream.on("close", close);
      socket.on("close", close);
    }).catch(() => reject(socket, "502 Bad Gateway"));
  });
}
