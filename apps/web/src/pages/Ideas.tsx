import { useEffect, useState, type FormEvent } from "react";
import type { Channel, Idea } from "@replica/shared";
import { api } from "../api";
import { useLoad } from "../hooks";
import { SourcesPanel } from "../components/SourcesPanel";
import { ScriptEditor } from "../components/ScriptEditor";

const STATUS: Record<Idea["status"], string> = { queued: "Na fila", in_progress: "Em produção", discarded: "Descartada" };

export function Ideas({ ideaId }: { ideaId: string | null }) {
  const channels = useLoad(() => api.channels());
  const [channelId, setChannelId] = useState<string>("");
  useEffect(() => { if (!channelId && channels.data?.[0]) setChannelId(channels.data[0].id); }, [channels.data, channelId]);
  if (ideaId) return <IdeaDetail id={ideaId} />;
  if (channels.loading) return <p className="muted">A carregar…</p>;
  if (channels.error) return <p className="banner error" role="alert">{channels.error}</p>;
  if (!channels.data?.length) {
    return (
      <section>
        <header className="page-head"><div><h1>Ideias, fontes e roteiros</h1></div></header>
        <div className="empty card"><h3>Precisa de um canal primeiro</h3><p className="muted">As ideias pertencem a um canal.</p><a className="btn primary" href="#/channels">Ir para Canais</a></div>
      </section>
    );
  }
  return <Queue channels={channels.data} channelId={channelId} setChannelId={setChannelId} />;
}

function Queue({ channels, channelId, setChannelId }: { channels: Channel[]; channelId: string; setChannelId: (v: string) => void }) {
  const list = useLoad(() => api.ideas(channelId), undefined, channelId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); list.reload(); } catch (e) { setErr((e as Error).message); } };

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("O título é obrigatório"); return; }
    await run(async () => { await api.createIdea({ channelId, title, description }); setTitle(""); setDescription(""); });
  }
  return (
    <section>
      <header className="page-head">
        <div><h1>Ideias, fontes e roteiros</h1><p className="muted">Fila editorial por canal. Abra uma ideia para registar fontes e escrever o roteiro.</p></div>
        <div className="field"><label htmlFor="ch">Canal</label>
          <select id="ch" value={channelId} onChange={(e) => setChannelId(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
      </header>
      <form className="card form" onSubmit={add} noValidate aria-label="Nova ideia">
        <div className="grid2">
          <div className="field"><label htmlFor="idea-title">Nova ideia</label><input id="idea-title" value={title} placeholder="Ex.: A história da inteligência artificial" onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label htmlFor="idea-desc">Descrição (opcional)</label><input id="idea-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <div className="actions"><button className="btn primary" type="submit">Adicionar à fila</button></div>
      </form>
      {err && <p className="banner error" role="alert">{err}</p>}
      {list.error && <p className="banner error" role="alert">{list.error}</p>}
      {list.data?.length === 0 && <div className="empty card"><h3>Fila vazia</h3><p className="muted">Adicione a primeira ideia deste canal.</p></div>}
      <ol className="queue">
        {list.data?.map((i, n) => (
          <li key={i.id} className="card idea">
            <div className="job-head">
              <h3><a href={`#/ideas/${i.id}`}>{i.title}</a></h3>
              <span className={`pill s-${i.status === "in_progress" ? "running" : i.status === "discarded" ? "failed" : "queued"}`}>{STATUS[i.status]}</span>
            </div>
            {i.description && <p className="muted">{i.description}</p>}
            <p className="meta">{i.sourceCount} fonte(s) · {i.hasScript ? (i.scriptApproved ? "roteiro aprovado" : "roteiro em rascunho") : "sem roteiro"}</p>
            <div className="actions">
              <button className="btn ghost" disabled={n === 0} onClick={() => run(() => api.moveIdea(i.id, "up"))} aria-label={`Subir ${i.title}`}>↑</button>
              <button className="btn ghost" disabled={n === (list.data?.length ?? 0) - 1} onClick={() => run(() => api.moveIdea(i.id, "down"))} aria-label={`Descer ${i.title}`}>↓</button>
              <button className="btn ghost" onClick={() => run(() => api.archiveIdea(i.id))}>Arquivar</button>
              <a className="btn primary" href={`#/ideas/${i.id}`}>Abrir</a>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IdeaDetail({ id }: { id: string }) {
  const idea = useLoad(() => api.idea(id), undefined, id);
  const channel = useLoad(async () => (idea.data ? (await api.channels(true)).find((c) => c.id === idea.data!.channelId) ?? null : null), undefined, idea.data?.channelId);
  const sources = useLoad(() => api.sources(id), undefined, id);
  const [tab, setTab] = useState<"script" | "sources">("script");
  if (idea.error) return <p className="banner error" role="alert">{idea.error} <a href="#/ideas">Voltar</a></p>;
  if (!idea.data || !channel.data) return <p className="muted">A carregar…</p>;
  const reload = () => { idea.reload(); sources.reload(); };
  return (
    <section>
      <p><a href="#/ideas">← Fila de ideias</a></p>
      <header className="page-head">
        <div><h1>{idea.data.title}</h1><p className="muted">{idea.data.description || "Sem descrição"} · canal {channel.data.name}</p></div>
        <div className="field"><label htmlFor="st">Estado</label>
          <select id="st" value={idea.data.status} onChange={async (e) => { await api.updateIdea(id, { status: e.target.value as Idea["status"] }); idea.reload(); }}>
            {(Object.keys(STATUS) as Idea["status"][]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}
          </select>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "script"} className={tab === "script" ? "on" : ""} onClick={() => setTab("script")}>Roteiro</button>
        <button role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>Fontes ({sources.data?.length ?? idea.data.sourceCount})</button>
      </div>
      {tab === "script" && <ScriptEditor ideaId={id} channel={channel.data} sources={sources.data ?? []} onChange={reload} />}
      {tab === "sources" && <SourcesPanel ideaId={id} onChange={reload} />}
    </section>
  );
}
