import type { Db } from "./db.ts";

export type EventLevel = "info" | "warn" | "error";

export interface AppEvent {
  id: number;
  at: string;
  level: EventLevel;
  source: string;
  message: string;
  jobId: string | null;
  channelId: string | null;
}

export function logEvent(
  db: Db,
  e: { level?: EventLevel; source: string; message: string; jobId?: string; channelId?: string },
): void {
  db.prepare(
    "INSERT INTO events (at, level, source, message, job_id, channel_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(new Date().toISOString(), e.level ?? "info", e.source, e.message.slice(0, 2000), e.jobId ?? null, e.channelId ?? null);
}

export function listEvents(db: Db, opts: { jobId?: string; limit?: number } = {}): AppEvent[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = (opts.jobId
    ? db.prepare("SELECT * FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?").all(opts.jobId, limit)
    : db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit)) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    at: r.at as string,
    level: r.level as EventLevel,
    source: r.source as string,
    message: r.message as string,
    jobId: (r.job_id as string) ?? null,
    channelId: (r.channel_id as string) ?? null,
  }));
}
