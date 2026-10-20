import { randomBytes } from "node:crypto";
import net from "node:net";
import type { ChildProcess } from "node:child_process";
import { COMPUTER_INPUT_ACTIONS, type ComputerInputAction, type ComputerResult, type ComputerSession, type ComputerSessionState, type ComputerStatus } from "@rex/shared";
import type { SshRunner, TunnelOpener } from "./ssh.js";

const BOT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Manual commands from the panel without a bot run in the shared folder. */
export const OWNER_SESSION = "owner";

/** Power control for the VM that hosts the bot screens. QEMU implements it; tests use a fake. */
export interface VmPower {
  /** Short human label, e.g. "QEMU VM rex-u1". */
  readonly label: string;
  state(): Promise<VmState>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type VmState = "running" | "stopped" | "missing" | "starting" | "stopping";

export interface DesktopComputerOptions {
  /** Returns a free loopback port for an SSH tunnel to a guest noVNC port. */
  allocatePort?: () => Promise<number>;
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

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
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

export class DesktopComputer {
  readonly kind = "qemu" as const;
  readonly desktop = true;
  private readonly sessions = new Map<string, GuestSession>();
  private readonly tunnels = new Map<number, { localPort: number; process: ChildProcess }>();
  private readonly viewTokens = new Map<string, ViewToken>();
  private readonly lockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly busyBots = new Set<string>();
  private readonly ownerControl = new Map<string, number>();
  private booting: Promise<void> | null = null;
  private stopping = false;
  private readonly options: Required<DesktopComputerOptions>;
  /** Last time a bot or the owner used this computer; drives idle shutdown. */
  lastUsed = Date.now();

  constructor(
    readonly vm: VmPower,
    private readonly ssh: SshRunner,
    private readonly openTunnel: TunnelOpener,
    options: DesktopComputerOptions = {},
  ) {
    this.options = {
      allocatePort: options.allocatePort ?? freeLoopbackPort,
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
      const state = await this.vm.state();
      const vmRunning = state === "running";
      const guestReady = vmRunning ? await this.guestReady() : false;
      const detail = state === "missing" ? `${this.vm.label} has not been created yet. It is created on first use.`
        : !vmRunning ? `${this.vm.label} is ${state}. It starts when a bot needs it.`
        : guestReady ? `${this.vm.label} · one screen per bot`
        : `${this.vm.label} is booting. Screens appear when rex-sessiond answers over SSH.`;
      return { ...base, available: true, running: vmRunning && guestReady, vmState: state, guestReady, detail };
    } catch (error) {
      return { ...base, available: false, running: false, guestReady: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Starts the VM if needed and waits until the guest answers over SSH. */
  async ensureRunning(): Promise<void> {
    if (this.stopping) throw new Error("Rex Computer is shutting down. Try again shortly.");
    if (this.booting) return this.booting;
    this.booting = (async () => {
      if (await this.vm.state() !== "running") { this.reset(); await this.vm.start(); }
      else if (await this.guestReady()) return;
      const deadline = Date.now() + this.options.bootTimeoutMs;
      while (Date.now() < deadline) {
        if (await this.guestReady()) return;
        await new Promise((resolve) => setTimeout(resolve, this.options.pollMs));
      }
      throw new Error(`${this.vm.label} started, but rex-sessiond did not answer over SSH in time. Check the serial log in the admin panel.`);
    })().finally(() => { this.booting = null; });
    return this.booting;
  }

  async start(): Promise<ComputerStatus> {
    await this.ensureRunning();
    return this.status();
  }

  /** Powers the VM off gracefully. Files on its disk are kept. */
  async stop(): Promise<ComputerStatus> {
    if (this.busyBots.size) throw new Error("A bot is using Rex Computer. Try again when it finishes.");
    this.stopping = true;
    try { this.reset(); await this.vm.stop(); }
    finally { this.stopping = false; }
    return this.status();
  }

  isIdle(idleMs: number) {
    return !this.busyBots.size && ![...this.ownerControl.values()].some((until) => until > Date.now()) && !this.booting && Date.now() - this.lastUsed > idleMs;
  }

  private reset() {
    this.ownerControl.clear();
    for (const timer of this.lockTimers.values()) clearTimeout(timer);
    this.lockTimers.clear();
    for (const tunnel of this.tunnels.values()) tunnel.process.kill();
    this.tunnels.clear();
    this.viewTokens.clear();
    this.sessions.clear();
  }

  private async ensureTunnel(session: GuestSession): Promise<number> {
    const existing = this.tunnels.get(session.slot);
    if (existing && existing.process.exitCode === null && !existing.process.killed) return existing.localPort;
    const localPort = await this.options.allocatePort();
    const tunnel = this.openTunnel(localPort, session.wsPort);
    tunnel.on("exit", () => { if (this.tunnels.get(session.slot)?.process === tunnel) this.tunnels.delete(session.slot); });
    this.tunnels.set(session.slot, { localPort, process: tunnel });
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
    const query = new URLSearchParams({ autoconnect: "1", reconnect: "1", scale: "true", path: `computer/vnc/${token}/websockify`, view_only: "1" });
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
    const localPort = await this.ensureTunnel(session);
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

  async takeControl(botId: string): Promise<ComputerSessionState> {
    assertBotId(botId);
    if (this.busyBots.has(botId)) throw new Error("Wait for the bot's current computer action to finish, then take control.");
    this.ownerControl.set(botId, Date.now() + 60_000);
    try {
      await this.ensureGuestSession(botId);
      return await this.unlock(botId);
    } catch (error) {
      this.ownerControl.delete(botId);
      throw error;
    }
  }

  releaseControl(botId: string): ComputerSessionState {
    assertBotId(botId);
    this.ownerControl.delete(botId);
    this.lastUsed = Date.now();
    return this.sessionState(botId);
  }

  private async withBot<T>(botId: string, work: () => Promise<T>): Promise<T> {
    assertBotId(botId);
    this.lastUsed = Date.now();
    if ((this.ownerControl.get(botId) ?? 0) > Date.now()) throw new Error("The user has taken control of this computer. Wait until they return control before using it.");
    if (this.busyBots.has(botId)) throw new Error("This bot is already using Rex Computer. Wait for its current command to finish.");
    this.busyBots.add(botId);
    try { return await work(); } finally { this.busyBots.delete(botId); this.lastUsed = Date.now(); }
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
