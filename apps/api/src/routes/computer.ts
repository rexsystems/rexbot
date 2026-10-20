import { Hono, type Context } from "hono";
import { requireAdmin, type AppEnv } from "../auth.js";
import { computers, isDesktopComputer } from "../computer.js";
import { proxyVncHttp } from "../computer/vncProxy.js";
import { getOwnedConversation } from "../conversations.js";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

type Ctx = Context<AppEnv>;

function knownBot(c: Ctx, id: string) {
  const conversation = getOwnedConversation(id, c.get("user").id);
  return Boolean(conversation?.bot && !conversation.kind);
}

const ownerComputer = (c: Ctx) => computers.forOwner(c.get("user").id);

/** noVNC pages authenticate with their unguessable view token, so iframes work without cookies. */
export const computerViewRoutes = new Hono();
computerViewRoutes.get("/computer/vnc/:token/*", (c) => proxyVncHttp(c.req.raw, (token) => computers.resolveView(token)));

export const computerRoutes = new Hono<AppEnv>();
computerRoutes.get("/computer", async (c) => c.json(await ownerComputer(c).status()));

computerRoutes.get("/computer/session/:botId", async (c) => {
  const computer = ownerComputer(c);
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(c, botId)) return c.json({ error: "Bot not found." }, 404);
  try { return c.json(await computer.session(botId)); }
  catch (err) { return c.json({ error: errorMessage(err) }, 502); }
});

computerRoutes.get("/computer/session/:botId/state", (c) => {
  const computer = ownerComputer(c);
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(c, botId)) return c.json({ error: "Bot not found." }, 404);
  return c.json(computer.sessionState(botId));
});

computerRoutes.post("/computer/session/:botId/:action", async (c) => {
  const computer = ownerComputer(c);
  if (!isDesktopComputer(computer)) return c.json({ error: "This computer has no screen." }, 404);
  const botId = c.req.param("botId");
  if (!knownBot(c, botId)) return c.json({ error: "Bot not found." }, 404);
  const action = c.req.param("action");
  try {
    if (action === "lock") return c.json(await computer.lock(botId));
    if (action === "unlock") return c.json(await computer.unlock(botId));
    return c.json({ error: "Unknown session action" }, 404);
  } catch (err) { return c.json({ error: errorMessage(err) }, 400); }
});

computerRoutes.post("/computer/:action", async (c) => {
  const computer = ownerComputer(c);
  try {
    const action = c.req.param("action");
    if (action === "start") return c.json(await computer.start());
    if (action === "stop") return c.json(await computer.stop());
    if (action === "exec") {
      const body = await c.req.json() as { command?: unknown; botId?: unknown };
      const botId = typeof body.botId === "string" && body.botId ? body.botId : undefined;
      if (botId && !knownBot(c, botId)) return c.json({ error: "Bot not found." }, 404);
      return c.json(await computer.execute(body.command as string, botId));
    }
    return c.json({ error: "Unknown computer action" }, 404);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

/** Image build state. Everyone may read it (the panel shows progress); only admins may start a build. */
computerRoutes.get("/computer/template", (c) => {
  const info = computers.templateInfo();
  if (c.get("user").role === "admin") return c.json(info);
  // Members only need to know whether an image exists or is on its way; host details stay with admins.
  return c.json({
    host: { kvm: info.host.kvm, accel: info.host.accel, problems: [] },
    template: info.template ? { version: info.template.version, builtAt: info.template.builtAt, sizeBytes: 0, baseImage: "" } : null,
    build: { running: info.build.running, log: [], error: null, startedAt: info.build.startedAt, finishedAt: info.build.finishedAt },
  });
});
computerRoutes.post("/computer/template/build", requireAdmin, (c) => c.json(computers.buildTemplate()));
