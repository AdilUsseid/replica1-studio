import { useState, type FormEvent } from "react";
import { sourceInputSchema } from "@replica/shared";
import { api, ApiError } from "../api";
import { useLoad } from "../hooks";

export function SourcesPanel({ ideaId, onChange }: { ideaId: string; onChange: () => void }) {
  const list = useLoad(() => api.sources(ideaId), undefined, ideaId);
  const [f, setF] = useState({ title: "", url: "", accessedAt: "", quote: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function add(e: FormEvent) {
    e.preventDefault();
    const p = sourceInputSchema.safeParse(f);
    if (!p.success) {
      const er: Record<string, string> = {};
      for (const i of p.error.issues) er[String(i.path[0])] ??= i.message;
      setErrors(er);
      return;
    }
    setErrors({});
    try {
      await api.addSource(ideaId, f);
      setF({ title: "", url: "", accessedAt: "", quote: "", note: "" });
      setMsg({ kind: "ok", text: "Fonte guardada." });
      list.reload();
      onChange();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }
  async function remove(id: string) {
    try {
      await api.removeSource(id);
      setMsg({ kind: "ok", text: "Fonte removida." });
      list.reload();
      onChange();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }
  const input = (k: keyof typeof f, label: string, ph = "") => (
    <div className="field">
      <label htmlFor={`src-${k}`}>{label}</label>
      <input id={`src-${k}`} value={f[k]} placeholder={ph} aria-invalid={!!errors[k]} onChange={(e) => set(k, e.target.value)} />
      {errors[k] && <small className="err" role="alert">{errors[k]}</small>}
    </div>
  );
  return (
    <div>
      <p className="banner info">As fontes são introduzidas por si. Esta versão <b>não pesquisa na Internet</b> automaticamente: nada aqui é apresentado como pesquisado sem ter sido você a registar a fonte.</p>
      {msg && <p className={`banner ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</p>}
      {list.data?.length === 0 && <p className="muted">Sem fontes ainda.</p>}
      <ul className="sources">
        {list.data?.map((s) => (
          <li key={s.id} className="card">
            <div className="job-head">
              <h3>{s.title}</h3>
              <button className="btn ghost" onClick={() => remove(s.id)} aria-label={`Remover fonte ${s.title}`}>Remover</button>
            </div>
            {s.url && <p className="meta"><a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>{s.accessedAt && ` · consultada em ${s.accessedAt}`}</p>}
            {s.quote && <blockquote>“{s.quote}”</blockquote>}
            {s.note && <p className="muted">{s.note}</p>}
          </li>
        ))}
      </ul>
      <form className="card form" onSubmit={add} noValidate aria-label="Nova fonte">
        <h3>Adicionar fonte</h3>
        <div className="grid2">{input("title", "Título", "Ex.: Artigo de Turing, 1950")}{input("url", "URL (opcional)", "https://…")}</div>
        <div className="grid2">{input("accessedAt", "Data de consulta (AAAA-MM-DD)")}{input("note", "Nota")}</div>
        {input("quote", "Citação / evidência")}
        <div className="actions"><button className="btn primary" type="submit">Guardar fonte</button></div>
      </form>
    </div>
  );
}
