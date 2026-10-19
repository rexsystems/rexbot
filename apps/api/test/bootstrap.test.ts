import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapComputer, mergeEnvFile } from "../src/computer/bootstrap.js";

test("bootstrap rejects bad host input", async () => {
  await assert.rejects(bootstrapComputer({ pveHost: "", node: "pve" }), /Proxmox host/);
  await assert.rejects(bootstrapComputer({ pveHost: "pve;rm", node: "pve" }), /Proxmox host/);
});

test("mergeEnvFile keeps unrelated keys and rewrites Proxmox block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "LLM_API_KEY=keep-me\nREX_PROXMOX_VMID=1\nPORT=8787\n");
  mergeEnvFile(file, { REX_PROXMOX_VMID: "180", REX_COMPUTER_BACKEND: "proxmox" });
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /LLM_API_KEY=keep-me/);
  assert.match(text, /PORT=8787/);
  assert.match(text, /REX_PROXMOX_VMID=180/);
  assert.doesNotMatch(text, /REX_PROXMOX_VMID=1\b/);
  fs.rmSync(dir, { recursive: true, force: true });
});
