import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MiddlewareHandler } from "hono";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webp": "image/webp" };
const SPA = /^\/(?:|app|login|signup|bot\/[^/]+|group\/[^/]+|admin(?:\/(?:overview|users|computers|usage|settings))?)\/?$/;

export function webApp(root = process.env.REX_WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist")): MiddlewareHandler {
  const directory = path.resolve(root);
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    const route = c.req.path;
    const html = SPA.test(route) && c.req.header("Accept")?.includes("text/html");
    if (!html && !/^\/(?:assets|providers|landing)\//.test(route) && route !== "/pcm-capture.js" && route !== "/favicon.ico") return next();
    let decoded: string;
    try { decoded = decodeURIComponent(route); } catch { return next(); }
    const file = html ? path.join(directory, "index.html") : path.resolve(directory, `.${decoded}`);
    if (!file.startsWith(`${directory}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    c.header("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", html ? "no-store" : route.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    c.header("Referrer-Policy", "same-origin");
    c.header("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    if (c.req.method === "HEAD") return c.body(null);
    return c.body(new Uint8Array(fs.readFileSync(file)).buffer);
  };
}
