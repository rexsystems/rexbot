import { spawn } from "node:child_process";
import type { ComputerResult, ComputerStatus } from "@rex/shared";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { DesktopComputer } from "./computer/desktop.js";
import { buildTemplate, QemuHost, QemuMachine, type TemplateInfo } from "./computer/qemu.js";
import { sshRunner, tunnelOpener } from "./computer/ssh.js";
import { dataDirectory, db, nowIso } from "./db.js";
import { getAppSettings } from "./appSettings.js";
import { ensureEgressProxy, GUEST_PROXY } from "./computer/egress.js";

const IMAGE = "docker.io/library/python:3.13-alpine";
const LABEL = "app.rex.computer";
const OUTPUT_LIMIT = 32_000;

function podman(args: string[], timeout = 15_000): Promise<{ code: number; output: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("podman", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CONTAINER_HOST: undefined, CONTAINER_CONNECTION: undefined } });
    let output = "";
    let timedOut = false;
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(0, OUTPUT_LIMIT); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim(), timedOut }); });
  });
}

export class RexComputer {
  readonly kind = "podman" as const;
  readonly desktop = false;
  private busy = false;
  private changing = false;
  constructor(private readonly name = "rex-computer-v1") {}

  private async inspect() {
    const result = await podman(["container", "inspect", this.name]);
    if (result.code !== 0) return null;
    const container = JSON.parse(result.output)[0];
    if (container?.Config?.Labels?.[LABEL] !== "v1") throw new Error("Container name belongs to another application.");
    return container;
  }

  async status(): Promise<ComputerStatus> {
    try {
      const info = await podman(["info", "--format", "json"]);
      const host = info.code === 0 ? JSON.parse(info.output).host : null;
      if (!host?.security?.rootless || !host?.security?.seccompEnabled || host?.cgroupVersion !== "v2") {
        return { backend: this.kind, desktop: false, available: false, running: false, busy: false, imageReady: false, detail: "Rootless Podman with seccomp and cgroup v2 is required. On Fedora: sudo dnf install podman" };
      }
      const [container, image] = await Promise.all([this.inspect(), podman(["image", "exists", IMAGE])]);
      return { backend: this.kind, desktop: false, available: true, running: Boolean(container?.State?.Running), busy: this.busy || this.changing, imageReady: image.code === 0, detail: "Python 3 · Alpine Linux · no network · temporary workspace" };
    } catch (err) {
      return { backend: this.kind, desktop: false, available: false, running: false, busy: false, imageReady: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async start(): Promise<ComputerStatus> {
    if (this.changing || this.busy) throw new Error("Rex Computer is busy.");
    this.changing = true;
    try {
      const status = await this.status();
      if (!status.available) throw new Error(status.detail);
      if (!status.imageReady) throw new Error(`Image missing. Run: podman pull ${IMAGE}`);
      if (status.running) return status;
      if (await this.inspect()) await this.remove();
      const result = await podman([
        "run", "--detach", "--pull=never", "--name", this.name, "--label", `${LABEL}=v1`,
        "--network=none", "--read-only", "--read-only-tmpfs=false",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=1000:1000",
        "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64",
        "--ulimit=nofile=256:256", "--ulimit=core=0:0", "--ipc=private", "--shm-size=16m",
        "--tmpfs=/workspace:rw,nosuid,nodev,size=128m,mode=1777",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777",
        "--workdir=/workspace", "--env=HOME=/workspace", "--env=PYTHONDONTWRITEBYTECODE=1",
        "--log-driver=none", "--timeout=3600", IMAGE, "sleep", "3600",
      ]);
      if (result.code !== 0) throw new Error(result.output || "Container could not start.");
    } finally { this.changing = false; }
    return this.status();
  }

  private async remove() {
    const result = await podman(["rm", "--force", "--time=0", this.name]);
    if (result.code !== 0) throw new Error(result.output || "Container could not stop.");
  }

  async stop(): Promise<ComputerStatus> {
    if (this.changing) throw new Error("Rex Computer is changing state. Try again shortly.");
    this.changing = true;
    try { if (await this.inspect()) await this.remove(); }
    finally { this.changing = false; }
    return this.status();
  }

  async execute(command: string, _botId?: string): Promise<ComputerResult> {
    if (typeof command !== "string" || !command.trim() || command.length > 8_000 || command.includes("\0")) throw new Error("Command must contain 1 to 8000 characters.");
    if (this.busy || this.changing) throw new Error("Rex Computer is busy.");
    this.busy = true;
    try {
      if (!(await this.inspect())?.State?.Running) throw new Error("Rex Computer is off. The user must start it in the Computer panel first.");
      // The shell is an argument to container exec, never a shell on the host.
      const result = await podman(["exec", "--workdir=/workspace", this.name, "/bin/sh", "-c", command], 20_000);
      // Killing the CLI alone leaves container processes alive; remove the container too.
      if (result.timedOut && await this.inspect()) await this.remove();
      return { command, output: result.output || "(no output)", exitCode: result.code, timedOut: result.timedOut };
    } finally { this.busy = false; }
  }
}

/** Stands in when a backend cannot run, so the API still starts and explains why. */
export class UnavailableComputer {
  readonly desktop = false;
  constructor(readonly kind: ComputerStatus["backend"] & string, private readonly reason: string, private readonly setupNeeded = false) {}
  async status(): Promise<ComputerStatus> {
    return { backend: this.kind, desktop: this.kind === "qemu", available: false, running: false, busy: false, imageReady: false, setupNeeded: this.setupNeeded, detail: this.reason };
  }
  async start(): Promise<ComputerStatus> { throw new Error(this.reason); }
  async stop(): Promise<ComputerStatus> { throw new Error(this.reason); }
  async execute(_command: string, _botId?: string): Promise<ComputerResult> { throw new Error(this.reason); }
}

export type ComputerBackend = RexComputer | DesktopComputer | UnavailableComputer;

export function isDesktopComputer(backend: ComputerBackend): backend is DesktopComputer {
  return backend instanceof DesktopComputer;
}

const GUEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/guest");
const SSH_PORT_BASE = 22_200;

interface VmRow {
  owner_id: string;
  name: string;
  ssh_port: number;
  memory_mb: number;
  cores: number;
  disk_gb: number;
  instance_id: string;
  template_version: number | null;
  created_at: string;
  last_started_at: string | null;
}

export interface VmSummary {
  ownerId: string;
  name: string;
  state: string;
  sshPort: number;
  memoryMb: number;
  cores: number;
  diskGb: number;
  diskUsedBytes: number;
  templateVersion: number | null;
  createdAt: string;
  lastStartedAt: string | null;
}

export interface TemplateBuildState {
  running: boolean;
  log: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function freeSshPort(taken: Set<number>) {
  for (let port = SSH_PORT_BASE; port < SSH_PORT_BASE + 5_000; port++) {
    if (!taken.has(port) && await portFree(port)) return port;
  }
  throw new Error("No free loopback port for VM SSH forwarding.");
}

function vmName(ownerId: string) {
  return `u-${ownerId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "owner"}-${Math.abs(hashCode(ownerId)).toString(36).slice(0, 5)}`;
}

function hashCode(value: string) {
  let hash = 0;
  for (const char of value) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  return hash;
}

/**
 * Hands every account its own computer. With QEMU that is a personal VM where each of the
 * owner's bots gets a screen; with Podman it is a per-owner offline container.
 */
export class ComputerFleet {
  readonly kind: "qemu" | "podman";
  readonly host: QemuHost;
  private readonly computers = new Map<string, ComputerBackend>();
  private template: TemplateInfo | null;
  private build: TemplateBuildState = { running: false, log: [], error: null, startedAt: null, finishedAt: null };
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.host = new QemuHost(env.REX_VM_DIR?.trim() ? path.resolve(env.REX_VM_DIR) : path.join(dataDirectory(), "vms"), env);
    const requested = env.REX_COMPUTER_BACKEND?.trim();
    if (requested && requested !== "qemu" && requested !== "podman") throw new Error(`Unknown REX_COMPUTER_BACKEND ${JSON.stringify(requested)}. Use qemu or podman.`);
    this.kind = requested === "podman" ? "podman" : "qemu";
    this.template = this.host.template();
  }

  get desktop() { return this.kind === "qemu"; }

  forOwner(ownerId: string): ComputerBackend {
    const cached = this.computers.get(ownerId);
    if (cached && !(cached instanceof UnavailableComputer)) return cached;
    if (this.kind === "podman") {
      const computer = new RexComputer(`rex-computer-${ownerId.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 40)}`);
      this.computers.set(ownerId, computer);
      return computer;
    }
    const missing = this.host.missingTools();
    if (missing.length) return new UnavailableComputer("qemu", `QEMU is not ready on this server: ${missing.join(" ")} Run scripts/qemu/setup-host.sh.`);
    const row = this.row(ownerId);
    if (!this.template && !row) return new UnavailableComputer("qemu", this.build.running ? "The computer image is being built. This takes a few minutes the first time." : "The computer image has not been built yet. An admin can build it in Admin → Computers.", true);
    const computer = this.desktopFor(row ?? this.createRow(ownerId));
    this.computers.set(ownerId, computer);
    return computer;
  }

  private row(ownerId: string) {
    return db.prepare("SELECT * FROM vms WHERE owner_id = ?").get(ownerId) as VmRow | undefined;
  }

  private createRow(ownerId: string): VmRow {
    const settings = getAppSettings();
    const taken = new Set((db.prepare("SELECT ssh_port FROM vms").all() as Array<{ ssh_port: number }>).map((entry) => entry.ssh_port));
    // Ports are checked for availability lazily at boot; the table keeps them unique.
    let port = SSH_PORT_BASE;
    while (taken.has(port)) port++;
    const row: VmRow = {
      owner_id: ownerId, name: vmName(ownerId), ssh_port: port, memory_mb: settings.vmMemoryMb, cores: settings.vmCores, disk_gb: settings.vmDiskGb,
      instance_id: `rex-${nanoid(10)}`, template_version: this.template?.version ?? null, created_at: nowIso(), last_started_at: null,
    };
    db.prepare(`INSERT INTO vms (owner_id, name, ssh_port, memory_mb, cores, disk_gb, instance_id, template_version, created_at, last_started_at)
      VALUES (@owner_id, @name, @ssh_port, @memory_mb, @cores, @disk_gb, @instance_id, @template_version, @created_at, @last_started_at)`).run(row);
    return row;
  }

  machine(row: VmRow): QemuMachine {
    const templateFile = row.template_version ? path.join(this.host.root, "templates", `rex-desktop-v${row.template_version}.qcow2`) : "";
    const backingFile = fs.existsSync(templateFile) ? templateFile : this.template ? path.join(this.host.root, this.template.file) : templateFile;
    return new QemuMachine(this.host, {
      name: row.name, sshPort: row.ssh_port, memoryMb: row.memory_mb, cores: row.cores, diskGb: row.disk_gb,
      hostname: "rex-computer", instanceId: row.instance_id, backingFile,
    });
  }

  private desktopFor(row: VmRow): DesktopComputer {
    const machine = this.machine(row);
    const fleet = this;
    const power = {
      label: "Your Rex Computer",
      async state() {
        await ensureEgressProxy();
        return machine.networkRestricted() ? machine.state() : "stopped" as const;
      },
      async start() {
        await fleet.ensureCapacity(row.owner_id);
        if (machine.pid() && !machine.networkRestricted()) await machine.stop();
        if (!fs.existsSync(machine.diskPath)) {
          // A new disk always uses the newest template.
          const template = fleet.template;
          if (!template) throw new Error("The computer image has not been built yet.");
          db.prepare("UPDATE vms SET template_version = ? WHERE owner_id = ?").run(template.version, row.owner_id);
          (machine.spec as { backingFile: string }).backingFile = path.join(fleet.host.root, template.file);
        }
        if (!await portFree(row.ssh_port)) {
          const port = await freeSshPort(new Set((db.prepare("SELECT ssh_port FROM vms").all() as Array<{ ssh_port: number }>).map((entry) => entry.ssh_port)));
          db.prepare("UPDATE vms SET ssh_port = ? WHERE owner_id = ?").run(port, row.owner_id);
          (machine.spec as { sshPort: number }).sshPort = port;
          ssh.port = port;
        }
        await machine.start();
        db.prepare("UPDATE vms SET last_started_at = ? WHERE owner_id = ?").run(nowIso(), row.owner_id);
      },
      stop: () => machine.stop(),
    };
    const ssh = { host: "127.0.0.1", user: "rex", port: row.ssh_port, keyFile: this.host.keyPath, knownHostsFile: machine.knownHostsPath };
    const kvm = this.host.kvmUsable();
    return new DesktopComputer(power, (args, input, timeout) => sshRunner(ssh)(["env", `http_proxy=${GUEST_PROXY}`, `https_proxy=${GUEST_PROXY}`, `HTTP_PROXY=${GUEST_PROXY}`, `HTTPS_PROXY=${GUEST_PROXY}`, "no_proxy=localhost,127.0.0.1", `CHROMIUM_FLAGS=--proxy-server=${GUEST_PROXY}`, ...args], input, timeout), (local, remote) => tunnelOpener(ssh)(local, remote), { bootTimeoutMs: kvm ? 240_000 : 900_000 });
  }

  /** Refuses to boot past the admin's limit on running VMs. */
  private async ensureCapacity(ownerId: string) {
    const limit = getAppSettings().vmMaxRunning;
    let running = 0;
    for (const row of db.prepare("SELECT * FROM vms WHERE owner_id != ?").all(ownerId) as VmRow[]) {
      if (this.machine(row).pid()) running++;
    }
    if (running >= limit) throw new Error(`The server is already running ${running} computers, its limit. Try again later or ask an admin to raise it.`);
  }

  list(): VmSummary[] {
    return (db.prepare("SELECT * FROM vms ORDER BY created_at").all() as VmRow[]).map((row) => {
      const machine = this.machine(row);
      return {
        ownerId: row.owner_id, name: row.name, state: machine.pid() ? "running" : fs.existsSync(machine.diskPath) ? "stopped" : "missing",
        sshPort: row.ssh_port, memoryMb: row.memory_mb, cores: row.cores, diskGb: row.disk_gb, diskUsedBytes: machine.diskUsageBytes(),
        templateVersion: row.template_version, createdAt: row.created_at, lastStartedAt: row.last_started_at,
      };
    });
  }

  /** Finds the screen behind a noVNC view token across every owner's computer. */
  resolveView(token: string) {
    for (const computer of this.computers.values()) {
      if (computer instanceof DesktopComputer) {
        const view = computer.resolveView(token);
        if (view) return view;
      }
    }
    return null;
  }

  serialLog(ownerId: string) {
    const row = this.row(ownerId);
    return row ? this.machine(row).serialTail(16_000) : "";
  }

  async stopOwner(ownerId: string, force = false) {
    const computer = this.computers.get(ownerId);
    const row = this.row(ownerId);
    if (!row) return;
    if (!force && computer instanceof DesktopComputer) { await computer.stop(); return; }
    await this.machine(row).kill();
    this.computers.delete(ownerId);
  }

  /** Deletes the VM and its disk. The owner gets a fresh one from the newest template next time. */
  async destroyOwner(ownerId: string) {
    const row = this.row(ownerId);
    this.computers.delete(ownerId);
    if (this.kind === "podman") return;
    if (row) await this.machine(row).destroy();
    db.prepare("DELETE FROM vms WHERE owner_id = ?").run(ownerId);
  }

  /** Applies new CPU/RAM limits to a VM; they take effect on its next boot. */
  resize(ownerId: string, spec: { memoryMb?: number; cores?: number; diskGb?: number }) {
    const row = this.row(ownerId);
    if (!row) throw new Error("This user has no computer yet.");
    const memory = spec.memoryMb ?? row.memory_mb;
    const cores = spec.cores ?? row.cores;
    const disk = Math.max(row.disk_gb, spec.diskGb ?? row.disk_gb);
    db.prepare("UPDATE vms SET memory_mb = ?, cores = ?, disk_gb = ? WHERE owner_id = ?").run(memory, cores, disk, ownerId);
    this.computers.delete(ownerId);
  }

  templateInfo() {
    return { host: this.host.info(), template: this.template, build: this.build };
  }

  buildTemplate(baseImageUrl?: string): TemplateBuildState {
    if (this.build.running) return this.build;
    this.build = { running: true, log: [], error: null, startedAt: nowIso(), finishedAt: null };
    const state = this.build;
    const log = (line: string) => { state.log.push(`${new Date().toTimeString().slice(0, 8)} ${line}`); if (state.log.length > 400) state.log.splice(0, state.log.length - 400); };
    void (async () => {
      try {
        const port = await freeSshPort(new Set((db.prepare("SELECT ssh_port FROM vms").all() as Array<{ ssh_port: number }>).map((entry) => entry.ssh_port)));
        this.template = await buildTemplate(this.host, { guestDir: GUEST_DIR, baseImageUrl, sshPort: port, log });
        // Computers waiting for the first image can be created now.
        for (const [owner, computer] of this.computers) if (computer instanceof UnavailableComputer) this.computers.delete(owner);
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        log(`Failed: ${state.error}`);
      } finally {
        state.running = false;
        state.finishedAt = nowIso();
      }
    })();
    return state;
  }

  /** Powers off VMs nobody has used for the configured idle time. */
  startIdleWatch(intervalMs = 60_000) {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const minutes = getAppSettings().vmIdleMinutes;
      if (!minutes) return;
      for (const computer of this.computers.values()) {
        if (computer instanceof DesktopComputer && computer.isIdle(minutes * 60_000)) {
          void computer.vm.state().then((state) => { if (state === "running") return computer.stop(); }).catch(() => undefined);
        }
      }
    }, intervalMs);
    this.idleTimer.unref?.();
  }
}

export const computers = new ComputerFleet();
