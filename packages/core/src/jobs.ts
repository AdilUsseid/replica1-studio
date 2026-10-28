import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { conflict, notFound } from "./errors.ts";
import { logEvent } from "./events.ts";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Transições válidas. Qualquer outra é rejeitada. */
export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "queued"], // queued = nova tentativa / recuperação
  failed: ["queued"], // repetição manual
  succeeded: [],
  cancelled: [],
};

export const canTransition = (from: JobStatus, to: JobStatus) => TRANSITIONS[from].includes(to);

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  params: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
  channelId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

type Row = Record<string, unknown>;
const parse = (s: unknown) => (typeof s === "string" ? JSON.parse(s) : null);

const toJob = (r: Row): Job => ({
  id: r.id as string,
  type: r.type as string,
  status: r.status as JobStatus,
  progress: r.progress as number,
  params: parse(r.params) ?? {},
  result: parse(r.result),
  error: (r.error as string) ?? null,
  attempts: r.attempts as number,
  maxAttempts: r.max_attempts as number,
  cancelRequested: !!r.cancel_requested,
  channelId: (r.channel_id as string) ?? null,
  createdAt: r.created_at as string,
  startedAt: (r.started_at as string) ?? null,
  finishedAt: (r.finished_at as string) ?? null,
  updatedAt: r.updated_at as string,
});

const now = () => new Date().toISOString();

export class JobRepo {
  constructor(private db: Db) {}

  get(id: string): Job {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw notFound("Job");
    return toJob(r);
  }

  list(opts: { status?: JobStatus; limit?: number } = {}): Job[] {
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = (opts.status
      ? this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(opts.status, limit)
      : this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit)) as Row[];
    return rows.map(toJob);
  }

  enqueue(type: string, params: unknown = {}, opts: { channelId?: string; maxAttempts?: number } = {}): Job {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, status, params, max_attempts, channel_id, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`,
      )
      .run(id, type, JSON.stringify(params), opts.maxAttempts ?? 3, opts.channelId ?? null, t, t);
    logEvent(this.db, { source: "jobs", message: `Job em fila: ${type}`, jobId: id, channelId: opts.channelId });
    return this.get(id);
  }

  /** Reclama atomicamente o job mais antigo em fila. Devolve null se não houver. */
  claimNext(types?: string[]): Job | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const filter = types?.length ? `AND type IN (${types.map(() => "?").join(",")})` : "";
      const r = this.db
        .prepare(`SELECT id FROM jobs WHERE status='queued' ${filter} ORDER BY created_at, rowid LIMIT 1`)
        .get(...(types ?? [])) as { id: string } | undefined;
      if (!r) {
        this.db.exec("COMMIT");
        return null;
      }
      const t = now();
      this.db
        .prepare(
          "UPDATE jobs SET status='running', attempts=attempts+1, started_at=?, finished_at=NULL, error=NULL, progress=0, updated_at=? WHERE id=?",
        )
        .run(t, t, r.id);
      this.db.exec("COMMIT");
      logEvent(this.db, { source: "worker", message: "Job iniciado", jobId: r.id });
      return this.get(r.id);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  setProgress(id: string, progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.db.prepare("UPDATE jobs SET progress=?, updated_at=? WHERE id=? AND status='running'").run(p, now(), id);
  }

  private transition(id: string, to: JobStatus, patch: { result?: unknown; error?: string } = {}): Job {
    const job = this.get(id);
    if (!canTransition(job.status, to)) {
      throw conflict(`Transição inválida: ${job.status} → ${to}`);
    }
    const t = now();
    const finished = to === "succeeded" || to === "failed" || to === "cancelled";
    this.db
      .prepare(
        `UPDATE jobs SET status=?, result=COALESCE(?, result), error=?, progress=CASE WHEN ?='succeeded' THEN 1 ELSE progress END,
           cancel_requested=CASE WHEN ? IN ('queued','cancelled') THEN 0 ELSE cancel_requested END,
           finished_at=?, updated_at=? WHERE id=?`,
      )
      .run(
        to,
        patch.result === undefined ? null : JSON.stringify(patch.result),
        patch.error ?? null,
        to,
        to,
        finished ? t : null,
        t,
        id,
      );
    return this.get(id);
  }

  succeed(id: string, result: unknown = {}): Job {
    const j = this.transition(id, "succeeded", { result });
    logEvent(this.db, { source: "worker", message: "Job concluído", jobId: id });
    return j;
  }

  /** Falha: volta à fila se ainda houver tentativas; caso contrário fica em 'failed'. */
  fail(id: string, error: string): Job {
    const job = this.get(id);
    if (job.status !== "running") throw conflict(`Transição inválida: ${job.status} → failed`);
    if (job.cancelRequested) return this.cancelRunning(id);
    const willRetry = job.attempts < job.maxAttempts;
    logEvent(this.db, {
      level: "error",
      source: "worker",
      message: `Falha (tentativa ${job.attempts}/${job.maxAttempts}): ${error}${willRetry ? " — nova tentativa" : ""}`,
      jobId: id,
    });
    if (willRetry) {
      const j = this.transition(id, "queued");
      this.db.prepare("UPDATE jobs SET error=? WHERE id=?").run(error, id);
      return { ...j, error };
    }
    return this.transition(id, "failed", { error });
  }

  /** Cancelamento seguro: em fila cancela já; em execução pede ao worker que pare. */
  cancel(id: string): Job {
    const job = this.get(id);
    if (job.status === "queued") {
      logEvent(this.db, { source: "jobs", message: "Job cancelado", jobId: id });
      return this.transition(id, "cancelled");
    }
    if (job.status === "running") {
      this.db.prepare("UPDATE jobs SET cancel_requested=1, updated_at=? WHERE id=?").run(now(), id);
      logEvent(this.db, { source: "jobs", message: "Cancelamento pedido", jobId: id });
      return this.get(id);
    }
    throw conflict(`Não é possível cancelar um job ${job.status}`);
  }

  cancelRunning(id: string): Job {
    logEvent(this.db, { source: "worker", message: "Job cancelado durante a execução", jobId: id });
    return this.transition(id, "cancelled");
  }

  isCancelRequested(id: string): boolean {
    const r = this.db.prepare("SELECT cancel_requested FROM jobs WHERE id=?").get(id) as { cancel_requested: number } | undefined;
    return !!r?.cancel_requested;
  }

  /** Repetição manual de um job falhado: começa de novo com um orçamento de tentativas. */
  retry(id: string): Job {
    const job = this.get(id);
    if (job.status !== "failed") throw conflict("Só é possível repetir jobs falhados");
    this.db.prepare("UPDATE jobs SET attempts=0 WHERE id=?").run(id);
    const j = this.transition(id, "queued");
    logEvent(this.db, { source: "jobs", message: "Job reposto em fila", jobId: id });
    return j;
  }

  /**
   * Recuperação após falha/reinício: jobs que ficaram 'running' sem worker vivo
   * voltam à fila (ou falham, se esgotaram as tentativas).
   */
  recoverInterrupted(): number {
    const stuck = this.db.prepare("SELECT id FROM jobs WHERE status='running'").all() as { id: string }[];
    for (const { id } of stuck) {
      logEvent(this.db, { level: "warn", source: "worker", message: "Job interrompido recuperado no arranque", jobId: id });
      this.fail(id, "Interrompido (o worker terminou durante a execução)");
    }
    return stuck.length;
  }
}
