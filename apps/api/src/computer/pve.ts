import fs from "node:fs";
import https from "node:https";

export interface PveConfig {
  url: string;
  node: string;
  vmid: number;
  vmName: string;
  tokenId: string;
  tokenSecret: string;
  insecureTls?: boolean;
  caFile?: string;
}

export type PveRequester = (method: "GET" | "POST", path: string) => Promise<unknown>;

export interface PveVmStatus {
  status: string;
  name?: string;
  uptime?: number;
}

export function pveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PveConfig | null {
  const url = env.REX_PROXMOX_URL?.trim();
  if (!url) return null;
  const vmid = Number(env.REX_PROXMOX_VMID);
  const required = { REX_PROXMOX_NODE: env.REX_PROXMOX_NODE, REX_PROXMOX_TOKEN_ID: env.REX_PROXMOX_TOKEN_ID, REX_PROXMOX_TOKEN_SECRET: env.REX_PROXMOX_TOKEN_SECRET };
  const missing = Object.entries(required).filter(([, value]) => !value?.trim()).map(([key]) => key);
  if (!Number.isInteger(vmid) || vmid < 100) missing.push("REX_PROXMOX_VMID");
  if (missing.length) throw new Error(`Proxmox computer is missing ${missing.join(", ")}.`);
  return {
    url: url.replace(/\/+$/, ""),
    node: env.REX_PROXMOX_NODE!.trim(),
    vmid,
    vmName: env.REX_PROXMOX_VM_NAME?.trim() || "rex-computer",
    tokenId: env.REX_PROXMOX_TOKEN_ID!.trim(),
    tokenSecret: env.REX_PROXMOX_TOKEN_SECRET!.trim(),
    insecureTls: env.REX_PROXMOX_INSECURE_TLS === "1",
    caFile: env.REX_PROXMOX_CA_FILE?.trim() || undefined,
  };
}

function httpsRequester(config: PveConfig): PveRequester {
  const ca = config.caFile ? fs.readFileSync(config.caFile) : undefined;
  return (method, path) => new Promise((resolve, reject) => {
    const target = new URL(`${config.url}/api2/json${path}`);
    const request = https.request(target, {
      method,
      ca,
      rejectUnauthorized: !config.insecureTls,
      timeout: 15_000,
      headers: { Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`, Accept: "application/json" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body = (body + chunk).slice(0, 200_000); });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status === 401) return reject(new Error("Proxmox rejected the API token. Check REX_PROXMOX_TOKEN_ID and REX_PROXMOX_TOKEN_SECRET."));
        if (status === 403) return reject(new Error(`The Proxmox token lacks permission for VM ${config.vmid}. Grant VM.Audit and VM.PowerMgmt on /vms/${config.vmid}.`));
        if (status < 200 || status >= 300) return reject(new Error(`Proxmox returned ${status}: ${body.slice(0, 200)}`));
        try { resolve((JSON.parse(body) as { data?: unknown }).data); } catch { reject(new Error("Proxmox returned invalid JSON.")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Proxmox at ${config.url} did not answer within 15 seconds.`)));
    request.on("error", (error) => reject(new Error(`Could not reach Proxmox at ${config.url}: ${error.message}`)));
    request.end();
  });
}

/** Talks to one VM only. Every call is scoped to the configured node and VMID. */
export class PveClient {
  private readonly request: PveRequester;
  private verified = false;

  constructor(readonly config: PveConfig, requester?: PveRequester) {
    this.request = requester ?? httpsRequester(config);
  }

  private get vmPath() {
    return `/nodes/${encodeURIComponent(this.config.node)}/qemu/${this.config.vmid}`;
  }

  /** Refuses to act unless the VM carries the expected name, so a wrong VMID never touches another VM. */
  async verify(): Promise<void> {
    if (this.verified) return;
    const vmConfig = await this.request("GET", `${this.vmPath}/config`) as { name?: string } | undefined;
    if (vmConfig?.name !== this.config.vmName) {
      throw new Error(`VM ${this.config.vmid} is named ${JSON.stringify(vmConfig?.name ?? "")}, not ${JSON.stringify(this.config.vmName)}. Rex will not control it.`);
    }
    this.verified = true;
  }

  async status(): Promise<PveVmStatus> {
    await this.verify();
    const data = await this.request("GET", `${this.vmPath}/status/current`) as PveVmStatus | undefined;
    return { status: data?.status ?? "unknown", name: data?.name, uptime: data?.uptime };
  }

  async start(): Promise<void> {
    await this.verify();
    await this.request("POST", `${this.vmPath}/status/start`);
  }

  async shutdown(): Promise<void> {
    await this.verify();
    await this.request("POST", `${this.vmPath}/status/shutdown`);
  }
}
