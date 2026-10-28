import { z } from "zod";

export const LANGUAGES = [
  { code: "pt-MZ", label: "Português (Moçambique)" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
] as const;

export const FORMATS = ["horizontal", "short"] as const;
export const FREQUENCIES = ["manual", "daily", "weekly"] as const;

export type Format = (typeof FORMATS)[number];
export type Frequency = (typeof FREQUENCIES)[number];

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor hexadecimal no formato #RRGGBB");

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} é obrigatório`)
    .max(max, `${label} deve ter no máximo ${max} caracteres`);

const optionalText = (max: number) =>
  z.string().trim().max(max, `Deve ter no máximo ${max} caracteres`);

/**
 * Campos editáveis de um canal. Nada disto é fixo no código.
 * `withDefaults=false` gera a variante usada em PATCH: um campo não enviado
 * nunca pode ser reposto num valor por omissão.
 */
function channelShape(withDefaults: boolean) {
  const d = <T extends z.ZodType>(schema: T, value: z.output<T>) =>
    (withDefaults ? schema.default(value as never) : schema.optional()) as unknown as z.ZodType<
      z.output<T>
    >;
  return {
    tone: d(optionalText(300), ""),
    primaryColor: d(hexColor, "#6d5efc"),
    secondaryColor: d(hexColor, "#12b5a6"),
    targetDurationSeconds: d(
      z
        .number()
        .int("A duração deve ser um número inteiro de segundos")
        .min(15, "A duração mínima é 15 segundos")
        .max(3600, "A duração máxima é 3600 segundos (60 minutos)"),
      600,
    ),
    formats: d(
      z
        .array(z.enum(FORMATS))
        .min(1, "Escolha pelo menos um formato")
        .refine((f) => new Set(f).size === f.length, "Formatos repetidos"),
      ["horizontal"] as Format[],
    ),
    voice: d(
      z.object({
        provider: optionalText(40).default(""),
        voiceId: optionalText(80).default(""),
      }),
      { provider: "", voiceId: "" },
    ),
    frequency: d(z.enum(FREQUENCIES), "manual" as Frequency),
    maxPerPeriod: d(z.number().int().min(1, "Mínimo 1").max(50, "Máximo 50"), 1),
  };
}

const languageEnum = z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]);

export const channelInputSchema = z.object({
  name: text("O nome", 80),
  niche: text("O nicho", 120),
  audience: text("O público-alvo", 200),
  language: languageEnum,
  ...channelShape(true),
});

export type ChannelInput = z.input<typeof channelInputSchema>;
export type ChannelData = z.output<typeof channelInputSchema>;

/** Actualização parcial: só os campos enviados são validados e alterados. */
export const channelPatchSchema = z
  .object({
    name: text("O nome", 80).optional(),
    niche: text("O nicho", 120).optional(),
    audience: text("O público-alvo", 200).optional(),
    language: languageEnum.optional(),
    ...channelShape(false),
  })
  .refine((v) => Object.keys(v).length > 0, "Nenhum campo para actualizar");

export type ChannelPatch = z.output<typeof channelPatchSchema>;

export interface Channel extends ChannelData {
  id: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Erros por campo, quando a validação falha. */
    fields?: Record<string, string>;
  };
}
