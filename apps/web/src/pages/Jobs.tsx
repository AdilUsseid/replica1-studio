import { useState } from "react";
import { api, type Job } from "../api";
import { useLoad } from "../hooks";

const LABEL: Record<Job["status"], string> = { queued: "Em fila", running: "A executar", succeeded: "Concluído", failed: "Falhou", cancelled: "Cancelado" };
const TYPE_LABEL: Record<string, string> = { "system.ffmpeg-check": "Verificar FFmpeg" };

export function Jobs() {
  const jobs = useLoad(api.jobs, 1500);
  const events = useLoad(api.events, 3000);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); jobs.reload(); } catch (e) { setErr((e as Error).message); }
  };
  const hasActive = jobs.data?.some((j) => j.status === "queued" || j.status === "running");
  return (
    <section>
      <header className="page-head">
        <div><h1>Produções e jobs</h1><p className="muted">Estado real das tarefas, lido da base de dados. Atualiza automaticamente.</p></div>
        <button className="btn primary" onClick={() => run(() => api.createJob("system.ffmpeg-check"))}>Verificar FFmpeg</button>
      </header>
      {err && <p className="banner error" role="alert">{err}</p>}
      {jobs.error && <p className="banner error" role="alert">{jobs.error}</p>}
      {hasActive && <p className="banner info" role="status">Se um job ficar “Em fila”, confirme que o worker está a correr (<code>npm run dev</code> inicia-o).</p>}
      {!jobs.loading && jobs.data?.length === 0 && <div className="empty card"><h3>Sem jobs</h3><p className="muted">Os jobs aparecem aqui quando criar tarefas.</p></div>}
      <ul className="cards">
        {jobs.data?.map((j) => (
          <li key={j.id} className="card job">
            <div className="job-head">
              <h3>{TYPE_LABEL[j.type] ?? j.type}</h3>
              <span className={`pill s-${j.status}`}>{LABEL[j.status]}{j.cancelRequested && j.status === "running" ? " (a cancelar)" : ""}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${j.progress * 100}%` }} /></div>
            <p className="meta">Tentativa {j.attempts}/{j.maxAttempts} · criado {new Date(j.createdAt).toLocaleString()}</p>
            {j.error && <p className="banner error">{j.error}</p>}
            {j.status === "succeeded" && j.result != null && <pre className="result">{JSON.stringify(j.result, null, 2)}</pre>}
            <div className="actions">
              {(j.status === "queued" || j.status === "running") && !j.cancelRequested && <button className="btn ghost" onClick={() => run(() => api.cancelJob(j.id))}>Cancelar</button>}
              {j.status === "failed" && <button className="btn ghost" onClick={() => run(() => api.retryJob(j.id))}>Tentar de novo</button>}
            </div>
          </li>
        ))}
      </ul>
      <h2>Registo de eventos</h2>
      <ul className="events">
        {events.data?.map((e) => <li key={e.id} className={`lvl-${e.level}`}><time>{new Date(e.at).toLocaleTimeString()}</time> <b>{e.source}</b> {e.message}</li>)}
      </ul>
    </section>
  );
}
