import { randomUUID } from "node:crypto";
import type { Routine, RoutineInput, RoutineSchedule } from "@rex/shared";
import { db, nowIso } from "./db.js";
import { getOwnedConversation } from "./conversations.js";

export const MAX_ROUTINES_PER_USER = 25;
const MAX_PROMPT = 4000;
const BUSY_RETRY_MS = 5 * 60_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT,
    last_run_at TEXT,
    last_status TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
  CREATE INDEX IF NOT EXISTS idx_routines_due ON routines(enabled, next_run_at);
`);

interface Row {
  id: string; user_id: string; conversation_id: string; title: string; prompt: string; schedule: string; time_zone: string;
  enabled: number; next_run_at: string | null; last_run_at: string | null; last_status: string | null; last_error: string | null; created_at: string;
}

function toRoutine(row: Row): Routine {
  return {
    id: row.id, conversationId: row.conversation_id, title: row.title, prompt: row.prompt,
    schedule: JSON.parse(row.schedule) as RoutineSchedule, timeZone: row.time_zone, enabled: row.enabled === 1,
    nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
    lastStatus: row.last_status === "ok" || row.last_status === "error" ? row.last_status : null,
    lastError: row.last_error, createdAt: row.created_at,
  };
}

export function isTimeZone(zone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone.length <= 64; } catch { return false; }
}

/** Wall-clock parts of an instant in a time zone. */
function zoned(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!),
  };
}

/** The instant at which the wall clock in timeZone reads the given local time (first match across DST changes). */
function instantFor(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const seen = zoned(guess, timeZone);
    const shown = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - shown;
  }
  return guess;
}

export function validateSchedule(schedule: unknown): RoutineSchedule {
  const input = schedule as Partial<RoutineSchedule> | null;
  if (input?.kind === "interval") {
    const hours = Number((input as { hours?: unknown }).hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("Repeat every 1 to 168 hours.");
    return { kind: "interval", hours };
  }
  if (input?.kind === "daily") {
    const time = String((input as { time?: unknown }).time ?? "");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Pick a time like 08:30.");
    const rawDays = (input as { days?: unknown }).days;
    const days = Array.isArray(rawDays) ? [...new Set(rawDays.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort() : [];
    return days.length && days.length < 7 ? { kind: "daily", time, days } : { kind: "daily", time };
  }
  throw new Error("Choose a daily time or an hourly interval.");
}

/** Next run strictly after `after`. */
export function nextRun(schedule: RoutineSchedule, timeZone: string, after: number): number {
  if (schedule.kind === "interval") return after + schedule.hours * 3_600_000;
  const [hour, minute] = schedule.time.split(":").map(Number) as [number, number];
  const today = zoned(after, timeZone);
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (schedule.days?.length && !schedule.days.includes(date.getUTCDay())) continue;
    const at = instantFor(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
    if (at > after) return at;
  }
  throw new Error("Couldn't compute the next run.");
}

export function describeSchedule(schedule: RoutineSchedule, timeZone: string) {
  if (schedule.kind === "interval") return schedule.hours === 1 ? "every hour" : `every ${schedule.hours} hours`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${schedule.days?.length ? schedule.days.map((day) => names[day]).join(", ") : "every day"} at ${schedule.time} (${timeZone})`;
}

function clean(input: Partial<RoutineInput>, userId: string, existing?: Routine) {
  const conversationId = input.conversationId ?? existing?.conversationId ?? "";
  if (!getOwnedConversation(conversationId, userId)) throw new Error("Pick one of your bots or groups.");
  const title = (input.title ?? existing?.title ?? "").trim().slice(0, 80);
  if (!title) throw new Error("Give the routine a name.");
  const prompt = (input.prompt ?? existing?.prompt ?? "").trim();
  if (!prompt) throw new Error("Write what the bot should do.");
  if (prompt.length > MAX_PROMPT) throw new Error(`Keep the instructions under ${MAX_PROMPT} characters.`);
  const timeZone = (input.timeZone ?? existing?.timeZone ?? "").trim();
  if (!isTimeZone(timeZone)) throw new Error("Unknown time zone.");
  const schedule = validateSchedule(input.schedule ?? existing?.schedule);
  const enabled = input.enabled ?? existing?.enabled ?? true;
  return { conversationId, title, prompt, timeZone, schedule, enabled };
}

export function listRoutines(userId: string, conversationId?: string): Routine[] {
  const rows = conversationId
    ? db.prepare("SELECT * FROM routines WHERE user_id = ? AND conversation_id = ? ORDER BY created_at").all(userId, conversationId)
    : db.prepare("SELECT * FROM routines WHERE user_id = ? ORDER BY created_at").all(userId);
  return (rows as Row[]).map(toRoutine);
}

export function getRoutine(userId: string, id: string): Routine | null {
  const row = db.prepare("SELECT * FROM routines WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return row ? toRoutine(row) : null;
}

export function createRoutine(userId: string, input: Partial<RoutineInput>, now = Date.now()): Routine {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM routines WHERE user_id = ?").get(userId) as { n: number }).n;
  if (count >= MAX_ROUTINES_PER_USER) throw new Error(`You can have up to ${MAX_ROUTINES_PER_USER} routines. Delete one first.`);
  const value = clean(input, userId);
  const id = randomUUID();
  const next = value.enabled ? new Date(nextRun(value.schedule, value.timeZone, now)).toISOString() : null;
  db.prepare(`INSERT INTO routines (id, user_id, conversation_id, title, prompt, schedule, time_zone, enabled, next_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, value.conversationId, value.title, value.prompt, JSON.stringify(value.schedule), value.timeZone, value.enabled ? 1 : 0, next, nowIso());
  return getRoutine(userId, id)!;
}

export function updateRoutine(userId: string, id: string, input: Partial<RoutineInput>, now = Date.now()): Routine | null {
  const existing = getRoutine(userId, id);
  if (!existing) return null;
  const value = clean(input, userId, existing);
  const next = value.enabled ? new Date(nextRun(value.schedule, value.timeZone, now)).toISOString() : null;
  db.prepare(`UPDATE routines SET conversation_id = ?, title = ?, prompt = ?, schedule = ?, time_zone = ?, enabled = ?, next_run_at = ? WHERE id = ? AND user_id = ?`)
    .run(value.conversationId, value.title, value.prompt, JSON.stringify(value.schedule), value.timeZone, value.enabled ? 1 : 0, next, id, userId);
  return getRoutine(userId, id);
}

export function deleteRoutine(userId: string, id: string) {
  return db.prepare("DELETE FROM routines WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Runs one routine now: posts its prompt in the routine's chat and lets the bot answer. */
export async function runRoutine(routine: Routine, userId: string): Promise<{ ok: boolean; error?: string; busy?: boolean }> {
  const { prepareChatTurn } = await import("./chatTurn.js");
  const turn = await prepareChatTurn({
    userId,
    conversationId: routine.conversationId,
    message: `Routine "${routine.title}": ${routine.prompt}`,
    allowRoutines: false,
    note: `This message was sent automatically by the user's scheduled routine "${routine.title}" (${describeSchedule(routine.schedule, routine.timeZone)}). The user may not be watching. Do the task with your tools and reply with the result itself, short and self-contained. Don't ask follow-up questions; state assumptions instead.`,
  }).catch((error: unknown) => ({ ok: false as const, status: 400 as const, error: error instanceof Error ? error.message : String(error) }));
  if (!turn.ok) return { ok: false, error: turn.error, busy: turn.status === 409 };
  let failure: string | undefined;
  await turn.run((event) => { if (event.type === "error") failure = event.message; });
  return failure ? { ok: false, error: failure } : { ok: true };
}

function record(id: string, result: { ok: boolean; error?: string }, at: string) {
  db.prepare("UPDATE routines SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?").run(at, result.ok ? "ok" : "error", result.ok ? null : (result.error ?? "Failed").slice(0, 500), id);
}

export async function runRoutineNow(userId: string, id: string) {
  const routine = getRoutine(userId, id);
  if (!routine) return null;
  const result = await runRoutine(routine, userId).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error), busy: false }));
  if (!result.busy) record(id, result, nowIso());
  return { ...result, routine: getRoutine(userId, id)! };
}

let ticking = false;

/** Runs every due routine once, one at a time. Returns how many ran. */
export async function runDueRoutines(now = Date.now()): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  let ran = 0;
  try {
    const due = db.prepare(`SELECT r.* FROM routines r JOIN users u ON u.id = r.user_id
      WHERE r.enabled = 1 AND r.next_run_at IS NOT NULL AND r.next_run_at <= ? AND u.status = 'active' ORDER BY r.next_run_at LIMIT 20`).all(new Date(now).toISOString()) as Row[];
    for (const row of due) {
      const routine = toRoutine(row);
      // Advance first, so a crash mid-run doesn't repeat the routine in a loop.
      db.prepare("UPDATE routines SET next_run_at = ? WHERE id = ?").run(new Date(nextRun(routine.schedule, routine.timeZone, now)).toISOString(), routine.id);
      const result = await runRoutine(routine, row.user_id).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error), busy: false }));
      if (result.busy) {
        db.prepare("UPDATE routines SET next_run_at = ? WHERE id = ?").run(new Date(now + BUSY_RETRY_MS).toISOString(), routine.id);
        continue;
      }
      record(routine.id, result, new Date(now).toISOString());
      ran++;
    }
  } finally {
    ticking = false;
  }
  return ran;
}

export function startRoutineScheduler(intervalMs = 30_000) {
  void runDueRoutines().catch((error) => console.error("Routine scheduler:", error));
  const timer = setInterval(() => { void runDueRoutines().catch((error) => console.error("Routine scheduler:", error)); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** The user's time zone: a valid one from the browser is remembered; otherwise the saved one, else UTC. */
export function userTimeZone(userId: string, fromClient?: unknown): string {
  if (typeof fromClient === "string" && isTimeZone(fromClient)) {
    db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'timeZone', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, fromClient);
    return fromClient;
  }
  const saved = (db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'timeZone'").get(userId) as { value: string } | undefined)?.value;
  return saved && isTimeZone(saved) ? saved : "UTC";
}

function summary(routine: Routine) {
  return { routine_id: routine.id, title: routine.title, schedule: describeSchedule(routine.schedule, routine.timeZone), enabled: routine.enabled, next_run_at: routine.nextRunAt, last_status: routine.lastStatus };
}

/** The routine tool: bots manage routines for the chat they're in, never for other chats. */
export function routineTool(userId: string | undefined, conversationId: string | undefined, timeZone: string | undefined, args: Record<string, unknown>): string {
  if (!userId || !conversationId) return "routine unavailable in this context.";
  const action = String(args.action ?? "");
  try {
    if (action === "list") return JSON.stringify(listRoutines(userId, conversationId).map(summary));
    if (action === "create") {
      const existing = listRoutines(userId, conversationId).find((routine) => routine.title.toLocaleLowerCase() === String(args.title ?? "").trim().toLocaleLowerCase() && routine.prompt.trim() === String(args.prompt ?? "").trim());
      if (existing) return JSON.stringify({ existing: summary(existing), note: "This task already has a routine. Do not create another." });
      const hours = args.every_hours === undefined ? undefined : Number(args.every_hours);
      const schedule = hours !== undefined ? { kind: "interval" as const, hours } : { kind: "daily" as const, time: String(args.time ?? ""), days: Array.isArray(args.days) ? args.days.map(Number) : undefined };
      const routine = createRoutine(userId, { conversationId, title: String(args.title ?? ""), prompt: String(args.prompt ?? ""), schedule, timeZone: timeZone ?? userTimeZone(userId) });
      return JSON.stringify({ created: summary(routine) });
    }
    if (action === "pause" || action === "resume" || action === "delete") {
      const id = String(args.routine_id ?? "");
      const routine = getRoutine(userId, id);
      if (!routine || routine.conversationId !== conversationId) return `routine failed: no routine ${JSON.stringify(id)} in this chat. Use action=list.`;
      if (action === "delete") { deleteRoutine(userId, id); return JSON.stringify({ deleted: id }); }
      return JSON.stringify({ updated: summary(updateRoutine(userId, id, { enabled: action === "resume" })!) });
    }
    return "routine failed: action must be create, list, pause, resume or delete.";
  } catch (error) {
    return `routine failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
