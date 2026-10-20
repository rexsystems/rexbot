import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createComputer, replaceComputer, type ComputerBackend } from "../computer.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const SCRIPT_DIR = path.join(REPO_ROOT, "scripts/proxmox");
const ENV_FILE = path.join(REPO_ROOT, ".env");
const DEFAULT_KEY = path.join(os.homedir(), ".ssh", "rex_computer");

export interface BootstrapRequest {
  /** Proxmox host IP or hostname (SSH as root). */
  pveHost: string;
  /** Node name in the Proxmox tree, often "pve". */
  node: string;
  /** Free VMID, or omit to pick the next free id from 180. */
  vmid?: number;
  /** Cloud-init network, e.g. ip=192.168.100.50/24,gw=192.168.100.1 or ip=dhcp. */
  ipconfig?: string;
  storage?: string;
  bridge?: string;
  memory?: number;
  cores?: number;
  disk?: string;
  /** Root password for the Proxmox host. Needs sshpass on the Rex machine. Prefer SSH keys. */
  pvePassword?: string;
  /** SSH private key that can log in as root on Proxmox. Defaults to ~/.ssh/id_ed25519 or id_rsa. */
  pveSshKey?: string;
  /** Where to write the guest SSH key. Defaults to ~/.ssh/rex_computer. */
  guestKey?: string;
  writeEnv?: boolean;
}

export interface BootstrapResult {
  vmid: number;
  guestIp: string;
  tokenId: string;
  envPath: string;
  status: Awaited<ReturnType<ComputerBackend["status"]>>;
  log: string[];
}

type RunResult = { code: number; output: string };

function expandHome(file: string) {
  return file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
}

function run(command: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...options.env } });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(0, 200_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim() }); });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function parseGuestIp(ipconfig: string): string | null {
  const match = /(?:^|,)ip=(\d+\.\d+\.\d+\.\d+)\//.exec(ipconfig);
  return match?.[1] ?? null;
}

export function mergeEnvFile(file: string, values: Record<string, string>) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.length ? existing.replace(/\s+$/, "").split("\n") : [];
  const keys = new Set(Object.keys(values));
  const kept = lines.filter((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return !match || !keys.has(match[1]!);
  });
  const block = [
    "",
    "# Rex Computer (Proxmox) — written by POST /computer/bootstrap",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ];
  fs.writeFileSync(file, `${[...kept, ...block].join("\n").replace(/\n{3,}/g, "\n\n")}`, "utf8");
}

function applyEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

export class BootstrapBusyError extends Error {
  constructor() { super("A Proxmox bootstrap is already running."); }
}

let active: Promise<BootstrapResult> | null = null;

/** One-shot setup: create rex-computer on Proxmox, provision the guest, write .env, hot-swap the API backend. */
export function bootstrapComputer(raw: BootstrapRequest): Promise<BootstrapResult> {
  if (active) return Promise.reject(new BootstrapBusyError());
  active = runBootstrap(raw).finally(() => { active = null; });
  return active;
}

async function runBootstrap(raw: BootstrapRequest): Promise<BootstrapResult> {
  const log: string[] = [];
  const step = (message: string) => { log.push(message); };

  const pveHost = raw.pveHost?.trim();
  const node = raw.node?.trim();
  if (!pveHost || !/^[A-Za-z0-9._:-]+$/.test(pveHost)) throw new Error("Provide the Proxmox host IP or hostname.");
  if (!node || !/^[A-Za-z0-9._-]+$/.test(node)) throw new Error("Provide the Proxmox node name (often pve).");
  const ipconfig = (raw.ipconfig?.trim() || "ip=dhcp").replace(/[\n\r]/g, "");
  const storage = (raw.storage?.trim() || "local-lvm").replace(/[^\w.-]/g, "");
  const bridge = (raw.bridge?.trim() || "vmbr0").replace(/[^\w.-]/g, "");
  const memory = Number(raw.memory ?? 4096);
  const cores = Number(raw.cores ?? 2);
  const disk = (raw.disk?.trim() || "32G").replace(/[^\w]/g, "");
  if (!Number.isInteger(memory) || memory < 1024 || memory > 131072) throw new Error("memory must be between 1024 and 131072 MB.");
  if (!Number.isInteger(cores) || cores < 1 || cores > 64) throw new Error("cores must be between 1 and 64.");

  const guestKey = expandHome(raw.guestKey?.trim() || DEFAULT_KEY);
  const guestPub = `${guestKey}.pub`;
  const pveKey = raw.pveSshKey?.trim() ? expandHome(raw.pveSshKey.trim()) : findDefaultUserKey();
  const password = raw.pvePassword?.trim() || "";

  step("Ensuring guest SSH key…");
  await ensureKey(guestKey);

  const pve = makePveRunner(pveHost, pveKey, password);
  step(`Checking SSH to root@${pveHost}…`);
  const probe = await pve(["true"]);
  if (probe.code !== 0) {
    throw new Error(
      password
        ? `Cannot SSH to root@${pveHost} with the password (is sshpass installed? sudo dnf install sshpass). ${probe.output.slice(0, 300)}`
        : `Cannot SSH to root@${pveHost}. Copy a key once with: ssh-copy-id root@${pveHost}${pveKey ? ` -i ${pveKey}` : ""}. Or send pvePassword. ${probe.output.slice(0, 300)}`,
    );
  }

  step("Looking for a free VMID…");
  const vmid = raw.vmid ?? await pickVmid(pve);
  if (!Number.isInteger(vmid) || vmid < 100 || vmid > 999_999_999) throw new Error("vmid must be an integer ≥ 100.");

  const exists = await pve(["qm", "status", String(vmid)]);
  const config = exists.code === 0 ? await pve(["qm", "config", String(vmid)]) : { code: 1, output: "" };
  const existingName = /^name:\s*(.+)$/m.exec(config.output)?.[1]?.trim() ?? "";
  const listed = await pve(["qm", "list"]);
  const namedElsewhere = listed.output.split("\n").some((line) => {
    const parts = line.trim().split(/\s+/);
    return parts[0] !== String(vmid) && parts[1] === "rex-computer";
  });

  if (exists.code === 0 && existingName !== "rex-computer") {
    throw new Error(`VMID ${vmid} already exists as ${JSON.stringify(existingName || "?")}. Pick another id; Rex never modifies other VMs.`);
  }
  if (namedElsewhere) {
    throw new Error("A VM named rex-computer already exists on another VMID. Point .env at it instead of creating another.");
  }

  if (exists.code === 0 && existingName === "rex-computer") {
    step(`VM ${vmid} (rex-computer) already exists — finishing setup.`);
    if (!exists.output.includes("status: running")) {
      step("Starting VM…");
      await pve(["qm", "start", String(vmid)], 120_000);
    }
  } else {
    step(`Uploading create-vm.sh and SSH public key…`);
    await pveUpload(pveHost, pveKey, password, guestPub, "/root/rex_computer.pub");
    await pveUpload(pveHost, pveKey, password, path.join(SCRIPT_DIR, "create-vm.sh"), "/root/create-vm.sh");

    step(`Creating VM ${vmid} (this downloads the cloud image if needed)…`);
    const create = await pve([
      "env",
      `VMID=${vmid}`,
      `SSH_KEY_FILE=/root/rex_computer.pub`,
      `STORAGE=${storage}`,
      `BRIDGE=${bridge}`,
      `MEMORY=${memory}`,
      `CORES=${cores}`,
      `DISK=${disk}`,
      `IPCONFIG=${ipconfig}`,
      "bash", "/root/create-vm.sh",
    ], 600_000);
    if (create.code !== 0) throw new Error(`create-vm.sh failed:\n${create.output.slice(-2000)}`);
    log.push(...create.output.split("\n").slice(-8));
  }

  // Runtime token is always rex@pve!rex with rights only on this VMID.
  // Never keep a root@pam token in .env — bots never talk to Proxmox; the API only starts/stops this VM.
  step("Creating API token rex@pve!rex (only /vms/" + vmid + ")…");
  const token = await ensureToken(pve, vmid);

  const staticIp = parseGuestIp(ipconfig);
  step(staticIp ? `Waiting for SSH on ${staticIp}…` : "Waiting for the guest agent to report an IP…");
  const guestIp = staticIp ?? await waitForAgentIp(pve, vmid);
  await waitForSsh(guestIp, guestKey);

  const alreadyReady = await run("ssh", [
    "-i", guestKey, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
    "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=5",
    `rex@${guestIp}`, "--", "rex-sessiond", "ping",
  ], { timeoutMs: 20_000 });
  if (alreadyReady.code === 0 && alreadyReady.output.includes("ok")) {
    step("Guest already has rex-sessiond — skipping install.");
  } else {
    step("Installing desktop session manager inside the VM…");
    const install = await run("bash", [path.join(SCRIPT_DIR, "install-guest.sh"), guestIp, guestKey], { timeoutMs: 600_000 });
    if (install.code !== 0) throw new Error(`install-guest.sh failed:\n${install.output.slice(-2000)}`);
    log.push(...install.output.split("\n").slice(-6));
  }

  const values = {
    REX_COMPUTER_BACKEND: "proxmox",
    REX_PROXMOX_URL: `https://${pveHost}:8006`,
    REX_PROXMOX_NODE: node,
    REX_PROXMOX_VMID: String(vmid),
    REX_PROXMOX_VM_NAME: "rex-computer",
    REX_PROXMOX_TOKEN_ID: token.id,
    REX_PROXMOX_TOKEN_SECRET: token.secret,
    REX_PROXMOX_INSECURE_TLS: "1",
    REX_COMPUTER_SSH_HOST: guestIp,
    REX_COMPUTER_SSH_USER: "rex",
    REX_COMPUTER_SSH_KEY: guestKey.replace(os.homedir(), "~"),
  };

  if (raw.writeEnv !== false) {
    step(`Writing ${ENV_FILE}…`);
    mergeEnvFile(ENV_FILE, values);
  }
  applyEnv(values);

  step("Switching Rex Computer to the Proxmox backend…");
  const next = createComputer(process.env);
  replaceComputer(next);
  const status = await next.status();
  step(status.running ? "Rex Computer is up." : `Configured. Current status: ${status.detail}`);

  return { vmid, guestIp, tokenId: token.id, envPath: ENV_FILE, status, log };
}

function findDefaultUserKey(): string | undefined {
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    const file = path.join(os.homedir(), ".ssh", name);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

async function ensureKey(privateKey: string) {
  if (fs.existsSync(privateKey) && fs.existsSync(`${privateKey}.pub`)) return;
  fs.mkdirSync(path.dirname(privateKey), { recursive: true });
  const result = await run("ssh-keygen", ["-t", "ed25519", "-f", privateKey, "-N", "", "-C", "rex-computer"]);
  if (result.code !== 0) throw new Error(`ssh-keygen failed: ${result.output}`);
  fs.chmodSync(privateKey, 0o600);
}

/** Password SSH/SCP via pexpect so the UI does not need sshpass installed. */
async function runWithPassword(command: "ssh" | "scp", args: string[], password: string, timeoutMs: number): Promise<RunResult> {
  const script = [
    "import pexpect, sys",
    `child = pexpect.spawn(${JSON.stringify(command)}, ${JSON.stringify(args)}, encoding="utf-8", timeout=${Math.ceil(timeoutMs / 1000)})`,
    "child.logfile_read = sys.stdout",
    "try:",
    "  i = child.expect(['[Pp]assword:', pexpect.EOF, pexpect.TIMEOUT], timeout=30)",
    "  if i == 0:",
    `    child.sendline(${JSON.stringify(password)})`,
    "    child.expect(pexpect.EOF)",
    "except pexpect.EOF:",
    "  pass",
    "sys.stderr.write(str(child.exitstatus if child.exitstatus is not None else 1))",
  ].join("\n");
  const result = await run("python3", ["-c", script], { timeoutMs: timeoutMs + 10_000 });
  // pexpect prints remote output on stdout; exit code is on stderr from our script.
  const code = Number(/(\d+)\s*$/.exec(result.output)?.[1] ?? result.code);
  return { code: Number.isFinite(code) ? code : 1, output: result.output.replace(/\d+\s*$/, "").trim() };
}

function makePveRunner(host: string, key: string | undefined, password: string) {
  return async (remote: string[], timeoutMs = 120_000): Promise<RunResult> => {
    if (password) {
      return runWithPassword("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "PreferredAuthentications=password",
        "-o", "PubkeyAuthentication=no",
        "-o", "NumberOfPasswordPrompts=1",
        `root@${host}`, "--", ...remote,
      ], password, timeoutMs);
    }
    const args = [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "IdentitiesOnly=yes",
    ];
    if (key) args.push("-i", key);
    return run("ssh", [...args, `root@${host}`, "--", ...remote], { timeoutMs });
  };
}

async function pveUpload(host: string, key: string | undefined, password: string, local: string, remote: string) {
  if (password) {
    const result = await runWithPassword("scp", [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "PreferredAuthentications=password",
      "-o", "PubkeyAuthentication=no",
      local, `root@${host}:${remote}`,
    ], password, 120_000);
    if (result.code !== 0) throw new Error(`scp failed: ${result.output.slice(0, 500)}`);
    return;
  }
  const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "IdentitiesOnly=yes"];
  if (key) args.push("-i", key);
  const result = await run("scp", [...args, local, `root@${host}:${remote}`], { timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(`scp failed: ${result.output.slice(0, 500)}`);
}

async function pickVmid(pve: (remote: string[], timeoutMs?: number) => Promise<RunResult>) {
  const listed = await pve(["qm", "list"]);
  const used = new Set(
    listed.output.split("\n").slice(1).map((line) => Number(line.trim().split(/\s+/)[0])).filter((n) => Number.isInteger(n)),
  );
  for (let id = 180; id < 900; id++) if (!used.has(id)) return id;
  throw new Error("No free VMID between 180 and 899.");
}

async function ensureToken(pve: (remote: string[], timeoutMs?: number) => Promise<RunResult>, vmid: number) {
  // Proxmox 9: acl modify / token delete (not the older aclmod aliases).
  const added = await pve(["pveum", "role", "add", "RexComputer", "--privs", "VM.Audit,VM.PowerMgmt"]);
  if (added.code !== 0) await pve(["pveum", "role", "modify", "RexComputer", "--privs", "VM.Audit,VM.PowerMgmt"]);
  await pve(["pveum", "user", "add", "rex@pve"]);
  const acl = await pve(["pveum", "acl", "modify", `/vms/${vmid}`, "--users", "rex@pve", "--roles", "RexComputer"]);
  if (acl.code !== 0) throw new Error(`Could not scope token ACL to VM ${vmid}:\n${acl.output.slice(0, 500)}`);
  await pve(["pveum", "user", "token", "delete", "rex@pve", "rex"]);
  const created = await pve(["pveum", "user", "token", "add", "rex@pve", "rex", "--privsep", "0"]);
  if (created.code !== 0) throw new Error(`Could not create API token:\n${created.output.slice(0, 800)}`);
  const secret = created.output.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i)?.[1]
    ?? created.output.match(/\|\s*value\s*\|\s*([^\s|]+)\s*\|/i)?.[1];
  if (!secret) throw new Error(`Token created but secret not found in output:\n${created.output.slice(0, 800)}`);
  return { id: "rex@pve!rex", secret };
}

async function waitForAgentIp(pve: (remote: string[], timeoutMs?: number) => Promise<RunResult>, vmid: number) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await pve(["qm", "guest", "cmd", String(vmid), "network-get-interfaces"], 30_000);
    const ips = [...result.output.matchAll(/"ip-address"\s*:\s*"(\d+\.\d+\.\d+\.\d+)"/g)]
      .map((match) => match[1]!)
      .filter((ip) => ip !== "127.0.0.1");
    if (ips[0]) return ips[0];
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Guest agent did not report an IP. Set ipconfig to a static address (ip=192.168.100.50/24,gw=…) and try again.");
}

async function waitForSsh(host: string, key: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await run("ssh", [
      "-i", key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
      "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=5",
      `rex@${host}`, "--", "true",
    ], { timeoutMs: 20_000 });
    if (result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  throw new Error(`SSH to rex@${host} did not come up. Check cloud-init and the network.`);
}
