import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

let cachedClient: Client | null = null;
let schemaInitPromise: Promise<void> | null = null;

export function getDbBackend(): "turso" | "local-sqlite" {
  return process.env.TURSO_DATABASE_URL ? "turso" : "local-sqlite";
}

function resolveDatabaseConfig(): { url: string; authToken?: string } {
  if (process.env.SUPERPAD_DB_URL) {
    return {
      url: process.env.SUPERPAD_DB_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    };
  }
  if (process.env.ZEROPAD_DB_URL) {
    return {
      url: process.env.ZEROPAD_DB_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    };
  }
  if (process.env.TURSO_DATABASE_URL) {
    return {
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    };
  }
  const localDir = path.join(process.cwd(), ".superpad-data");
  fs.mkdirSync(localDir, { recursive: true });
  return {
    url: `file:${path.join(localDir, "superpad.db")}`,
  };
}

function getDbClient(): Client {
  if (!cachedClient) {
    const cfg = resolveDatabaseConfig();
    cachedClient = createClient(cfg);
  }
  return cachedClient;
}

const SCHEMA_STATEMENTS = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    kdf_salt TEXT NOT NULL,
    auth_salt TEXT NOT NULL,
    auth_verifier TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_meta TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS note_revisions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    encrypted_meta TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_revisions_note_ver ON note_revisions(note_id, version DESC)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at)`,
];

async function runMigrations(client: Client): Promise<void> {
  // Safely add deleted_at column to pre-existing notes tables (soft-trash support)
  const info = await client.execute(`PRAGMA table_info(notes)`);
  const hasDeletedAt = info.rows.some((r) => String(r.name) === "deleted_at");
  if (!hasDeletedAt) {
    await client.execute(`ALTER TABLE notes ADD COLUMN deleted_at INTEGER DEFAULT NULL`);
  }
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_notes_user_deleted ON notes(user_id, deleted_at)`
  );
}

export async function getDb(): Promise<Client> {
  const client = getDbClient();
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      for (const sql of SCHEMA_STATEMENTS) {
        await client.execute(sql);
      }
      await runMigrations(client);
    })().catch((err) => {
      schemaInitPromise = null;
      throw err;
    });
  }
  await schemaInitPromise;
  return client;
}

/**
 * Closes and resets the cached libSQL client (used in unit tests).
 */
export function resetDbClientForTests(): void {
  if (cachedClient) {
    cachedClient.close();
    cachedClient = null;
  }
  schemaInitPromise = null;
}
