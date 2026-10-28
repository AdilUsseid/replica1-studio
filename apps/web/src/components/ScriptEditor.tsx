import { useEffect, useRef, useState } from "react";
import { estimateSeconds, SCENE_KINDS, type Channel, type Scene, type ScriptState, type Source } from "@replica/shared";
import { api, ApiError, type GeneratorInfo, type Job } from "../api";

const KIND: Record<Scene["kind"], string> = { hook: "Gancho", development: "Desenvolvimento", example: "Exemplo", conclusion: "Conclusão" };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const same = (a: Scene[], b: Scene[]) => JSON.stringify(a) === JSON.stringify(b);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

interface Props { ideaId: string; channel: Channel; sources: Source[]; onChange: () => void }

export function ScriptEditor({ ideaId, channel, sources, onChange }: Props) {
  const [state, setState] = useState<ScriptState | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [gens, setGens] = useState<GeneratorInfo[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string; list?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef<Scene[]>([]);

  const adopt = (st: ScriptState) => {
    setState(st);
    saved.current = st.content?.scenes ?? [];
    setScenes(st.content?.scenes ?? []);
  };
  useEffect(() => {
    let live = true;
    api.script(ideaId).then((st) => live && adopt(st)).catch((e) => live && setMsg({ kind: "error", text: e.message }));
    api.generators().then((g) => live && setGens(g)).catch(() => {});
    return () => { live = false; };
  }, [ideaId]);

  // Acompanha o job de geração (estado real, lido da API).
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await api.job(job.id);
        setJob(j);
        if (j.status === "succeeded") {
          adopt(await api.script(ideaId));
          setMsg({ kind: "info", text: "Roteiro gerado e guardado como nova versão. Reveja antes de aprovar." });
          onChange();
        } else if (j.status === "failed" || j.status === "cancelled") {
          setMsg({ kind: "error", text: j.error ?? "A geração falhou." });
        }
      } catch { /* mantém a consulta */ }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  const dirty = !same(scenes, saved.current);
  const patch = (i: number, p: Partial<Scene>) => setScenes((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => setScenes((s) => { const n = [...s]; const k = i + d; if (k < 0 || k >= n.length) return s; [n[i], n[k]] = [n[k]!, n[i]!]; return n; });
  const addScene = (kind: Scene["kind"]) => setScenes((s) => [...s, { id: uid(), kind, title: "", narration: "", visual: "", sourceIds: [] }]);
  const total = scenes.reduce((n, s) => n + estimateSeconds(s.narration, channel.language), 0);
  const fail = (e: unknown) => {
    const err = e as ApiError;
    setMsg({ kind: "error", text: err.message, list: err.fields ? Object.values(err.fields) : undefined });
  };

  async function save() {
    setBusy(true); setMsg(null);
    try { adopt(await api.saveScript(ideaId, scenes)); setMsg({ kind: "ok", text: "Versão guardada." }); onChange(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function approve() {
    if (!state?.latestVersion) return;
    setBusy(true); setMsg(null);
    try { adopt(await api.approveScript(ideaId, state.latestVersion)); setMsg({ kind: "ok", text: `Versão ${state.latestVersion} aprovada.` }); onChange(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function generate(id: string) {
    setMsg(null);
    try { setJob(await api.generate(ideaId, id)); } catch (e) { fail(e); }
  }
  async function loadVersion(v: number) {
    try { const d = await api.scriptVersion(ideaId, v); setScenes(d.content.scenes); setMsg({ kind: "info", text: `Versão ${v} carregada no editor. Guardar cria uma nova versão; a v${v} não é alterada.` }); } catch (e) { fail(e); }
  }

  if (!state) return <p className="muted">A carregar…</p>;
  const generating = !!job && (job.status === "queued" || job.status === "running");
  const issues = !dirty ? state.issues : [];
  const target = channel.targetDurationSeconds;

  return (
    <div>
      <div className="card toolbar">
        <div>
          <b>Duração estimada: {mmss(total)}</b> <span className="muted">(alvo do canal: {mmss(target)})</span>
          {state.exists && <div className="meta">Versão {state.latestVersion} · origem: {state.origin}{state.approved ? " · " : ""}{state.approved && <span className="pill s-succeeded">Aprovada</span>}</div>}
          {state.origin === "ollama" && !state.approved && <div className="meta">⚠ Texto gerado por IA: reveja factos e fontes.</div>}
        </div>
        <div className="actions">
          {gens.map((g) => (
            <button key={g.id} className="btn ghost" disabled={!g.ok || generating} title={g.ok ? "" : g.reason} onClick={() => generate(g.id)}>
              Gerar: {g.label}
            </button>
          ))}
        </div>
      </div>
      {gens.filter((g) => !g.ok).map((g) => <p key={g.id} className="meta">{g.label} indisponível: {g.reason}</p>)}
      {generating && <p className="banner info" role="status">A gerar em segundo plano ({job!.status === "queued" ? "em fila — o worker tem de estar a correr" : "a executar"})…</p>}
      {msg && (
        <div className={`banner ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>
          {msg.text}{msg.list && <ul>{msg.list.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      )}

      {scenes.length === 0 && <div className="empty card"><h3>Sem roteiro</h3><p className="muted">Gere um esqueleto, ou adicione cenas manualmente.</p></div>}
      <ol className="scenes">
        {scenes.map((s, i) => (
          <li key={s.id} className="card scene">
            <div className="job-head">
              <label className="sr" htmlFor={`k-${s.id}`}>Tipo da cena {i + 1}</label>
              <select id={`k-${s.id}`} value={s.kind} onChange={(e) => patch(i, { kind: e.target.value as Scene["kind"] })}>
                {SCENE_KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
              </select>
              <span className="meta">Cena {i + 1} · ~{estimateSeconds(s.narration, channel.language)}s</span>
              <span className="grow" />
              <button className="btn ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir cena ${i + 1}`}>↑</button>
              <button className="btn ghost" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label={`Descer cena ${i + 1}`}>↓</button>
              <button className="btn ghost" onClick={() => setScenes((x) => x.filter((_, j) => j !== i))} aria-label={`Remover cena ${i + 1}`}>Remover</button>
            </div>
            <div className="field"><label htmlFor={`t-${s.id}`}>Título</label><input id={`t-${s.id}`} value={s.title} onChange={(e) => patch(i, { title: e.target.value })} /></div>
            <div className="field"><label htmlFor={`n-${s.id}`}>Narração</label><textarea id={`n-${s.id}`} rows={4} value={s.narration} onChange={(e) => patch(i, { narration: e.target.value })} /></div>
            <div className="field"><label htmlFor={`v-${s.id}`}>Instruções visuais</label><textarea id={`v-${s.id}`} rows={2} value={s.visual} onChange={(e) => patch(i, { visual: e.target.value })} /></div>
            <fieldset className="field"><legend>Fontes desta cena</legend>
              {sources.length === 0 && <small className="hint">Adicione fontes no separador Fontes.</small>}
              <div className="checks wrap">{sources.map((src) => (
                <label key={src.id} className="check">
                  <input type="checkbox" checked={s.sourceIds.includes(src.id)} onChange={(e) => patch(i, { sourceIds: e.target.checked ? [...s.sourceIds, src.id] : s.sourceIds.filter((x) => x !== src.id) })} />
                  {src.title}
                </label>
              ))}</div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="actions left">
        {SCENE_KINDS.map((k) => <button key={k} className="btn ghost" onClick={() => addScene(k)}>+ {KIND[k]}</button>)}
      </div>

      {issues.length > 0 && (
        <div className="card"><h3>Verificações</h3>
          <ul className="issues">{issues.map((x, i) => <li key={i} className={x.level}><b>{x.level === "error" ? "Erro" : "Aviso"}</b> {x.message}</li>)}</ul>
          <p className="meta">Erros bloqueiam a aprovação; avisos não.</p>
        </div>
      )}

      <div className="actions sticky">
        {dirty && <span className="meta">Alterações por guardar{state.approved ? " — guardar cria nova versão e invalida a aprovação" : ""}</span>}
        <button className="btn" onClick={save} disabled={!dirty || busy || scenes.length === 0}>Guardar nova versão</button>
        <button className="btn primary" onClick={approve} disabled={dirty || busy || !state.exists || state.approved}>{state.approved ? "Aprovado" : "Aprovar roteiro"}</button>
      </div>

      {state.versions.length > 0 && (
        <details className="card"><summary>Histórico de versões ({state.versions.length})</summary>
          <ul className="versions">{state.versions.map((v) => (
            <li key={v.version}>
              <b>v{v.version}</b> · {v.origin} · {new Date(v.createdAt).toLocaleString()} {v.approved && <span className="pill s-succeeded">aprovada</span>}
              {v.note && <div className="meta">{v.note}</div>}
              <button className="btn ghost" onClick={() => loadVersion(v.version)}>Abrir no editor</button>
            </li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
