import { Hono } from "hono";
import { computer, isDesktopComputer } from "../computer.js";
import { BootstrapBusyError, bootstrapComputer, type BootstrapRequest } from "../computer/bootstrap.js";
import { proxyVncHttp } from "../computer/vncProxy.js";
import { getConversation } from "../conversations.js";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function knownBot(id: string) {
  const conversation = getConversation(id);
  return Boolean(conversation?.bot && !conversation.kind);
}

export const computerRoutes = new Hono();
computerRoutes.get("/computer", async (c) => c.json(await computer.status()));

/** One-shot Proxmox setup. Bound to localhost only (see index.ts). Password is never written to disk. */
computerRoutes.post("/computer/bootstrap", async (c) => {
  let body: BootstrapRequest;
  try { body = await c.req.json() as BootstrapRequest; }
  catch { return c.json({ error: "Invalid JSON" }, 400); }
  try {
    const result = await bootstrapComputer(body);
    return c.json({
      ok: true,
      vmid: result.vmid,
      guestIp: result.guestIp,
      tokenId: result.tokenId,
      envPath: result.envPath,
      status: result.status,
      log: result.log,
    });
  } catch (err) {
    const status = err instanceof BootstrapBusyError ? 409 : 400;
    return c.json({ error: errorMessage(err) }, status);
  }
});

computerRoutes.get("/computer/vnc/:token/*", (c) => {
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const desktop = computer;
  return proxyVncHttp(c.req.raw, (token) => desktop.resolveView(token));
});

computerRoutes.get("/computer/session/:botId", async (c) => {
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(botId)) return c.json({ error: "Bot not found." }, 404);
  try { return c.json(await computer.session(botId)); }
  catch (err) { return c.json({ error: errorMessage(err) }, 502); }
});

computerRoutes.get("/computer/session/:botId/state", (c) => {
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(botId)) return c.json({ error: "Bot not found." }, 404);
  return c.json(computer.sessionState(botId));
});

computerRoutes.post("/computer/session/:botId/:action", async (c) => {
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(botId)) return c.json({ error: "Bot not found." }, 404);
  const action = c.req.param("action");
  try {
    if (action === "lock") return c.json(await computer.lock(botId));
    if (action === "unlock") return c.json(await computer.unlock(botId));
    return c.json({ error: "Unknown session action" }, 404);
  } catch (err) { return c.json({ error: errorMessage(err) }, 400); }
});

computerRoutes.post("/computer/:action", async (c) => {
  try {
    const action = c.req.param("action");
    if (action === "start") return c.json(await computer.start());
    if (action === "stop") return c.json(await computer.stop());
    if (action === "exec") {
      const body = await c.req.json() as { command?: unknown; botId?: unknown };
      const botId = typeof body.botId === "string" && body.botId ? body.botId : undefined;
      if (botId && !knownBot(botId)) return c.json({ error: "Bot not found." }, 404);
      return c.json(await computer.execute(body.command as string, botId));
    }
    return c.json({ error: "Unknown computer action" }, 404);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});
