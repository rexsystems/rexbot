import { nanoid } from "nanoid";
import type { ClientSettings, MemoryItem } from "@rex/shared";
import { db, nowIso } from "../db.js";
import { embedTexts, completeJson, embeddingSpace } from "../llm.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  if (a.length !== b.length) return 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function keywordScore(query: string, content: string): number {
  const q = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (q.length === 0) return 0;
  const c = content.toLowerCase();
  let hits = 0;
  for (const term of q) if (c.includes(term)) hits++;
  return hits / q.length;
}

export function listMemories(userId: string): MemoryItem[] {
  const rows = db
    .prepare(
      `SELECT id, content, created_at, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function deleteMemory(id: string, userId: string) {
  db.prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`).run(id, userId);
}

export async function retrieveMemories(
  settings: ClientSettings,
  userId: string,
  query: string,
  limit = 8,
): Promise<MemoryItem[]> {
  const rows = db
    .prepare(
      `SELECT id, content, embedding, embedding_space, created_at, updated_at FROM memories WHERE user_id = ?`,
    )
    .all(userId) as Array<{
    id: string;
    content: string;
    embedding: string | null;
    embedding_space: string | null;
    created_at: string;
    updated_at: string;
  }>;
  if (rows.length === 0) return [];

  const space = embeddingSpace(settings);
  const queryEmbedding = (await embedTexts(settings, [query], "query"))?.[0] ?? null;
  if (queryEmbedding) {
    const missing = rows.filter((row) => row.embedding_space !== space || !row.embedding).slice(0, 16);
    const vectors = await embedTexts(settings, missing.map((row) => row.content));
    if (vectors) missing.forEach((row, index) => {
      row.embedding = JSON.stringify(vectors[index]);
      row.embedding_space = space;
      db.prepare("UPDATE memories SET embedding = ?, embedding_space = ? WHERE id = ?").run(row.embedding, space, row.id);
    });
  }

  const scored = rows.map((row) => {
    let score = keywordScore(query, row.content);
    if (queryEmbedding && row.embedding && row.embedding_space === space) {
      try {
        const emb = JSON.parse(row.embedding) as number[];
        score = Math.max(score, cosine(queryEmbedding, emb));
      } catch {
        // keep keyword score
      }
    }
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0.05)
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

export function formatMemoryBlock(items: MemoryItem[]): string {
  if (items.length === 0) return "";
  return items.map((m, i) => `${i + 1}. ${m.content}`).join("\n");
}

export async function upsertMemory(
  settings: ClientSettings,
  userId: string,
  content: string,
): Promise<MemoryItem> {
  const trimmed = content.trim();
  const id = nanoid();
  const ts = nowIso();
  const emb = (await embedTexts(settings, [trimmed]))?.[0] ?? null;
  db.prepare(
    `INSERT INTO memories (id, content, embedding, created_at, updated_at, embedding_space, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, trimmed, emb ? JSON.stringify(emb) : null, ts, ts, emb ? embeddingSpace(settings) : null, userId);
  return { id, content: trimmed, createdAt: ts, updatedAt: ts };
}

export async function extractAndStoreMemories(opts: {
  settings: ClientSettings;
  userId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<void> {
  const { settings, userId, userMessage, assistantMessage } = opts;
  if (!settings.llmApiKey.trim()) return;

  try {
    const raw = await completeJson({
      settings,
      system: `Extract lasting facts about the user worth remembering for future chats.
Return ONLY a JSON array of short strings. Empty array if nothing durable.
Examples: preferences, name, projects, constraints. Skip ephemeral task details.`,
      user: `User: ${userMessage}\nAssistant: ${assistantMessage}`,
    });
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    const facts = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(facts)) return;

    const existing = listMemories(userId).map((m) => m.content.toLowerCase());
    for (const fact of facts) {
      if (typeof fact !== "string") continue;
      const t = fact.trim();
      if (t.length < 4 || t.length > 280) continue;
      if (existing.some((e) => e.includes(t.toLowerCase()) || t.toLowerCase().includes(e))) {
        continue;
      }
      await upsertMemory(settings, userId, t);
      existing.push(t.toLowerCase());
    }
  } catch {
    // memory extraction is best-effort
  }
}
