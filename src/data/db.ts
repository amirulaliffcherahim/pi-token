import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

let _db: DatabaseSync | null = null;

export function getDbPath(): string {
  const custom = process.env.PI_PULSE_DB_PATH;
  if (custom) return custom;
  return path.join(os.homedir(), ".pi", "agent", "pulse.db");
}

export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA synchronous = NORMAL;");

  initSchema(_db);
  return _db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      entry_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      session_path TEXT NOT NULL,
      workspace TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      model_id TEXT,
      provider TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_input REAL DEFAULT 0,
      cost_output REAL DEFAULT 0,
      cost_cache_read REAL DEFAULT 0,
      cost_cache_write REAL DEFAULT 0,
      cost_total REAL DEFAULT 0,
      cache_savings REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages (workspace);
    CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages (provider);
    CREATE INDEX IF NOT EXISTS idx_messages_model ON messages (model_id);

    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      entries_indexed INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      provider_id TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      account TEXT,
      status TEXT NOT NULL,
      used_percent REAL,
      reset_at INTEGER,
      resets_available INTEGER
    );

    CREATE TABLE IF NOT EXISTS daemon_status (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
  `);
}
