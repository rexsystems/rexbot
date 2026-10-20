import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import { createSkill, deleteSkill, listSkills, updateSkill } from "../skills.js";

export const skillRoutes = new Hono<AppEnv>();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

skillRoutes.get("/skills", (c) => c.json({ skills: listSkills(c.get("user").id) }));

skillRoutes.post("/skills", async (c) => {
  try { return c.json({ skill: createSkill(c.get("user").id, await body(c)) }, 201); }
  catch (error) { return c.json({ error: message(error) }, 400); }
});

skillRoutes.patch("/skills/:id", async (c) => {
  try {
    const skill = updateSkill(c.get("user").id, c.req.param("id"), await body(c));
    return skill ? c.json({ skill }) : c.json({ error: "Skill not found" }, 404);
  } catch (error) { return c.json({ error: message(error) }, 400); }
});

skillRoutes.delete("/skills/:id", (c) => deleteSkill(c.get("user").id, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Skill not found" }, 404));
