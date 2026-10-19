import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

let _db: DatabaseSync | null = null;

/** pi-token owns its data directory: database, daemon log. Nothing here is shared with other extensions. */
export function getDataDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-token");
}

export function getDbPath(): string {
  return process.env.PI_TOKEN_DB_PATH || path.join(getDataDir(), "token.db");
}

/** The database the old pi-pulse extension wrote. Read once for import, never modified. */
function getLegacyPulseDbPath(): string {
  return process.env.PI_PULSE_DB_PATH || path.join(os.homedir(), ".pi", "agent", "pulse.db");
}

export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA synchronous = NORMAL;");
  // The daemon and an open dashboard both write; wait for each other instead of failing with SQLITE_BUSY.
  _db.exec("PRAGMA busy_timeout = 5000;");

  initSchema(_db);
  importLegacyPulseData(_db);
  return _db;
}

export function getState(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setState(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, Date.now());
}

export function deleteState(key: string): void {
  getDb().prepare("DELETE FROM state WHERE key = ?").run(key);
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

    -- Quota history written by the daemon (one row per provider per few minutes).
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
    CREATE INDEX IF NOT EXISTS idx_plan_snapshots_ts ON plan_snapshots (timestamp);

    -- Key/value store: daemon heartbeat, cached plans, import markers.
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

const MESSAGE_COLUMNS =
  "entry_id, session_id, session_path, workspace, timestamp, model_id, provider, input_tokens, output_tokens, " +
  "cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost_input, cost_output, " +
  "cost_cache_read, cost_cache_write, cost_total, cache_savings";

/** First run only: carry the pulse ledger over so history survives the split. The source file is opened read-only. */
function importLegacyPulseData(db: DatabaseSync): void {
  const marker = db.prepare("SELECT 1 FROM state WHERE key = 'legacy_pulse_import'").get();
  if (marker) return;

  const legacyPath = getLegacyPulseDbPath();
  let imported = 0;
  let importedOk = false;
  if (fs.existsSync(legacyPath) && path.resolve(legacyPath) !== path.resolve(getDbPath())) {
    const legacy = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      const placeholders = MESSAGE_COLUMNS.split(",").map(() => "?").join(",");
      const insertMessage = db.prepare(`INSERT OR IGNORE INTO messages (${MESSAGE_COLUMNS}) VALUES (${placeholders})`);
      const insertFile = db.prepare("INSERT OR IGNORE INTO files (path, mtime, size, entries_indexed) VALUES (?, ?, ?, ?)");

      db.exec("BEGIN");
      for (const row of legacy.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages`).all() as Record<string, any>[]) {
        insertMessage.run(...MESSAGE_COLUMNS.split(",").map((column) => row[column.trim()] ?? null));
        imported++;
      }
      for (const row of legacy.prepare("SELECT path, mtime_ms, file_size FROM files").all() as any[]) {
        insertFile.run(row.path, row.mtime_ms, row.file_size, 0);
      }
      db.exec("COMMIT");
      importedOk = true;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no open transaction */ }
      // Not fatal: sessions are re-indexed from the jsonl logs, which are the source of truth.
      process.stderr.write(`pi-token: legacy pulse import skipped: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      legacy.close();
    }
  }
  // No source file counts as done; a failed import stays unmarked so the next start retries it.
  if (importedOk || !fs.existsSync(legacyPath)) {
    db.prepare("INSERT INTO state (key, value, updated_at) VALUES ('legacy_pulse_import', ?, ?)").run(String(imported), Date.now());
  }
}
