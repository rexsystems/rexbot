import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { VmPower, VmState } from "./desktop.js";

/**
 * Runs Rex Computer VMs directly with QEMU: no hypervisor manager, no root.
 *
 * Layout under the VM root (data/vms by default):
 *   images/            downloaded cloud images
 *   templates/         provisioned desktop images, one file per version, never modified after build
 *   template.json      the current template
 *   keys/rex_vm        SSH key the API uses for every guest
 *   machines/<name>/   disk.qcow2 (overlay on a template), seed.iso, vm.pid, qmp.sock, serial.log, known_hosts
 */

export const DEFAULT_BASE_IMAGE_URL = "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2";

export interface QemuMachineSpec {
  /** [a-z0-9-], unique per host. Also part of the QEMU process name. */
  name: string;
  sshPort: number;
  memoryMb: number;
  cores: number;
  diskGb: number;
  hostname: string;
  /** Changing it makes cloud-init treat the disk as a new machine. */
  instanceId: string;
  /** Backing image for a new disk. Ignored once the disk exists. */
  backingFile: string;
}

export interface TemplateInfo {
  version: number;
  file: string;
  builtAt: string;
  baseImage: string;
  sizeBytes: number;
}

export interface QemuHostInfo {
  qemu: string | null;
  qemuImg: string | null;
  isoTool: string | null;
  ssh: boolean;
  kvm: boolean;
  accel: "kvm" | "tcg";
  root: string;
  template: TemplateInfo | null;
  problems: string[];
}

export type LogFn = (line: string) => void;

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

function which(binary: string): string | null {
  const result = spawnSync("sh", ["-c", `command -v ${binary}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export function run(command: string, args: string[], options: { timeoutMs?: number; input?: string } = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-100_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim() }); });
    child.stdin.on("error", () => { /* The child may exit before reading stdin. */ });
    child.stdin.end(options.input ?? "");
  });
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Speaks just enough QMP (QEMU's JSON control protocol) for power commands. */
export function qmpCommand(socketPath: string, command: string, timeoutMs = 5_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    let negotiated = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`QMP ${command} timed out`)); }, timeoutMs);
    const finish = (error: Error | null, value?: unknown) => { clearTimeout(timer); socket.end(); if (error) reject(error); else resolve(value); };
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (message.QMP) { socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\n`); continue; }
        if (message.event) continue;
        if (!negotiated) {
          negotiated = true;
          socket.write(`${JSON.stringify({ execute: command })}\n`);
          continue;
        }
        if (message.error) return finish(new Error(JSON.stringify(message.error)));
        return finish(null, message.return);
      }
    });
  });
}

export class QemuHost {
  readonly root: string;
  private cached: { qemu: string | null; qemuImg: string | null; isoTool: string | null; ssh: boolean } | null = null;

  constructor(root: string, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.root = path.resolve(root);
  }

  get templatePath() { return path.join(this.root, "template.json"); }
  get keyPath() { return path.join(this.root, "keys", "rex_vm"); }
  machineDir(name: string) { return path.join(this.root, "machines", name); }

  private tools() {
    if (!this.cached) {
      this.cached = {
        qemu: this.env.REX_QEMU_BINARY?.trim() || which("qemu-system-x86_64"),
        qemuImg: this.env.REX_QEMU_IMG?.trim() || which("qemu-img"),
        isoTool: ["cloud-localds", "genisoimage", "mkisofs", "xorriso"].find((tool) => which(tool)) ?? null,
        ssh: Boolean(which("ssh") && which("ssh-keygen")),
      };
    }
    return this.cached;
  }

  kvmUsable(): boolean {
    if (this.env.REX_QEMU_ACCEL === "tcg") return false;
    try { fs.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; }
  }

  template(): TemplateInfo | null {
    try {
      const info = JSON.parse(fs.readFileSync(this.templatePath, "utf8")) as TemplateInfo;
      return fs.existsSync(path.join(this.root, info.file)) ? info : null;
    } catch { return null; }
  }

  info(): QemuHostInfo {
    const tools = this.tools();
    const kvm = this.kvmUsable();
    const problems: string[] = [];
    if (!tools.qemu) problems.push("qemu-system-x86_64 is not installed.");
    if (!tools.qemuImg) problems.push("qemu-img is not installed.");
    if (!tools.isoTool) problems.push("No cloud-init seed tool (cloud-localds, genisoimage or xorriso).");
    if (!tools.ssh) problems.push("The OpenSSH client (ssh, ssh-keygen) is not installed.");
    if (!kvm && this.env.REX_QEMU_ACCEL !== "tcg") problems.push("/dev/kvm is not usable by this user, so VMs run in slow software emulation. Add the user to the kvm group.");
    return { ...tools, kvm, accel: kvm ? "kvm" : "tcg", root: this.root, template: this.template(), problems };
  }

  /** Blocking problems only; missing KVM is slow but works. */
  missingTools(): string[] {
    return this.info().problems.filter((problem) => !problem.startsWith("/dev/kvm"));
  }

  async ensureKey(): Promise<{ privateKey: string; publicKey: string }> {
    const privateKey = this.keyPath;
    if (!fs.existsSync(privateKey)) {
      fs.mkdirSync(path.dirname(privateKey), { recursive: true, mode: 0o700 });
      const result = await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "rex-computer", "-f", privateKey]);
      if (result.code !== 0) throw new Error(`ssh-keygen failed: ${result.output}`);
    }
    return { privateKey, publicKey: fs.readFileSync(`${privateKey}.pub`, "utf8").trim() };
  }

  async img(args: string[], timeoutMs = 600_000) {
    const binary = this.tools().qemuImg;
    if (!binary) throw new Error("qemu-img is not installed.");
    const result = await run(binary, args, { timeoutMs });
    if (result.code !== 0) throw new Error(`qemu-img ${args[0]} failed: ${result.output.slice(-600)}`);
    return result.output;
  }

  /** Writes a NoCloud seed (volume label cidata) that cloud-init reads on boot. */
  async writeSeed(dir: string, files: { userData: string; metaData: string }) {
    const tool = this.tools().isoTool;
    if (!tool) throw new Error("Install cloud-image-utils, genisoimage or xorriso to create cloud-init seeds.");
    const staging = path.join(dir, "seed");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "user-data"), files.userData);
    fs.writeFileSync(path.join(staging, "meta-data"), files.metaData);
    const iso = path.join(dir, "seed.iso");
    const userData = path.join(staging, "user-data");
    const metaData = path.join(staging, "meta-data");
    const args = tool === "cloud-localds" ? [iso, userData, metaData]
      : tool === "xorriso" ? ["-as", "mkisofs", "-output", iso, "-volid", "cidata", "-joliet", "-rock", userData, metaData]
      : ["-output", iso, "-volid", "cidata", "-joliet", "-rock", userData, metaData];
    const result = await run(tool, args);
    if (result.code !== 0) throw new Error(`${tool} failed: ${result.output.slice(-400)}`);
    return iso;
  }

  qemuBinary(): string {
    const binary = this.tools().qemu;
    if (!binary) throw new Error("qemu-system-x86_64 is not installed. Run scripts/qemu/setup-host.sh.");
    return binary;
  }
}

export function cloudConfig(spec: { hostname: string; publicKey: string }): string {
  // JSON is valid YAML, which keeps quoting of the key and hostname safe.
  const config = {
    hostname: spec.hostname,
    manage_etc_hosts: true,
    ssh_pwauth: false,
    disable_root: true,
    users: [{ name: "rex", gecos: "Rex Computer", groups: ["sudo"], shell: "/bin/bash", sudo: "ALL=(ALL) NOPASSWD:ALL", lock_passwd: true, ssh_authorized_keys: [spec.publicKey] }],
    growpart: { mode: "auto", devices: ["/"] },
    resize_rootfs: true,
  };
  return `#cloud-config\n${JSON.stringify(config, null, 2)}\n`;
}

/** Socket paths are limited to ~108 bytes; long data directories fall back to the temp directory. */
function socketPath(dir: string, name: string) {
  const preferred = path.join(dir, "qmp.sock");
  if (preferred.length < 100) return preferred;
  return path.join(os.tmpdir(), `rex-qmp-${createHash("sha1").update(dir).digest("hex").slice(0, 12)}-${name}.sock`);
}

export class QemuMachine implements VmPower {
  readonly dir: string;
  private transition: Promise<void> | null = null;
  private transitionState: VmState | null = null;

  constructor(private readonly host: QemuHost, readonly spec: QemuMachineSpec) {
    if (!NAME.test(spec.name)) throw new Error(`Invalid VM name ${JSON.stringify(spec.name)}.`);
    this.dir = host.machineDir(spec.name);
  }

  get label() { return `QEMU VM ${this.spec.name}`; }
  get diskPath() { return path.join(this.dir, "disk.qcow2"); }
  get pidPath() { return path.join(this.dir, "vm.pid"); }
  get qmpPath() { return socketPath(this.dir, this.spec.name); }
  get serialPath() { return path.join(this.dir, "serial.log"); }
  get knownHostsPath() { return path.join(this.dir, "known_hosts"); }

  /** PID of this VM's QEMU process, verified by its process name so a reused PID is never signalled. */
  pid(): number | null {
    let pid: number;
    try { pid = Number(fs.readFileSync(this.pidPath, "utf8").trim()); } catch { return null; }
    if (!Number.isInteger(pid) || pid <= 1 || !alive(pid)) return null;
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmdline.includes(`process=rex-vm-${this.spec.name}`)) return null;
    } catch { /* No /proc (not Linux): trust the pidfile. */ }
    return pid;
  }

  async state(): Promise<VmState> {
    if (this.transitionState) return this.transitionState;
    if (this.pid()) return "running";
    return fs.existsSync(this.diskPath) ? "stopped" : "missing";
  }

  private serialize(state: VmState, work: () => Promise<void>): Promise<void> {
    if (this.transition) return this.transition;
    this.transitionState = state;
    this.transition = work().finally(() => { this.transition = null; this.transitionState = null; });
    return this.transition;
  }

  start(): Promise<void> {
    if (this.pid()) return Promise.resolve();
    return this.serialize("starting", () => this.boot());
  }

  private async boot() {
    fs.mkdirSync(this.dir, { recursive: true });
    const key = await this.host.ensureKey();
    if (!fs.existsSync(this.diskPath)) {
      if (!fs.existsSync(this.spec.backingFile)) throw new Error("The computer image is missing. An admin must build it first.");
      await this.host.img(["create", "-q", "-f", "qcow2", "-F", "qcow2", "-b", this.spec.backingFile, this.diskPath, `${this.spec.diskGb}G`]);
      fs.rmSync(this.knownHostsPath, { force: true });
    }
    await this.host.writeSeed(this.dir, {
      userData: cloudConfig({ hostname: this.spec.hostname, publicKey: key.publicKey }),
      metaData: `instance-id: ${this.spec.instanceId}\nlocal-hostname: ${this.spec.hostname}\n`,
    });
    fs.rmSync(this.pidPath, { force: true });
    fs.rmSync(this.qmpPath, { force: true });
    const kvm = this.host.kvmUsable();
    const args = [
      "-name", `rex-${this.spec.name},process=rex-vm-${this.spec.name}`,
      "-machine", `q35,accel=${kvm ? "kvm" : "tcg"}`,
      "-cpu", kvm ? "host" : "max",
      "-smp", String(this.spec.cores),
      "-m", String(this.spec.memoryMb),
      "-drive", `if=virtio,file=${this.diskPath},format=qcow2,discard=unmap,cache=writeback`,
      "-drive", `file=${path.join(this.dir, "seed.iso")},media=cdrom,readonly=on`,
      // User-mode networking: outbound internet through the host, only SSH reachable, and only from loopback.
      "-netdev", `user,id=net0,hostname=${this.spec.hostname},hostfwd=tcp:127.0.0.1:${this.spec.sshPort}-:22`,
      "-device", "virtio-net-pci,netdev=net0",
      "-device", "virtio-rng-pci",
      "-display", "none",
      "-serial", `file:${this.serialPath}`,
      "-qmp", `unix:${this.qmpPath},server=on,wait=off`,
      "-pidfile", this.pidPath,
      "-daemonize",
    ];
    const result = await run(this.host.qemuBinary(), args, { timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(`QEMU did not start: ${result.output.slice(-800) || `exit ${result.code}`}`);
    if (!this.pid()) throw new Error("QEMU exited right after starting. Check the serial log.");
  }

  stop(timeoutMs = 90_000): Promise<void> {
    if (!this.pid()) return Promise.resolve();
    return this.serialize("stopping", async () => {
      try { await qmpCommand(this.qmpPath, "system_powerdown"); } catch { /* Fall through to a hard stop. */ }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && this.pid()) await sleep(500);
      if (this.pid()) await this.kill();
    });
  }

  /** Immediate power-off, like pulling the plug. */
  async kill(): Promise<void> {
    const pid = this.pid();
    if (!pid) return;
    try { await qmpCommand(this.qmpPath, "quit", 2_000); } catch { /* QMP may be gone. */ }
    for (let attempt = 0; attempt < 20 && this.pid(); attempt++) await sleep(100);
    if (this.pid()) { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
    for (let attempt = 0; attempt < 20 && this.pid(); attempt++) await sleep(100);
  }

  /** Stops the VM and deletes its disk; the next start is a fresh machine from the current template. */
  async destroy(): Promise<void> {
    await this.kill();
    fs.rmSync(this.dir, { recursive: true, force: true });
    if (this.qmpPath.startsWith(os.tmpdir())) fs.rmSync(this.qmpPath, { force: true });
  }

  diskUsageBytes(): number {
    try { return fs.statSync(this.diskPath).blocks * 512; } catch { return 0; }
  }

  serialTail(bytes = 8_000): string {
    try {
      const size = fs.statSync(this.serialPath).size;
      const handle = fs.openSync(this.serialPath, "r");
      const buffer = Buffer.alloc(Math.min(bytes, size));
      fs.readSync(handle, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      fs.closeSync(handle);
      // Strip terminal escape sequences from the kernel/systemd console.
      return buffer.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    } catch { return ""; }
  }
}

export function sshArgs(machine: QemuMachine, privateKey: string) {
  return [
    "-p", String(machine.spec.sshPort),
    "-i", privateKey,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${machine.knownHostsPath}`,
  ];
}

export async function waitForSsh(machine: QemuMachine, privateKey: string, timeoutMs: number, log?: LogFn) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    if (!machine.pid()) throw new Error(`${machine.label} stopped while booting. Serial log:\n${machine.serialTail(2_000)}`);
    const result = await run("ssh", [...sshArgs(machine, privateKey), "rex@127.0.0.1", "--", "true"], { timeoutMs: 20_000 });
    if (result.code === 0) return;
    attempts++;
    if (log && attempts % 10 === 0) log(`Still waiting for SSH (${Math.round((timeoutMs - (deadline - Date.now())) / 1000)}s)…`);
    await sleep(3_000);
  }
  throw new Error(`SSH to ${machine.label} did not come up in time.`);
}

async function download(url: string, file: string, log: LogFn) {
  const sumsUrl = new URL("SHA512SUMS", url).toString();
  const name = path.basename(new URL(url).pathname);
  let expected: string | undefined;
  try {
    const sums = await fetch(sumsUrl, { signal: AbortSignal.timeout(30_000) });
    if (sums.ok) expected = (await sums.text()).split("\n").find((line) => line.trim().endsWith(` ${name}`))?.split(/\s+/)[0];
  } catch { /* Not every mirror publishes SHA512SUMS. */ }
  log(`Downloading ${url}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length") || 0);
  const hash = createHash("sha512");
  const part = `${file}.part`;
  const out = fs.createWriteStream(part);
  let received = 0;
  let nextReport = 0.1;
  for await (const chunk of Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    received += buffer.length;
    if (!out.write(buffer)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    if (total && received / total >= nextReport) { log(`Downloaded ${Math.round((received / total) * 100)}%`); nextReport += 0.1; }
  }
  await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
  const digest = hash.digest("hex");
  if (expected && digest !== expected) { fs.rmSync(part, { force: true }); throw new Error("The downloaded image failed its SHA512 check."); }
  log(expected ? "Checksum verified (SHA512)." : "No published checksum found; skipped verification.");
  fs.renameSync(part, file);
}

export interface TemplateBuildOptions {
  guestDir: string;
  baseImageUrl?: string;
  memoryMb?: number;
  cores?: number;
  sshPort: number;
  log: LogFn;
}

/**
 * Builds a new template: boots the cloud image once, installs the desktop stack inside it,
 * clears cloud-init state so each user VM initializes as a new machine, and stores the result.
 */
export async function buildTemplate(host: QemuHost, options: TemplateBuildOptions): Promise<TemplateInfo> {
  const { log } = options;
  const missing = host.missingTools();
  if (missing.length) throw new Error(missing.join(" "));
  const url = options.baseImageUrl || DEFAULT_BASE_IMAGE_URL;
  const imageFile = path.join(host.root, "images", path.basename(new URL(url).pathname));
  fs.mkdirSync(path.dirname(imageFile), { recursive: true });
  if (!fs.existsSync(imageFile)) await download(url, imageFile, log);
  else log(`Using cached ${path.basename(imageFile)}.`);

  const builder = new QemuMachine(host, {
    name: "template-builder",
    sshPort: options.sshPort,
    memoryMb: options.memoryMb ?? 4096,
    cores: options.cores ?? Math.max(1, Math.min(4, os.cpus().length)),
    diskGb: 16,
    hostname: "rex-template",
    instanceId: `rex-template-${Date.now()}`,
    backingFile: imageFile,
  });
  await builder.destroy();
  const key = await host.ensureKey();
  try {
    log(`Booting the builder VM (${host.kvmUsable() ? "KVM" : "software emulation, this is slow"})…`);
    await builder.start();
    await waitForSsh(builder, key.privateKey, host.kvmUsable() ? 300_000 : 1_200_000, log);
    log("SSH is up. Copying guest files…");
    const ssh = [...sshArgs(builder, key.privateKey)];
    const target = "rex@127.0.0.1";
    const prepare = await run("ssh", [...ssh, target, "--", "rm -rf /tmp/rex-setup && mkdir -p /tmp/rex-setup"]);
    if (prepare.code !== 0) throw new Error(prepare.output);
    const files = fs.readdirSync(options.guestDir).filter((file) => !file.startsWith(".") && !file.endsWith(".md")).map((file) => path.join(options.guestDir, file));
    const scpArgs = ["-P", String(builder.spec.sshPort), ...ssh.filter((_, index) => index > 1), ...files, `${target}:/tmp/rex-setup/`];
    const copy = await run("scp", scpArgs);
    if (copy.code !== 0) throw new Error(`scp failed: ${copy.output}`);
    log("Installing the desktop (Xvfb, Openbox, noVNC, Chromium…). This takes several minutes…");
    const setup = await run("ssh", [...ssh, target, "--", "sudo bash /tmp/rex-setup/guest-setup.sh"], { timeoutMs: 3_600_000 });
    for (const line of setup.output.split("\n").slice(-6)) log(line);
    if (setup.code !== 0) throw new Error(`Guest setup failed (exit ${setup.code}).`);
    log("Cleaning machine identity so each user VM boots as a new machine…");
    await run("ssh", [...ssh, target, "--", "sudo cloud-init clean --logs --machine-id && sudo rm -f /etc/ssh/ssh_host_* && sudo rm -rf /tmp/rex-setup && sudo fstrim -av || true"], { timeoutMs: 120_000 });
    await run("ssh", [...ssh, target, "--", "sudo systemctl poweroff"], { timeoutMs: 20_000 });
    const deadline = Date.now() + 180_000;
    while (builder.pid() && Date.now() < deadline) await sleep(1_000);
    if (builder.pid()) await builder.kill();

    const previous = host.template();
    const version = (previous?.version ?? 0) + 1;
    const file = path.join("templates", `rex-desktop-v${version}.qcow2`);
    fs.mkdirSync(path.join(host.root, "templates"), { recursive: true });
    log("Compacting the image…");
    await host.img(["convert", "-q", "-O", "qcow2", "-c", builder.diskPath, path.join(host.root, file)], 3_600_000);
    const info: TemplateInfo = { version, file, builtAt: new Date().toISOString(), baseImage: path.basename(imageFile), sizeBytes: fs.statSync(path.join(host.root, file)).size };
    fs.writeFileSync(host.templatePath, `${JSON.stringify(info, null, 2)}\n`);
    log(`Template v${version} is ready.`);
    return info;
  } finally {
    await builder.destroy();
  }
}
