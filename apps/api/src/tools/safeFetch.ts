import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Addresses a bot must never reach from the server: the host itself, the private network around
// it, cloud metadata endpoints, and the QEMU guests' forwarded SSH ports on loopback.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

export function privateFetchAllowed(): boolean {
  return process.env.REX_ALLOW_PRIVATE_FETCH === "1";
}

/** DNS lookup that refuses non-public answers, so the check and the connection use the same address. */
function guardedLookup(hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((entry) => !isPublicAddress(entry.address));
    if (bad && !privateFetchAllowed()) {
      const refused = Object.assign(new Error(`${hostname} resolves to a private address (${bad.address}); bots can only fetch public sites.`), { code: "EPRIVATE" });
      return callback(refused, "");
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

export interface SafeResponse { status: number; statusText: string; url: string; body: Buffer }

/** GET a public http(s) URL with redirects re-checked hop by hop. */
export async function safeGet(url: string, options: { timeoutMs: number; maxBytes: number; headers?: Record<string, string>; maxRedirects?: number }): Promise<SafeResponse> {
  let current = new URL(url);
  const deadline = Date.now() + options.timeoutMs;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("Only http(s) URLs are allowed.");
    const literal = current.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !isPublicAddress(literal) && !privateFetchAllowed()) throw new Error(`${literal} is a private address; bots can only fetch public sites.`);
    const response = await requestOnce(current, options.headers ?? {}, Math.max(1, deadline - Date.now()), options.maxBytes);
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = new URL(response.location, current);
      continue;
    }
    return { status: response.status, statusText: response.statusText, url: current.toString(), body: response.body };
  }
  throw new Error("Too many redirects.");
}

function requestOnce(url: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number) {
  return new Promise<{ status: number; statusText: string; location?: string; body: Buffer }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, { method: "GET", headers, lookup: guardedLookup as never, timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ status, statusText: response.statusMessage ?? "", location: response.headers.location, body: Buffer.alloc(0) });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (size >= maxBytes) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size >= maxBytes) response.destroy();
      });
      const finish = () => resolve({ status, statusText: response.statusMessage ?? "", body: Buffer.concat(chunks).subarray(0, maxBytes) });
      response.on("end", finish);
      response.on("close", finish);
      response.on("error", (error) => (size > 0 ? finish() : reject(error)));
    });
    request.on("timeout", () => request.destroy(new Error("The site took too long to answer.")));
    request.on("error", reject);
    request.end();
  });
}
