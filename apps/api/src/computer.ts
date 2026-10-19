import { spawn } from "node:child_process";
import type { ComputerResult, ComputerStatus } from "@rex/shared";

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
        return { available: false, running: false, busy: false, imageReady: false, detail: "Rootless Podman with seccomp and cgroup v2 is required. On Fedora: sudo dnf install podman" };
      }
      const [container, image] = await Promise.all([this.inspect(), podman(["image", "exists", IMAGE])]);
      return { available: true, running: Boolean(container?.State?.Running), busy: this.busy || this.changing, imageReady: image.code === 0, detail: "Python 3 · Alpine Linux · no network · temporary workspace" };
    } catch (err) {
      return { available: false, running: false, busy: false, imageReady: false, detail: err instanceof Error ? err.message : String(err) };
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

  async execute(command: string): Promise<ComputerResult> {
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

export const computer = new RexComputer(process.env.REX_COMPUTER_NAME || "rex-computer-v1");
