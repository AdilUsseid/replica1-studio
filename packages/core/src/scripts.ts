import { createHash, randomUUID } from "node:crypto";
import {
  checkScript, estimateSeconds, scriptContentSchema,
  type Origin, type ScriptContent, type ScriptState, type ScriptVersionSummary,
} from "@replica/shared";
import type { Db } from "./db.ts";
import { AppError, conflict, notFound } from "./errors.ts";
import { logEvent } from "./events.ts";
import { zodFields } from "./channels.ts";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export class ScriptRepo {
  constructor(private db: Db) {}

  private ideaInfo(ideaId: string) {
    const r = this.db.prepare("SELECT i.id, i.channel_id, i.archived_at, c.language FROM ideas i JOIN channels c ON c.id = i.channel_id WHERE i.id = ?").get(ideaId) as
      | { id: string; channel_id: string; archived_at: string | null; language: string } | undefined;
    if (!r) throw notFound("Ideia");
    return r;
  }

  private sourceIds(ideaId: string): string[] {
    return (this.db.prepare("SELECT id FROM sources WHERE idea_id=?").all(ideaId) as { id: string }[]).map((r) => r.id);
  }

  /** Cria uma nova versão imutável. Conteúdo idêntico ao da última versão não duplica. */
  addVersion(ideaId: string, input: unknown, origin: Origin, note = ""): ScriptState {
    const info = this.ideaInfo(ideaId);
    if (info.archived_at) throw conflict("Ideia arquivada não pode ter novas versões de roteiro");
    const p = scriptContentSchema.safeParse(input);
    if (!p.success) throw new AppError(400, "validation_error", "Roteiro inválido", zodFields(p.error));
    const content = JSON.stringify(p.data);
    const h = hash(content);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      let script = this.db.prepare("SELECT id FROM scripts WHERE idea_id=?").get(ideaId) as { id: string } | undefined;
      if (!script) {
        script = { id: randomUUID() };
        this.db.prepare("INSERT INTO scripts (id, idea_id, created_at) VALUES (?,?,?)").run(script.id, ideaId, now());
      }
      const last = this.db.prepare("SELECT version, content_hash FROM script_versions WHERE script_id=? ORDER BY version DESC LIMIT 1").get(script.id) as
        | { version: number; content_hash: string } | undefined;
      if (last && last.content_hash === h) {
        this.db.exec("COMMIT");
        return this.state(ideaId);
      }
      const version = (last?.version ?? 0) + 1;
      this.db.prepare("INSERT INTO script_versions (id, script_id, version, content, content_hash, origin, note, created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), script.id, version, content, h, origin, note, now());
      // Qualquer alteração invalida aprovações anteriores deste roteiro.
      const inv = this.db.prepare(
        `UPDATE approvals SET invalidated_at=?, invalidated_reason=? WHERE kind='script' AND invalidated_at IS NULL
           AND target_id IN (SELECT id FROM script_versions WHERE script_id=?)`,
      ).run(now(), `Nova versão ${version} (${origin})`, script.id);
      this.db.exec("COMMIT");
      logEvent(this.db, {
        source: "scripts", channelId: info.channel_id,
        message: `Roteiro v${version} guardado (${origin})${Number(inv.changes) ? " — aprovação anterior invalidada" : ""}`,
      });
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.state(ideaId);
  }

  private latest(ideaId: string): { id: string; version: number; content: string; hash: string; origin: Origin } | null {
    const r = this.db.prepare(
      `SELECT v.id, v.version, v.content, v.content_hash, v.origin FROM script_versions v JOIN scripts s ON s.id=v.script_id
       WHERE s.idea_id=? ORDER BY v.version DESC LIMIT 1`,
    ).get(ideaId) as Row | undefined;
    return r ? { id: r.id as string, version: r.version as number, content: r.content as string, hash: r.content_hash as string, origin: r.origin as Origin } : null;
  }

  /** Aprovação válida = não invalidada, ligada à última versão e ao hash exato do conteúdo guardado. */
  private validApproval(v: { id: string; content: string }): { version: number } | null {
    const a = this.db.prepare("SELECT content_hash FROM approvals WHERE kind='script' AND target_id=? AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1").get(v.id) as { content_hash: string } | undefined;
    return a && a.content_hash === hash(v.content) ? { version: 0 } : null;
  }

  state(ideaId: string): ScriptState {
    const info = this.ideaInfo(ideaId);
    const l = this.latest(ideaId);
    if (!l) return { exists: false, latestVersion: null, content: null, origin: null, approved: false, approvedVersion: null, versions: [], issues: [], totalSeconds: 0 };
    const content = JSON.parse(l.content) as ScriptContent;
    const approved = !!this.validApproval(l);
    const versions = (this.db.prepare(
      `SELECT v.id, v.version, v.origin, v.note, v.created_at,
         EXISTS (SELECT 1 FROM approvals a WHERE a.kind='script' AND a.target_id=v.id AND a.invalidated_at IS NULL) AS approved
       FROM script_versions v JOIN scripts s ON s.id=v.script_id WHERE s.idea_id=? ORDER BY v.version DESC`,
    ).all(ideaId) as Row[]).map((r): ScriptVersionSummary => ({
      version: r.version as number, origin: r.origin as Origin, note: r.note as string, createdAt: r.created_at as string, approved: !!r.approved,
    }));
    return {
      exists: true, latestVersion: l.version, content, origin: l.origin, approved,
      approvedVersion: approved ? l.version : null, versions,
      issues: checkScript(content, this.sourceIds(ideaId)),
      totalSeconds: content.scenes.reduce((n, s) => n + estimateSeconds(s.narration, info.language), 0),
    };
  }

  getVersion(ideaId: string, version: number): { version: number; origin: Origin; note: string; createdAt: string; content: ScriptContent } {
    this.ideaInfo(ideaId);
    const r = this.db.prepare(
      `SELECT v.version, v.origin, v.note, v.created_at, v.content FROM script_versions v JOIN scripts s ON s.id=v.script_id WHERE s.idea_id=? AND v.version=?`,
    ).get(ideaId, version) as Row | undefined;
    if (!r) throw notFound("Versão do roteiro");
    return { version: r.version as number, origin: r.origin as Origin, note: r.note as string, createdAt: r.created_at as string, content: JSON.parse(r.content as string) };
  }

  /** Aprova exatamente a última versão, se não houver erros bloqueantes. */
  approve(ideaId: string, version: number): ScriptState {
    this.ideaInfo(ideaId);
    const l = this.latest(ideaId);
    if (!l) throw conflict("Ainda não existe roteiro");
    if (l.version !== version) throw conflict(`Só a versão mais recente (v${l.version}) pode ser aprovada`);
    if (this.validApproval(l)) return this.state(ideaId);
    const errors = checkScript(JSON.parse(l.content), this.sourceIds(ideaId)).filter((i) => i.level === "error");
    if (errors.length) throw new AppError(422, "script_has_errors", "Corrija os erros antes de aprovar", Object.fromEntries(errors.map((e, i) => [String(i), e.message])));
    this.db.prepare("INSERT INTO approvals (id, kind, target_id, content_hash, approved_at) VALUES (?,?,?,?,?)")
      .run(randomUUID(), "script", l.id, hash(l.content), now());
    logEvent(this.db, { source: "scripts", message: `Roteiro v${l.version} aprovado` });
    return this.state(ideaId);
  }
}
