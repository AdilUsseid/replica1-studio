import { api } from "../api";
import { useLoad } from "../hooks";

export function Dashboard({ go }: { go: (r: string) => void }) {
  const channels = useLoad(() => api.channels(), undefined);
  const jobs = useLoad(api.jobs, 3000);
  const ff = useLoad(api.ffmpeg, undefined);
  const n = channels.data?.length ?? 0;
  const count = (s: string) => jobs.data?.filter((j) => j.status === s).length ?? 0;
  return (
    <section>
      <header className="page-head"><div><h1>Dashboard</h1><p className="muted">Estado real da instalação. Os números vêm da base de dados.</p></div></header>
      {(channels.error || jobs.error) && <p className="banner error" role="alert">{channels.error ?? jobs.error}</p>}
      <div className="stats">
        <div className="card stat"><span className="num">{channels.data ? n : "—"}</span><span>Canais ativos</span></div>
        <div className="card stat"><span className="num">{jobs.data ? count("running") + count("queued") : "—"}</span><span>Jobs pendentes</span></div>
        <div className="card stat"><span className="num">{jobs.data ? count("succeeded") : "—"}</span><span>Jobs concluídos</span></div>
        <div className="card stat"><span className="num">0</span><span>Vídeos exportados</span></div>
      </div>
      <div className="card">
        <h3>FFmpeg</h3>
        {ff.loading && <p className="muted">A verificar…</p>}
        {ff.data?.available && <p className="banner ok">{ff.data.version}<br /><small>libx264: {ff.data.encoders.libx264 ? "sim" : "não"} · aac: {ff.data.encoders.aac ? "sim" : "não"} · legendas (libass): {ff.data.encoders.libass ? "sim" : "não"}</small></p>}
        {ff.data && !ff.data.available && <p className="banner error">{ff.data.error}</p>}
      </div>
      {channels.data && n === 0 && (
        <div className="card empty">
          <h3>Primeiro passo: crie um canal</h3>
          <p className="muted">O canal guarda nicho, público, tom e formatos. Tudo é persistido localmente.</p>
          <button className="btn primary" onClick={() => go("channels")}>Criar canal</button>
        </div>
      )}
      <p className="muted small">Estado do produto: a produção de vídeo ainda não está implementada (Marco C). O dashboard não mostra resultados simulados.</p>
    </section>
  );
}
