import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verifyLogin } from "./server-store";
import { dataDir, ensurePersistentStorage } from "./storage";
import { ChatMessage } from "./types";
import { uid } from "./order-utils";

const dbFile = path.join(dataDir, "pedidos-piloto.sqlite");

let chatDb: DatabaseSync | undefined;

async function openChatDb() {
  await ensurePersistentStorage();

  if (!chatDb) {
    chatDb = new DatabaseSync(dbFile);
    chatDb.exec("PRAGMA journal_mode = WAL;");
    chatDb.exec("PRAGMA busy_timeout = 5000;");
    chatDb.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        user TEXT NOT NULL,
        body TEXT NOT NULL,
        direct_to TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_at ON chat_messages(at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_direct_to ON chat_messages(direct_to);
    `);
  }

  return chatDb;
}

function rowToMessage(row: { id: string; at: string; user: string; body: string; direct_to?: string | null }): ChatMessage {
  return {
    id: row.id,
    at: row.at,
    user: row.user,
    body: row.body,
    directTo: row.direct_to || undefined
  };
}

export async function readChatMessages(user?: string) {
  const database = await openChatDb();
  const trimmedUser = user?.trim();
  const rows = trimmedUser
    ? (database
        .prepare(
          "SELECT * FROM chat_messages WHERE direct_to IS NULL OR lower(direct_to) = lower(?) OR lower(user) = lower(?) ORDER BY at DESC LIMIT 80"
        )
        .all(trimmedUser, trimmedUser) as Array<{ id: string; at: string; user: string; body: string; direct_to?: string | null }>)
    : (database.prepare("SELECT * FROM chat_messages WHERE direct_to IS NULL ORDER BY at DESC LIMIT 80").all() as Array<{
        id: string;
        at: string;
        user: string;
        body: string;
        direct_to?: string | null;
      }>);

  return rows.map(rowToMessage).reverse();
}

export async function addChatMessage(auth: { user?: string; pin?: string }, body: string, directTo?: string) {
  const user = await verifyLogin(auth);
  const cleanBody = body.trim();
  if (!cleanBody) throw new Error("Escribe un mensaje.");

  const database = await openChatDb();
  const message: ChatMessage = {
    id: uid("msg"),
    at: new Date().toISOString(),
    user: user.name,
    body: cleanBody.slice(0, 1000),
    directTo: directTo?.trim() || undefined
  };

  database
    .prepare("INSERT INTO chat_messages (id, at, user, body, direct_to) VALUES (?, ?, ?, ?, ?)")
    .run(message.id, message.at, message.user, message.body, message.directTo ?? null);

  return readChatMessages(user.name);
}
