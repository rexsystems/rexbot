import net from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";

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
  if (target?.rest === "view.html" && !view) {
    const nonce = randomBytes(16).toString("base64");
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Disconnected</title><style nonce="${nonce}">html,body{margin:0;height:100%;background:#11100e;color:#ebe7df;font:14px system-ui}body{display:grid;place-items:center}button{color:inherit;background:#292620;border:1px solid #736c61;border-radius:6px;padding:16px;cursor:pointer}</style><button type="button">Disconnected, click to reconnect</button><script nonce="${nonce}">parent.postMessage({type:'rex-screen-state',state:'disconnected'},'*');document.querySelector('button').addEventListener('click',()=>{if(parent===window)location.assign('/app');else parent.postMessage({type:'rex-screen-state',state:'reconnect'},'*');});</script></html>`, { status: 404, headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors *; base-uri 'none'; form-action 'none'`,
    } });
  }
  if (!target || !view) return new Response("This screen link expired. Reopen the computer panel.", { status: 404 });
  if (target.rest.includes("..")) return new Response("Not found", { status: 404 });
  if (target.rest === "view.html") {
    const nonce = randomBytes(16).toString("base64");
    const socketOrigin = url.origin.replace(/^http/, "ws");
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rex Computer screen</title><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11100e;color:#ebe7df;font:14px system-ui}body{display:flex;flex-direction:column}#status{padding:6px 10px;flex:none}#screen{flex:1;min-height:0}button{margin-left:12px;color:inherit;background:#39352e;border:0;padding:6px 10px;border-radius:4px}</style></head><body><div id="status" role="status">Connecting…</div><div id="screen"></div><script nonce="${nonce}" type="module">
const status = document.getElementById('status');
const notify = (state) => parent.postMessage({ type: 'rex-screen-state', state }, '*');
const disconnected = () => { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Disconnected, click to reconnect'; button.addEventListener('click', () => { if (parent === window) location.reload(); else notify('reconnect'); }); status.replaceChildren(button); notify('disconnected'); };
let rfb;
const timeout = setTimeout(() => { disconnected(); rfb?.disconnect(); }, 15000);
try {
const { default: RFB } = await import('./core/rfb.js');
const viewOnly = new URLSearchParams(location.search).get('view_only') === 'true';
rfb = new RFB(document.getElementById('screen'), ${JSON.stringify(`${socketOrigin}/computer/vnc/${target.token}/websockify`)});
rfb.viewOnly = viewOnly;
rfb.scaleViewport = true;
rfb.resizeSession = false;
rfb.addEventListener('connect', () => { clearTimeout(timeout); status.textContent = viewOnly ? 'Connected · viewing' : 'Connected · you control the computer'; notify('connected'); if (!viewOnly) rfb.focus(); });
rfb.addEventListener('disconnect', () => { clearTimeout(timeout); disconnected(); });
rfb.addEventListener('securityfailure', () => { clearTimeout(timeout); disconnected(); });
} catch { clearTimeout(timeout); disconnected(); }
window.addEventListener('pagehide', () => { clearTimeout(timeout); rfb?.disconnect(); }, { once: true });
</script></body></html>`, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": `default-src 'none'; script-src ${url.origin} 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${socketOrigin}; img-src data: blob:; frame-ancestors *; base-uri 'none'; form-action 'none'`,
    } });
  }
  try {
    const upstream = await retry(10, () => fetch(`http://127.0.0.1:${view.localPort}/${target.rest}${url.search}`, { signal: AbortSignal.timeout(8_000) }));
    const headers = new Headers();
    upstream.headers.forEach((value, key) => { if (!HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value); });
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Security-Policy", "frame-ancestors *");
    headers.set("Access-Control-Allow-Origin", "*");
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
    if (origin && origin !== "null" && !allowedOrigins().includes(origin)) return reject(socket, "403 Forbidden");
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
