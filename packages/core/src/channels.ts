import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  channelInputSchema,
  channelPatchSchema,
  type Channel,
  type ChannelInput,
  type ChannelPatch,
} from "@replica/shared";
import type { Db } from "./db.ts";
import { AppError, conflict, notFound } from "./errors.ts";
import { logEvent } from "./events.ts";
import { channelDir } from "./paths.ts";

type Row = Record<string, unknown>;

const toChannel = (r: Row): Channel => ({
  id: r.id as string,
  name: r.name as string,
  niche: r.niche as string,
  audience: r.audience as string,
  language: r.language as string,
  tone: r.tone as string,
  primaryColor: r.primary_color as string,
  secondaryColor: r.secondary_color as string,
  targetDurationSeconds: r.target_duration_seconds as number,
  formats: JSON.parse(r.formats as string),
  voice: JSON.parse(r.voice as string),
  frequency: r.frequency as Channel["frequency"],
  maxPerPeriod: r.max_per_period as number,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  archivedAt: (r.archived_at as string) ?? null,
});

export function zodFields(err: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const i of err.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return fields;
}

const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test((e as Error)?.message ?? "");

export class ChannelRepo {
  constructor(
    private db: Db,
    private storageDir: string,
  ) {}

  list(includeArchived = false): Channel[] {
    const sql = `SELECT * FROM channels ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY created_at DESC, rowid DESC`;
    return (this.db.prepare(sql).all() as Row[]).map(toChannel);
  }

  get(id: string): Channel {
    const r = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw notFound("Canal");
    return toChannel(r);
  }

  create(input: unknown): Channel {
    const parsed = channelInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, "validation_error", "Dados do canal inválidos", zodFields(parsed.error));
    const d = parsed.data;
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO channels (id, name, niche, audience, language, tone, primary_color, secondary_color,
             target_duration_seconds, formats, voice, frequency, max_per_period, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, d.name, d.niche, d.audience, d.language, d.tone, d.primaryColor, d.secondaryColor,
          d.targetDurationSeconds, JSON.stringify(d.formats), JSON.stringify(d.voice), d.frequency,
          d.maxPerPeriod, now, now,
        );
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Já existe um canal ativo com esse nome");
      throw e;
    }
    mkdirSync(channelDir(this.storageDir, id), { recursive: true });
    logEvent(this.db, { source: "channels", message: `Canal criado: ${d.name}`, channelId: id });
    return this.get(id);
  }

  update(id: string, patch: unknown): Channel {
    const current = this.get(id);
    if (current.archivedAt) throw conflict("Canal arquivado não pode ser editado");
    const parsed = channelPatchSchema.safeParse(patch);
    if (!parsed.success) throw new AppError(400, "validation_error", "Dados do canal inválidos", zodFields(parsed.error));
    const p: ChannelPatch = parsed.data;
    const merged = { ...current, ...p };
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `UPDATE channels SET name=?, niche=?, audience=?, language=?, tone=?, primary_color=?, secondary_color=?,
             target_duration_seconds=?, formats=?, voice=?, frequency=?, max_per_period=?, updated_at=? WHERE id=?`,
        )
        .run(
          merged.name, merged.niche, merged.audience, merged.language, merged.tone, merged.primaryColor,
          merged.secondaryColor, merged.targetDurationSeconds, JSON.stringify(merged.formats),
          JSON.stringify(merged.voice), merged.frequency, merged.maxPerPeriod, now, id,
        );
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Já existe um canal ativo com esse nome");
      throw e;
    }
    logEvent(this.db, { source: "channels", message: `Canal atualizado: ${merged.name}`, channelId: id });
    return this.get(id);
  }

  /** Arquivar em vez de apagar: nenhum dado é eliminado sem autorização explícita. */
  archive(id: string): Channel {
    const c = this.get(id);
    if (c.archivedAt) return c;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE channels SET archived_at=?, updated_at=? WHERE id=?").run(now, now, id);
    logEvent(this.db, { source: "channels", message: `Canal arquivado: ${c.name}`, channelId: id });
    return this.get(id);
  }

  restore(id: string): Channel {
    const c = this.get(id);
    if (!c.archivedAt) return c;
    try {
      this.db.prepare("UPDATE channels SET archived_at=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Já existe um canal ativo com esse nome");
      throw e;
    }
    logEvent(this.db, { source: "channels", message: `Canal restaurado: ${c.name}`, channelId: id });
    return this.get(id);
  }
}
export type { ChannelInput };
