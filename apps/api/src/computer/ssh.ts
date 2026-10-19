import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";

const OUTPUT_LIMIT = 40_000;

export interface SshConfig {
  host: string;
  user: string;
  port: number;
  keyFile?: string;
  knownHostsFile?: string;
}

export interface SshResult {
  code: number;
  output: string;
  timedOut: boolean;
}

export type SshRunner = (remoteArgs: string[], input: string | undefined, timeoutMs: number) => Promise<SshResult>;
export type TunnelOpener = (localPort: number, remotePort: number) => ChildProcess;

function expandHome(file: string) {
  return file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
}

export function sshConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SshConfig {
  const host = env.REX_COMPUTER_SSH_HOST?.trim();
  if (!host) throw new Error("Proxmox computer is missing REX_COMPUTER_SSH_HOST (the VM's IP address).");
  const port = Number(env.REX_COMPUTER_SSH_PORT || 22);
  return {
    host,
    user: env.REX_COMPUTER_SSH_USER?.trim() || "rex",
    port: Number.isInteger(port) && port > 0 ? port : 22,
    keyFile: env.REX_COMPUTER_SSH_KEY?.trim() ? expandHome(env.REX_COMPUTER_SSH_KEY.trim()) : undefined,
    knownHostsFile: env.REX_COMPUTER_SSH_KNOWN_HOSTS?.trim() ? expandHome(env.REX_COMPUTER_SSH_KNOWN_HOSTS.trim()) : undefined,
  };
}

function baseArgs(config: SshConfig) {
  return [
    "-p", String(config.port),
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "ServerAliveInterval=15",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(config.knownHostsFile ? ["-o", `UserKnownHostsFile=${config.knownHostsFile}`] : []),
    ...(config.keyFile ? ["-i", config.keyFile, "-o", "IdentitiesOnly=yes"] : []),
  ];
}

export function sshRunner(config: SshConfig): SshRunner {
  return (remoteArgs, input, timeoutMs) => new Promise((resolve, reject) => {
    // Remote args are fixed subcommands plus validated ids; user text only travels on stdin.
    const child = spawn("ssh", [...baseArgs(config), `${config.user}@${config.host}`, "--", ...remoteArgs], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let output = "";
    let timedOut = false;
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(0, OUTPUT_LIMIT); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim(), timedOut }); });
    child.stdin.on("error", () => { /* The remote side may close stdin early. */ });
    child.stdin.end(input ?? "");
  });
}

export function tunnelOpener(config: SshConfig): TunnelOpener {
  return (localPort, remotePort) => spawn("ssh", [
    ...baseArgs(config),
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    `${config.user}@${config.host}`,
  ], { stdio: "ignore", env: process.env });
}
