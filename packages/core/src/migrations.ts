/**
 * Migrações versionadas. Nunca editar uma migração já aplicada: acrescentar uma nova.
 * Cada migração corre numa transação e fica registada em schema_migrations.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "channels_jobs_events",
    sql: `
      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        niche TEXT NOT NULL,
        audience TEXT NOT NULL,
        language TEXT NOT NULL,
        tone TEXT NOT NULL DEFAULT '',
        primary_color TEXT NOT NULL,
        secondary_color TEXT NOT NULL,
        target_duration_seconds INTEGER NOT NULL,
        formats TEXT NOT NULL,            -- JSON array
        voice TEXT NOT NULL,              -- JSON object
        frequency TEXT NOT NULL,
        max_per_period INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE UNIQUE INDEX idx_channels_name_active
        ON channels (lower(name)) WHERE archived_at IS NULL;

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
        progress REAL NOT NULL DEFAULT 0,
        params TEXT NOT NULL DEFAULT '{}',   -- JSON
        result TEXT,                          -- JSON
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        channel_id TEXT REFERENCES channels(id),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_jobs_status ON jobs (status, created_at);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        job_id TEXT REFERENCES jobs(id),
        channel_id TEXT REFERENCES channels(id)
      );
      CREATE INDEX idx_events_job ON events (job_id);
    `,
  },
  {
    version: 2,
    name: "ideas_sources_scripts_approvals",
    sql: `
      CREATE TABLE ideas (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','discarded')),
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX idx_ideas_channel ON ideas (channel_id, position);

      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        idea_id TEXT NOT NULL REFERENCES ideas(id),
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL DEFAULT '',
        accessed_at TEXT NOT NULL DEFAULT '',   -- fornecida pelo utilizador; vazia se desconhecida
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sources_idea ON sources (idea_id);

      CREATE TABLE scripts (
        id TEXT PRIMARY KEY,
        idea_id TEXT NOT NULL UNIQUE REFERENCES ideas(id),
        created_at TEXT NOT NULL
      );

      -- Versões imutáveis: editar cria sempre uma nova versão.
      CREATE TABLE script_versions (
        id TEXT PRIMARY KEY,
        script_id TEXT NOT NULL REFERENCES scripts(id),
        version INTEGER NOT NULL,
        content TEXT NOT NULL,                 -- JSON canónico
        content_hash TEXT NOT NULL,            -- sha256 do conteúdo
        origin TEXT NOT NULL CHECK (origin IN ('manual','template','ollama')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (script_id, version)
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,                    -- 'script' (vídeo/publicação em marcos futuros)
        target_id TEXT NOT NULL,               -- id da versão exata aprovada
        content_hash TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        invalidated_at TEXT,
        invalidated_reason TEXT
      );
      CREATE INDEX idx_approvals_target ON approvals (kind, target_id);
    `,
  },
];
