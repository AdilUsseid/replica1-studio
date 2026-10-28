import { useState, type FormEvent } from "react";
import { channelInputSchema, FORMATS, FREQUENCIES, LANGUAGES, type Channel, type ChannelInput } from "@replica/shared";
import { ApiError } from "../api";

const FORMAT_LABEL = { horizontal: "Horizontal 16:9", short: "Short 9:16" } as const;
const FREQ_LABEL = { manual: "Manual", daily: "Diária", weekly: "Semanal" } as const;

interface Props {
  initial?: Channel;
  onSubmit: (data: ChannelInput) => Promise<void>;
  onCancel: () => void;
}

export function ChannelForm({ initial, onSubmit, onCancel }: Props) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    niche: initial?.niche ?? "",
    audience: initial?.audience ?? "",
    language: initial?.language ?? "pt-MZ",
    tone: initial?.tone ?? "",
    primaryColor: initial?.primaryColor ?? "#6d5efc",
    secondaryColor: initial?.secondaryColor ?? "#12b5a6",
    targetDurationSeconds: String(initial?.targetDurationSeconds ?? 600),
    formats: initial?.formats ?? (["horizontal"] as string[]),
    voiceProvider: initial?.voice.provider ?? "",
    voiceId: initial?.voice.voiceId ?? "",
    frequency: initial?.frequency ?? "manual",
    maxPerPeriod: String(initial?.maxPerPeriod ?? 1),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v, val: string | string[]) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const candidate = {
      name: v.name, niche: v.niche, audience: v.audience, language: v.language, tone: v.tone,
      primaryColor: v.primaryColor, secondaryColor: v.secondaryColor,
      targetDurationSeconds: v.targetDurationSeconds.trim() === "" ? NaN : Number(v.targetDurationSeconds),
      formats: v.formats, voice: { provider: v.voiceProvider, voiceId: v.voiceId },
      frequency: v.frequency, maxPerPeriod: v.maxPerPeriod.trim() === "" ? NaN : Number(v.maxPerPeriod),
    };
    const parsed = channelInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[i.path[0] === "voice" ? "voice" : String(i.path[0])] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(candidate as ChannelInput);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (id: keyof typeof v, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={`f-${id}`}>{label}</label>
      {input}
      {hint && !errors[id] && <small className="hint">{hint}</small>}
      {errors[id] && <small className="err" role="alert">{errors[id]}</small>}
    </div>
  );
  const text = (id: "name" | "niche" | "audience" | "tone" | "voiceProvider" | "voiceId", ph = "") => (
    <input id={`f-${id}`} value={v[id]} placeholder={ph} aria-invalid={!!errors[id]} onChange={(e) => set(id, e.target.value)} />
  );
  const secs = Number(v.targetDurationSeconds);

  return (
    <form className="card form" onSubmit={submit} noValidate aria-label={initial ? "Editar canal" : "Novo canal"}>
      <h2>{initial ? "Editar canal" : "Novo canal"}</h2>
      <div className="grid2">
        {field("name", "Nome", text("name", "Ex.: História da Tecnologia"))}
        {field("niche", "Nicho", text("niche", "Ex.: Tecnologia"))}
      </div>
      {field("audience", "Público-alvo", text("audience", "Ex.: Estudantes universitários"))}
      <div className="grid2">
        {field("language", "Idioma", (
          <select id="f-language" value={v.language} onChange={(e) => set("language", e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        ))}
        {field("tone", "Tom editorial", text("tone", "Ex.: Claro, curioso, sem jargão"))}
      </div>
      <div className="grid2">
        {field("primaryColor", "Cor principal", <input id="f-primaryColor" type="color" value={v.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />)}
        {field("secondaryColor", "Cor secundária", <input id="f-secondaryColor" type="color" value={v.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} />)}
      </div>
      <div className="grid2">
        {field("targetDurationSeconds", "Duração pretendida (segundos)", (
          <input id="f-targetDurationSeconds" inputMode="numeric" value={v.targetDurationSeconds} aria-invalid={!!errors.targetDurationSeconds} onChange={(e) => set("targetDurationSeconds", e.target.value)} />
        ), Number.isFinite(secs) && secs > 0 ? `≈ ${(secs / 60).toFixed(1)} min` : undefined)}
        {field("maxPerPeriod", "Máx. de produções por período", <input id="f-maxPerPeriod" inputMode="numeric" value={v.maxPerPeriod} aria-invalid={!!errors.maxPerPeriod} onChange={(e) => set("maxPerPeriod", e.target.value)} />)}
      </div>
      <fieldset className="field">
        <legend>Formatos</legend>
        <div className="checks">
          {FORMATS.map((f) => (
            <label key={f} className="check">
              <input type="checkbox" checked={v.formats.includes(f)} onChange={(e) => set("formats", e.target.checked ? [...v.formats, f] : v.formats.filter((x) => x !== f))} />
              {FORMAT_LABEL[f]}
            </label>
          ))}
        </div>
        {errors.formats && <small className="err" role="alert">{errors.formats}</small>}
      </fieldset>
      <div className="grid3">
        {field("voiceProvider", "Voz: motor", text("voiceProvider", "Definido na Fase 4"), "Opcional por agora")}
        {field("voiceId", "Voz: identificador", text("voiceId"))}
        {field("frequency", "Frequência", (
          <select id="f-frequency" value={v.frequency} onChange={(e) => set("frequency", e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
          </select>
        ))}
      </div>
      {formError && <p className="banner error" role="alert">{formError}</p>}
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={saving}>{saving ? "A guardar…" : initial ? "Guardar alterações" : "Criar canal"}</button>
      </div>
    </form>
  );
}
