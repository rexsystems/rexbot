import { Hono } from "hono";
import { computer } from "../computer.js";

export const computerRoutes = new Hono();
computerRoutes.get("/computer", async (c) => c.json(await computer.status()));
computerRoutes.post("/computer/:action", async (c) => {
  try {
    const action = c.req.param("action");
    if (action === "start") return c.json(await computer.start());
    if (action === "stop") return c.json(await computer.stop());
    if (action === "exec") {
      const body = await c.req.json();
      return c.json(await computer.execute(body.command));
    }
    return c.json({ error: "Unknown computer action" }, 404);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
