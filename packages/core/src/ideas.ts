import { randomUUID } from "node:crypto";
import {
  ideaInputSchema, ideaPatchSchema, sourceInputSchema, sourcePatchSchema,
  type Idea, type Source,
} from "@replica/shared";
import type { Db } from "./db.ts";
import { AppError, conflict, notFound } from "./errors.ts";
import { logEvent } from "./events.ts";
import { zodFields } from "./channels.ts";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const bad = (e: Parameters<typeof zodFields>[0]) => new AppError(400, "validation_error", "Dados inválidos", zodFields(e));

const toIdea = (r: Row): Idea => ({
  id: r.id as string, channelId: r.channel_id as string, title: r.title as string,
  description: r.description as string, status: r.status as Idea["status"], position: r.position as number,
  createdAt: r.created_at as string, updatedAt: r.updated_at as string, archivedAt: (r.archived_at as string) ?? null,
  sourceCount: (r.source_count as number) ?? 0, hasScript: !!r.has_script, scriptApproved: !!r.script_approved,
});
const toSource = (r: Row): Source => ({
  id: r.id as string, ideaId: r.idea_id as string, title: r.title as string, url: r.url as string,
  note: r.note as string, quote: r.quote as string, accessedAt: r.accessed_at as string, createdAt: r.created_at as string,
});

const IDEA_SELECT = `
  SELECT i.*,
    (SELECT COUNT(*) FROM sources s WHERE s.idea_id = i.id) AS source_count,
    EXISTS (SELECT 1 FROM scripts sc WHERE sc.idea_id = i.id) AS has_script,
    EXISTS (
      SELECT 1 FROM scripts sc
      JOIN script_versions v ON v.script_id = sc.id AND v.version = (SELECT MAX(version) FROM script_versions WHERE script_id = sc.id)
      JOIN approvals a ON a.kind = 'script' AND a.target_id = v.id AND a.invalidated_at IS NULL
      WHERE sc.idea_id = i.id) AS script_approved
  FROM ideas i`;

export class IdeaRepo {
  constructor(private db: Db) {}

  get(id: string): Idea {
    const r = this.db.prepare(`${IDEA_SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
    if (!r) throw notFound("Ideia");
    return toIdea(r);
  }

  list(opts: { channelId?: string; includeArchived?: boolean } = {}): Idea[] {
    const where: string[] = [];
    const args: string[] = [];
    if (!opts.includeArchived) where.push("i.archived_at IS NULL");
    if (opts.channelId) { where.push("i.channel_id = ?"); args.push(opts.channelId); }
    const sql = `${IDEA_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY i.channel_id, i.position`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(toIdea);
  }

  create(input: unknown): Idea {
    const p = ideaInputSchema.safeParse(input);
    if (!p.success) throw bad(p.error);
    const ch = this.db.prepare("SELECT archived_at FROM channels WHERE id = ?").get(p.data.channelId) as { archived_at: string | null } | undefined;
    if (!ch) throw new AppError(400, "validation_error", "Canal inexistente", { channelId: "Canal inexistente" });
    if (ch.archived_at) throw conflict("Não é possível criar ideias num canal arquivado");
    const pos = (this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ideas WHERE channel_id = ?").get(p.data.channelId) as { p: number }).p;
    const id = randomUUID();
    const t = now();
    this.db.prepare("INSERT INTO ideas (id, channel_id, title, description, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, p.data.channelId, p.data.title, p.data.description, pos, t, t);
    logEvent(this.db, { source: "ideas", message: `Ideia criada: ${p.data.title}`, channelId: p.data.channelId });
    return this.get(id);
  }

  update(id: string, patch: unknown): Idea {
    const cur = this.get(id);
    if (cur.archivedAt) throw conflict("Ideia arquivada não pode ser editada");
    const p = ideaPatchSchema.safeParse(patch);
    if (!p.success) throw bad(p.error);
    const m = { ...cur, ...p.data };
    this.db.prepare("UPDATE ideas SET title=?, description=?, status=?, updated_at=? WHERE id=?").run(m.title, m.description, m.status, now(), id);
    return this.get(id);
  }

  /** Reordena a fila editorial trocando com a vizinha ativa do mesmo canal. */
  move(id: string, direction: "up" | "down"): Idea {
    const cur = this.get(id);
    const neighbour = (direction === "up"
      ? this.db.prepare("SELECT id, position FROM ideas WHERE channel_id=? AND archived_at IS NULL AND position < ? ORDER BY position DESC LIMIT 1")
      : this.db.prepare("SELECT id, position FROM ideas WHERE channel_id=? AND archived_at IS NULL AND position > ? ORDER BY position ASC LIMIT 1")
    ).get(cur.channelId, cur.position) as { id: string; position: number } | undefined;
    if (!neighbour) return cur;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE ideas SET position=? WHERE id=?").run(neighbour.position, id);
      this.db.prepare("UPDATE ideas SET position=? WHERE id=?").run(cur.position, neighbour.id);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    return this.get(id);
  }

  archive(id: string): Idea {
    const cur = this.get(id);
    if (cur.archivedAt) return cur;
    this.db.prepare("UPDATE ideas SET archived_at=?, updated_at=? WHERE id=?").run(now(), now(), id);
    logEvent(this.db, { source: "ideas", message: `Ideia arquivada: ${cur.title}`, channelId: cur.channelId });
    return this.get(id);
  }

  // Fontes
  sources(ideaId: string): Source[] {
    this.get(ideaId);
    return (this.db.prepare("SELECT * FROM sources WHERE idea_id=? ORDER BY created_at, rowid").all(ideaId) as Row[]).map(toSource);
  }
  getSource(id: string): Source {
    const r = this.db.prepare("SELECT * FROM sources WHERE id=?").get(id) as Row | undefined;
    if (!r) throw notFound("Fonte");
    return toSource(r);
  }
  addSource(ideaId: string, input: unknown): Source {
    const idea = this.get(ideaId);
    if (idea.archivedAt) throw conflict("Ideia arquivada não aceita novas fontes");
    const p = sourceInputSchema.safeParse(input);
    if (!p.success) throw bad(p.error);
    const id = randomUUID();
    const d = p.data;
    this.db.prepare("INSERT INTO sources (id, idea_id, title, url, note, quote, accessed_at, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, ideaId, d.title, d.url, d.note, d.quote, d.accessedAt, now());
    logEvent(this.db, { source: "sources", message: `Fonte adicionada (manual): ${d.title}`, channelId: idea.channelId });
    return this.getSource(id);
  }
  updateSource(id: string, patch: unknown): Source {
    const cur = this.getSource(id);
    const p = sourcePatchSchema.safeParse(patch);
    if (!p.success) throw bad(p.error);
    const m = { ...cur, ...p.data };
    this.db.prepare("UPDATE sources SET title=?, url=?, note=?, quote=?, accessed_at=? WHERE id=?").run(m.title, m.url, m.note, m.quote, m.accessedAt, id);
    return this.getSource(id);
  }
  /** Uma fonte citada por qualquer versão de roteiro não pode ser removida (preserva o histórico). */
  removeSource(id: string): void {
    const s = this.getSource(id);
    const used = this.db.prepare("SELECT 1 FROM script_versions v JOIN scripts sc ON sc.id = v.script_id WHERE sc.idea_id = ? AND instr(v.content, ?) > 0 LIMIT 1").get(s.ideaId, id);
    if (used) throw conflict("Esta fonte é citada por uma versão do roteiro e não pode ser removida");
    this.db.prepare("DELETE FROM sources WHERE id=?").run(id);
    logEvent(this.db, { source: "sources", message: `Fonte removida: ${s.title}` });
  }
}
