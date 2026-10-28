import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SCENE_KINDS, scriptContentSchema, type Channel, type Idea, type Origin, type ScriptContent, type Source } from "@replica/shared";
import type { Db } from "./db.ts";
import { ChannelRepo } from "./channels.ts";
import { AppError, notFound } from "./errors.ts";
import { IdeaRepo } from "./ideas.ts";
import { ScriptRepo } from "./scripts.ts";

export interface GenContext { idea: Idea; channel: Channel; sources: Source[] }
export interface Availability { ok: boolean; reason?: string }

/** Um gerador transforma o contexto editorial em cenas. Sem estado e sem acesso à base de dados. */
export interface Generator {
  id: Origin;
  label: string;
  /** Verdadeiro se o conteúdo é escrito por IA e tem de ser revisto por uma pessoa. */
  aiGenerated: boolean;
  available(): Promise<Availability>;
  generate(ctx: GenContext): Promise<ScriptContent>;
}

const EN = (lang: string) => lang === "en";

/**
 * Esqueleto determinístico: estrutura de cenas por duração-alvo, SEM narração.
 * Não usa IA e não inventa factos: a narração fica por escrever e bloqueia a aprovação até ser preenchida.
 */
export const templateGenerator: Generator = {
  id: "template",
  label: "Esqueleto (sem IA)",
  aiGenerated: false,
  available: async () => ({ ok: true }),
  async generate({ channel, idea }) {
    const en = EN(channel.language);
    const dev = Math.max(1, Math.min(12, Math.round(channel.targetDurationSeconds / 90) - 2));
    const scenes: ScriptContent["scenes"] = [];
    const add = (kind: (typeof SCENE_KINDS)[number], title: string, visual: string) =>
      scenes.push({ id: `s${scenes.length + 1}`, kind, title, narration: "", visual, sourceIds: [] });
    add("hook", en ? "Hook" : "Gancho", en ? `Opening visual for: ${idea.title}` : `Imagem de abertura para: ${idea.title}`);
    for (let i = 1; i <= dev; i++) add("development", en ? `Point ${i}` : `Ponto ${i}`, "");
    add("example", en ? "Example" : "Exemplo", "");
    add("conclusion", en ? "Conclusion" : "Conclusão", "");
    return { scenes };
  },
};

export interface OllamaConfig { url: string; model: string }
const rawSceneSchema = z.object({
  scenes: z.array(z.object({
    kind: z.enum(SCENE_KINDS),
    title: z.string().default(""),
    narration: z.string().default(""),
    visual: z.string().default(""),
    sources: z.array(z.string()).default([]),
  })).min(1),
});

/** LLM local gratuito via Ollama (http://127.0.0.1:11434). Só fica disponível se OLLAMA_MODEL estiver definido. */
export function ollamaGenerator(cfg: OllamaConfig | null): Generator {
  const label = cfg ? `Ollama local (${cfg.model})` : "Ollama local";
  return {
    id: "ollama",
    label,
    aiGenerated: true,
    async available() {
      if (!cfg) return { ok: false, reason: "Defina OLLAMA_MODEL (e instale o Ollama, gratuito) para ativar." };
      try {
        const r = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!r.ok) return { ok: false, reason: `Ollama respondeu ${r.status}` };
        const j = (await r.json()) as { models?: { name: string }[] };
        const has = j.models?.some((m) => m.name === cfg.model || m.name.startsWith(`${cfg.model}:`));
        return has ? { ok: true } : { ok: false, reason: `Modelo "${cfg.model}" não instalado (ollama pull ${cfg.model}).` };
      } catch {
        return { ok: false, reason: `Ollama inacessível em ${cfg.url}.` };
      }
    },
    async generate({ idea, channel, sources }) {
      if (!cfg) throw new AppError(409, "generator_unavailable", "Ollama não configurado");
      const refs = sources.map((s, i) => `S${i + 1}: ${s.title}${s.url ? ` <${s.url}>` : ""}${s.quote ? ` — citação: "${s.quote}"` : ""}${s.note ? ` — nota: ${s.note}` : ""}`);
      const prompt = [
        `Escreve um roteiro de vídeo em ${channel.language} para o canal "${channel.name}" (nicho: ${channel.niche}; público: ${channel.audience}; tom: ${channel.tone || "neutro"}).`,
        `Ideia: ${idea.title}. ${idea.description}`,
        `Duração-alvo: cerca de ${Math.round(channel.targetDurationSeconds / 60)} minutos (≈150 palavras/minuto de narração).`,
        refs.length
          ? `Fontes disponíveis (usa APENAS estas para afirmações factuais e indica-as em "sources" pelo código):\n${refs.join("\n")}`
          : "Não há fontes: evita afirmações factuais específicas (datas, números, citações) e deixa \"sources\" vazio.",
        `Responde SÓ com JSON: {"scenes":[{"kind":"hook|development|example|conclusion","title":"","narration":"","visual":"","sources":["S1"]}]}. A primeira cena é "hook" e a última "conclusion".`,
      ].join("\n\n");
      const res = await fetch(`${cfg.url}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.model, prompt, stream: false, format: "json" }),
        signal: AbortSignal.timeout(5 * 60_000),
      }).catch((e) => { throw new Error(`Ollama inacessível: ${(e as Error).message}`); });
      if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
      const body = (await res.json()) as { response?: string };
      let parsed: unknown;
      try { parsed = JSON.parse(body.response ?? ""); } catch { throw new Error("O modelo não devolveu JSON válido"); }
      const raw = rawSceneSchema.safeParse(parsed);
      if (!raw.success) throw new Error("O JSON do modelo não tem o formato esperado de cenas");
      const byRef = new Map(sources.map((s, i) => [`S${i + 1}`, s.id]));
      const scenes = raw.data.scenes.map((s) => ({
        id: randomUUID(), kind: s.kind, title: s.title.slice(0, 120), narration: s.narration.slice(0, 3000), visual: s.visual.slice(0, 1000),
        // Referências inventadas pelo modelo são descartadas: só fontes reais ficam associadas.
        sourceIds: [...new Set(s.sources.map((r) => byRef.get(r.trim().toUpperCase())).filter((x): x is string => !!x))],
      }));
      const out = scriptContentSchema.safeParse({ scenes });
      if (!out.success) throw new Error("Roteiro gerado inválido: " + out.error.issues[0]?.message);
      return out.data;
    },
  };
}

export function getGenerators(env: NodeJS.ProcessEnv = process.env): Record<Origin, Generator | undefined> {
  const model = env.OLLAMA_MODEL?.trim();
  return {
    manual: undefined,
    template: templateGenerator,
    ollama: ollamaGenerator(model ? { url: (env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""), model } : null),
  };
}

export async function listGenerators(env: NodeJS.ProcessEnv = process.env) {
  const gens = Object.values(getGenerators(env)).filter((g): g is Generator => !!g);
  return Promise.all(gens.map(async (g) => ({ id: g.id, label: g.label, aiGenerated: g.aiGenerated, ...(await g.available()) })));
}

/** Gera e guarda uma NOVA versão do roteiro (nunca altera versões anteriores). */
export async function generateScript(db: Db, ideaId: string, adapter: string, env: NodeJS.ProcessEnv = process.env) {
  const g = adapter === "manual" ? undefined : getGenerators(env)[adapter as Origin];
  if (!g) throw notFound("Gerador");
  const av = await g.available();
  if (!av.ok) throw new AppError(409, "generator_unavailable", av.reason ?? "Gerador indisponível");
  const ideas = new IdeaRepo(db);
  const idea = ideas.get(ideaId);
  const channel = new ChannelRepo(db, "").get(idea.channelId);
  const content = await g.generate({ idea, channel, sources: ideas.sources(ideaId) });
  const note = g.aiGenerated ? `Gerado por ${g.label}. Rever antes de aprovar.` : "Esqueleto gerado: falta escrever a narração.";
  return new ScriptRepo(db).addVersion(ideaId, content, g.id, note);
}
