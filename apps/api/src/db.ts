import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.REX_DATA_DIR ? path.resolve(process.env.REX_DATA_DIR) : path.resolve(__dirname, "../../../data");
const dbPath = path.join(dataDir, "rex.db");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

export const db: SqliteDatabase = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_call_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    actor TEXT NOT NULL CHECK(actor IN ('user', 'rex')),
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, actor)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    text_content TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );
`);

export function uploadsDir() {
  return path.join(dataDir, "uploads");
}

const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
if (!conversationColumns.some((column) => column.name === "bot_profile")) {
  db.exec("ALTER TABLE conversations ADD COLUMN bot_profile TEXT");
}
if (!conversationColumns.some((column) => column.name === "kind")) db.exec("ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'bot'");
const memoryColumns = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
if (!memoryColumns.some((column) => column.name === "embedding_space")) db.exec("ALTER TABLE memories ADD COLUMN embedding_space TEXT");
const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
if (!messageColumns.some((column) => column.name === "bot_id")) db.exec("ALTER TABLE messages ADD COLUMN bot_id TEXT");
if (!messageColumns.some((column) => column.name === "bot_name")) db.exec("ALTER TABLE messages ADD COLUMN bot_name TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (group_id, bot_id)
  );
  CREATE TABLE IF NOT EXISTS bot_exchanges (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_name TEXT NOT NULL,
    message TEXT NOT NULL,
    reply TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_exchanges_group ON bot_exchanges(group_id, created_at);
`);

const uploadColumns = db.prepare("PRAGMA table_info(uploads)").all() as Array<{ name: string }>;
if (!uploadColumns.some((column) => column.name === "message_id")) {
  db.exec("ALTER TABLE uploads ADD COLUMN message_id TEXT REFERENCES messages(id) ON DELETE SET NULL");
}
if (!uploadColumns.some((column) => column.name === "message_position")) db.exec("ALTER TABLE uploads ADD COLUMN message_position INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_uploads_message ON uploads(message_id)");

export function nowIso() {
  return new Date().toISOString();
}
