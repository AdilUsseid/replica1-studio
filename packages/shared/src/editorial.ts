import { z } from "zod";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} é obrigatório`).max(max, `${label}: máximo ${max} caracteres`);
const optText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);

export const IDEA_STATUSES = ["queued", "in_progress", "discarded"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const ideaInputSchema = z.object({
  channelId: z.string().min(1, "Escolha um canal"),
  title: text("O título", 160),
  description: optText(2000).default(""),
});
export const ideaPatchSchema = z
  .object({
    title: text("O título", 160).optional(),
    description: optText(2000).optional(),
    status: z.enum(IDEA_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nenhum campo para atualizar");

/** URL de fonte: só http(s). Outros esquemas (file:, javascript:, data:) são rejeitados. */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use um URL http(s) válido");

export const sourceInputSchema = z.object({
  title: text("O título da fonte", 200),
  url: z.union([httpUrl, z.literal("")]).default(""),
  note: optText(1000).default(""),
  quote: optText(2000).default(""),
  /** Data em que o utilizador consultou a fonte (AAAA-MM-DD). Opcional: não é inventada. */
  accessedAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"), z.literal("")]).default(""),
});
export const sourcePatchSchema = z
  .object({
    title: text("O título da fonte", 200).optional(),
    url: z.union([httpUrl, z.literal("")]).optional(),
    note: optText(1000).optional(),
    quote: optText(2000).optional(),
    accessedAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"), z.literal("")]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nenhum campo para atualizar");

export const SCENE_KINDS = ["hook", "development", "example", "conclusion"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(SCENE_KINDS),
  title: optText(120).default(""),
  narration: optText(3000).default(""),
  visual: optText(1000).default(""),
  sourceIds: z.array(z.string().min(1)).max(20).default([]),
});
export const scriptContentSchema = z.object({
  scenes: z.array(sceneSchema).min(1, "O roteiro precisa de pelo menos uma cena").max(60, "Máximo 60 cenas"),
});
export type Scene = z.output<typeof sceneSchema>;
export type ScriptContent = z.output<typeof scriptContentSchema>;
export type ScriptContentInput = z.input<typeof scriptContentSchema>;

export const ORIGINS = ["manual", "template", "ollama"] as const;
export type Origin = (typeof ORIGINS)[number];

/** Palavras por minuto de narração por idioma (valor por omissão; ajustável no futuro por voz). */
const WPM: Record<string, number> = { en: 160, es: 170, fr: 165 };
export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const estimateSeconds = (narration: string, language = "pt-MZ") =>
  Math.round((wordCount(narration) / (WPM[language] ?? 150)) * 60);

export type IssueLevel = "error" | "warning";
export interface ScriptIssue { level: IssueLevel; sceneId?: string; message: string }

/** Verificações do roteiro. Erros bloqueiam a aprovação; avisos não. */
export function checkScript(content: ScriptContent, sourceIdsAvailable: string[]): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const known = new Set(sourceIdsAvailable);
  content.scenes.forEach((s, i) => {
    const n = i + 1;
    if (!s.narration.trim()) issues.push({ level: "error", sceneId: s.id, message: `Cena ${n}: sem texto de narração` });
    const bad = s.sourceIds.filter((x) => !known.has(x));
    if (bad.length) issues.push({ level: "error", sceneId: s.id, message: `Cena ${n}: referencia fontes que já não existem` });
    if (s.narration.trim() && s.sourceIds.length === 0 && s.kind !== "hook" && s.kind !== "conclusion")
      issues.push({ level: "warning", sceneId: s.id, message: `Cena ${n}: sem fonte associada` });
    if (!s.visual.trim()) issues.push({ level: "warning", sceneId: s.id, message: `Cena ${n}: sem instruções visuais` });
  });
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Map<string, number>();
  content.scenes.forEach((s, i) => {
    const k = norm(s.narration);
    if (k.length > 20 && seen.has(k)) issues.push({ level: "warning", sceneId: s.id, message: `Cena ${i + 1}: texto repetido da cena ${seen.get(k)}` });
    else if (k.length > 20) seen.set(k, i + 1);
  });
  return issues;
}

export interface Idea {
  id: string; channelId: string; title: string; description: string; status: IdeaStatus;
  position: number; createdAt: string; updatedAt: string; archivedAt: string | null;
  sourceCount: number; hasScript: boolean; scriptApproved: boolean;
}
export interface Source {
  id: string; ideaId: string; title: string; url: string; note: string; quote: string; accessedAt: string; createdAt: string;
}
export interface ScriptVersionSummary { version: number; origin: Origin; note: string; createdAt: string; approved: boolean }
export interface ScriptState {
  exists: boolean;
  latestVersion: number | null;
  content: ScriptContent | null;
  origin: Origin | null;
  approved: boolean;
  approvedVersion: number | null;
  versions: ScriptVersionSummary[];
  issues: ScriptIssue[];
  totalSeconds: number;
}
