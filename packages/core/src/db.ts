import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations.ts";

export type Db = DatabaseSync;

/** Abre (e cria, se preciso) a base de dados SQLite e aplica as migrações pendentes. */
export function openDb(storageDir: string, filename = "replica.db"): Db {
  const file = filename === ":memory:" ? filename : path.join(storageDir, filename);
  if (file !== ":memory:") mkdirSync(storageDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Db): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      applied.push(m.version);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Falha na migração ${m.version} (${m.name}): ${(e as Error).message}`);
    }
  }
  return applied;
}
