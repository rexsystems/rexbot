import { Hono } from "hono";
import type { RoutineInput } from "@rex/shared";
import type { AppEnv } from "../auth.js";
import { createRoutine, deleteRoutine, listRoutines, runRoutineNow, updateRoutine } from "../routines.js";

export const routineRoutes = new Hono<AppEnv>();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => null)) ?? {}) as Partial<RoutineInput>;

routineRoutes.get("/routines", (c) => c.json({ routines: listRoutines(c.get("user").id, c.req.query("conversationId") || undefined) }));

routineRoutes.post("/routines", async (c) => {
  try { return c.json({ routine: createRoutine(c.get("user").id, await body(c)) }, 201); }
  catch (error) { return c.json({ error: message(error) }, 400); }
});

routineRoutes.patch("/routines/:id", async (c) => {
  try {
    const routine = updateRoutine(c.get("user").id, c.req.param("id"), await body(c));
    return routine ? c.json({ routine }) : c.json({ error: "Routine not found" }, 404);
  } catch (error) { return c.json({ error: message(error) }, 400); }
});

routineRoutes.delete("/routines/:id", (c) => deleteRoutine(c.get("user").id, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Routine not found" }, 404));

routineRoutes.post("/routines/:id/run", async (c) => {
  const result = await runRoutineNow(c.get("user").id, c.req.param("id"));
  if (!result) return c.json({ error: "Routine not found" }, 404);
  if (result.busy) return c.json({ error: "That chat is busy right now. Try again when it finishes." }, 409);
  return c.json(result);
});
