import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { COMPUTER_INPUT_ACTIONS, type ComputerInputAction, type ComputerResult, type ComputerSession, type ComputerSessionState, type ComputerStatus } from "@rex/shared";
import type { PveClient } from "./pve.js";
import type { SshRunner, TunnelOpener } from "./ssh.js";

const BOT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Manual commands from the panel without a bot run in the shared folder. */
export const OWNER_SESSION = "owner";

export interface ProxmoxComputerOptions {
  tunnelBasePort?: number;
  lockIdleMs?: number;
  bootTimeoutMs?: number;
  viewTokenMs?: number;
  execTimeoutMs?: number;
  pollMs?: number;
}

interface GuestSession {
  botId: string;
  slot: number;
  display: string;
  wsPort: number;
  width: number;
  height: number;
  locked: boolean;
}

interface ViewToken {
  botId: string;
  localPort: number;
  expires: number;
}

function assertBotId(botId: string) {
  if (!BOT_ID.test(botId)) throw new Error("Invalid bot id for Rex Computer.");
}

function parseJson<T>(output: string, what: string): T {
  const line = output.split("\n").reverse().find((entry) => entry.trim().startsWith("{"));
  if (!line) throw new Error(`Rex Computer returned no ${what}: ${output.slice(0, 300) || "empty output"}`);
  try { return JSON.parse(line) as T; } catch { throw new Error(`Rex Computer returned invalid ${what}.`); }
}

export function validateInput(value: unknown): ComputerInputAction {
  if (!value || typeof value !== "object") throw new Error("computer_input needs an action object.");
  const input = value as Record<string, unknown>;
  if (!COMPUTER_INPUT_ACTIONS.includes(input.action as ComputerInputAction["action"])) throw new Error(`action must be one of ${COMPUTER_INPUT_ACTIONS.join(", ")}.`);
  const action = input.action as ComputerInputAction["action"];
  const result: ComputerInputAction = { action };
  const coordinate = (key: "x" | "y", max: number) => {
    const raw = input[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > max) throw new Error(`${key} must be a pixel between 0 and ${max}.`);
    return Math.round(raw);
  };
  result.x = coordinate("x", 7680);
  result.y = coordinate("y", 4320);
  if (["move", "click", "double_click", "right_click"].includes(action) && (result.x === undefined) !== (result.y === undefined)) throw new Error("Provide both x and y, or neither to use the current pointer position.");
  if (action === "move" && result.x === undefined) throw new Error("move needs x and y.");
  if (action === "type") {
    if (typeof input.text !== "string" || !input.text.length || input.text.length > 2000 || input.text.includes("\0")) throw new Error("type needs text of 1-2000 characters.");
    result.text = input.text;
  }
  if (action === "key") {
    if (typeof input.keys !== "string" || !/^[A-Za-z0-9_+\- ]{1,80}$/.test(input.keys)) throw new Error("key needs an xdotool combo like ctrl+l or Return.");
    result.keys = input.keys.trim();
  }
  if (action === "scroll") {
    result.direction = input.direction === "up" ? "up" : "down";
    const amount = typeof input.amount === "number" ? Math.round(input.amount) : 3;
    result.amount = Math.min(20, Math.max(1, amount));
  }
  return result;
}

export class ProxmoxComputer {
  readonly kind = "proxmox" as const;
  readonly desktop = true;
  private readonly sessions = new Map<string, GuestSession>();
  private readonly tunnels = new Map<number, ChildProcess>();
  private readonly viewTokens = new Map<string, ViewToken>();
  private readonly lockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly busyBots = new Set<string>();
  private booting: Promise<void> | null = null;
  private stopping = false;
  private readonly options: Required<ProxmoxComputerOptions>;

  constructor(
    private readonly pve: PveClient,
    private readonly ssh: SshRunner,
    private readonly openTunnel: TunnelOpener,
    options: ProxmoxComputerOptions = {},
  ) {
    this.options = {
      tunnelBasePort: options.tunnelBasePort ?? 46080,
      lockIdleMs: options.lockIdleMs ?? 60_000,
      bootTimeoutMs: options.bootTimeoutMs ?? 150_000,
      viewTokenMs: options.viewTokenMs ?? 30 * 60_000,
      execTimeoutMs: options.execTimeoutMs ?? 310_000,
      pollMs: options.pollMs ?? 3_000,
    };
  }

  private async guest(args: string[], input?: string, timeoutMs = 20_000) {
    const result = await this.ssh(["rex-sessiond", ...args], input, timeoutMs);
    if (result.timedOut) throw new Error(`Rex Computer did not answer ${args[0]} in time.`);
    return result;
  }

  private async guestReady(): Promise<boolean> {
    try {
      const result = await this.guest(["ping"], undefined, 10_000);
      return result.code === 0 && result.output.includes("ok");
    } catch { return false; }
  }

  async status(): Promise<ComputerStatus> {
    const base = { backend: this.kind, desktop: this.desktop, imageReady: true, busy: this.busyBots.size > 0 || Boolean(this.booting) };
    try {
      const vm = await this.pve.status();
      const vmRunning = vm.status === "running";
      const guestReady = vmRunning ? await this.guestReady() : false;
      const detail = !vmRunning ? `VM ${this.pve.config.vmid} is ${vm.status}. Start it to give bots their screens.`
        : guestReady ? `Proxmox VM ${this.pve.config.vmid} · shared by all bots · one screen per bot`
        : "The VM is on but rex-sessiond is not answering over SSH yet. It may still be booting.";
      return { ...base, available: true, running: vmRunning && guestReady, vmState: vm.status, guestReady, detail };
    } catch (error) {
      return { ...base, available: false, running: false, guestReady: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Starts the VM through Proxmox if needed and waits until the guest answers over SSH. */
  async ensureRunning(): Promise<void> {
    if (this.stopping) throw new Error("Rex Computer is shutting down. Try again shortly.");
    if (this.booting) return this.booting;
    this.booting = (async () => {
      const vm = await this.pve.status();
      if (vm.status !== "running") await this.pve.start();
      else if (await this.guestReady()) return;
      const deadline = Date.now() + this.options.bootTimeoutMs;
      while (Date.now() < deadline) {
        if (await this.guestReady()) return;
        await new Promise((resolve) => setTimeout(resolve, this.options.pollMs));
      }
      throw new Error("Rex Computer VM started, but rex-sessiond did not answer over SSH. Check the VM network and SSH key.");
    })().finally(() => { this.booting = null; });
    return this.booting;
  }

  async start(): Promise<ComputerStatus> {
    await this.ensureRunning();
    return this.status();
  }

  async stop(): Promise<ComputerStatus> {
    // The shared desktop stays on. Power-off only from Proxmox if you really need it.
    throw new Error("Rex Computer stays on. There is no shut down from the app.");
  }

  private reset() {
    for (const timer of this.lockTimers.values()) clearTimeout(timer);
    this.lockTimers.clear();
    for (const tunnel of this.tunnels.values()) tunnel.kill();
    this.tunnels.clear();
    this.viewTokens.clear();
    this.sessions.clear();
  }

  private ensureTunnel(session: GuestSession): number {
    const localPort = this.options.tunnelBasePort + session.slot;
    const existing = this.tunnels.get(localPort);
    if (existing && existing.exitCode === null && !existing.killed) return localPort;
    const tunnel = this.openTunnel(localPort, session.wsPort);
    tunnel.on("exit", () => { if (this.tunnels.get(localPort) === tunnel) this.tunnels.delete(localPort); });
    this.tunnels.set(localPort, tunnel);
    return localPort;
  }

  private viewTokenFor(botId: string, localPort: number): string {
    const now = Date.now();
    for (const [token, view] of this.viewTokens) {
      if (view.expires < now) this.viewTokens.delete(token);
      else if (view.botId === botId && view.localPort === localPort) { view.expires = now + this.options.viewTokenMs; return token; }
    }
    const token = randomBytes(18).toString("base64url");
    this.viewTokens.set(token, { botId, localPort, expires: now + this.options.viewTokenMs });
    return token;
  }

  /** Port of the local SSH tunnel that serves this token's noVNC, or null if unknown/expired. */
  resolveView(token: string): { botId: string; localPort: number } | null {
    const view = this.viewTokens.get(token);
    if (!view) return null;
    if (view.expires < Date.now()) { this.viewTokens.delete(token); return null; }
    return { botId: view.botId, localPort: view.localPort };
  }

  private toSession(session: GuestSession, token: string): ComputerSession {
    const query = new URLSearchParams({ autoconnect: "1", reconnect: "1", scale: "true", path: `computer/vnc/${token}/websockify`, view_only: session.locked ? "1" : "0" });
    return { botId: session.botId, slot: session.slot, display: session.display, width: session.width, height: session.height, locked: session.locked, viewPath: `/computer/vnc/${token}/vnc_lite.html?${query}` };
  }

  private async ensureGuestSession(botId: string): Promise<GuestSession> {
    assertBotId(botId);
    await this.ensureRunning();
    const result = await this.guest(["ensure", botId], undefined, 30_000);
    if (result.code !== 0) throw new Error(result.output || "Rex Computer could not open a screen for this bot.");
    const session = parseJson<GuestSession>(result.output, "session");
    if (!Number.isInteger(session.slot) || !Number.isInteger(session.wsPort)) throw new Error("Rex Computer returned an invalid session.");
    session.locked = Boolean(session.locked) || this.lockTimers.has(botId);
    this.sessions.set(botId, session);
    return session;
  }

  async session(botId: string): Promise<ComputerSession> {
    const session = await this.ensureGuestSession(botId);
    const localPort = this.ensureTunnel(session);
    return this.toSession(session, this.viewTokenFor(botId, localPort));
  }

  sessionState(botId: string): ComputerSessionState {
    assertBotId(botId);
    return { botId, locked: this.lockTimers.has(botId) };
  }

  async lock(botId: string): Promise<ComputerSessionState> {
    assertBotId(botId);
    if (!this.lockTimers.has(botId)) {
      const result = await this.guest(["lock", botId]);
      if (result.code !== 0) throw new Error(result.output || "Could not lock the screen.");
    } else clearTimeout(this.lockTimers.get(botId));
    const timer = setTimeout(() => { void this.unlock(botId).catch(() => { /* The VM may be off; the lock is local state. */ }); }, this.options.lockIdleMs);
    timer.unref?.();
    this.lockTimers.set(botId, timer);
    const session = this.sessions.get(botId);
    if (session) session.locked = true;
    return { botId, locked: true };
  }

  async unlock(botId: string): Promise<ComputerSessionState> {
    assertBotId(botId);
    const timer = this.lockTimers.get(botId);
    if (timer) clearTimeout(timer);
    this.lockTimers.delete(botId);
    const session = this.sessions.get(botId);
    if (session) session.locked = false;
    const result = await this.guest(["unlock", botId]);
    if (result.code !== 0) throw new Error(result.output || "Could not unlock the screen.");
    return { botId, locked: false };
  }

  private async withBot<T>(botId: string, work: () => Promise<T>): Promise<T> {
    assertBotId(botId);
    if (this.busyBots.has(botId)) throw new Error("This bot is already using Rex Computer. Wait for its current command to finish.");
    this.busyBots.add(botId);
    try { return await work(); } finally { this.busyBots.delete(botId); }
  }

  async execute(command: string, botId = OWNER_SESSION): Promise<ComputerResult> {
    if (typeof command !== "string" || !command.trim() || command.length > 8_000 || command.includes("\0")) throw new Error("Command must contain 1 to 8000 characters.");
    return this.withBot(botId, async () => {
      if (botId !== OWNER_SESSION) await this.ensureGuestSession(botId);
      else await this.ensureRunning();
      const result = await this.ssh(["rex-sessiond", "exec", botId], command, this.options.execTimeoutMs);
      const timedOut = result.timedOut || result.code === 124;
      return { command, output: result.output.slice(0, 32_000) || "(no output)", exitCode: result.timedOut ? 124 : result.code, timedOut };
    });
  }

  async input(botId: string, raw: unknown): Promise<string> {
    const action = validateInput(raw);
    return this.withBot(botId, async () => {
      await this.ensureGuestSession(botId);
      await this.lock(botId);
      const result = await this.guest(["input", botId], JSON.stringify(action));
      if (result.code !== 0) throw new Error(result.output || "Input failed.");
      return result.output || `${action.action} done`;
    });
  }

  async screenshot(botId: string): Promise<string> {
    return this.withBot(botId, async () => {
      await this.ensureGuestSession(botId);
      const result = await this.guest(["screenshot", botId], undefined, 30_000);
      if (result.code !== 0) throw new Error(result.output || "Screenshot failed.");
      return JSON.stringify(parseJson(result.output, "screenshot"));
    });
  }
}
