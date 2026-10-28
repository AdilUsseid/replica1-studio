import { useState } from "react";
import type { Channel, ChannelInput } from "@replica/shared";
import { LANGUAGES } from "@replica/shared";
import { api } from "../api";
import { ChannelForm } from "../components/ChannelForm";
import { useLoad } from "../hooks";

export function Channels() {
  const [showArchived, setShowArchived] = useState(false);
  const list = useLoad(() => api.channels(showArchived), undefined, showArchived);
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function save(data: ChannelInput) {
    if (editing && editing !== "new") await api.updateChannel(editing.id, data);
    else await api.createChannel(data);
    setNotice(editing === "new" ? "Canal criado e guardado." : "Alterações guardadas.");
    setEditing(null);
    list.reload();
  }
  async function act(fn: () => Promise<unknown>, msg: string) {
    setActionError(null);
    try { await fn(); setNotice(msg); list.reload(); } catch (e) { setActionError((e as Error).message); }
  }

  if (editing) {
    return <ChannelForm initial={editing === "new" ? undefined : editing} onSubmit={save} onCancel={() => setEditing(null)} />;
  }
  return (
    <section>
      <header className="page-head">
        <div><h1>Canais</h1><p className="muted">Cada canal define o público, o tom e os formatos das suas produções.</p></div>
        <button className="btn primary" onClick={() => { setNotice(null); setEditing("new"); }}>Novo canal</button>
      </header>
      {notice && <p className="banner ok" role="status">{notice}</p>}
      {actionError && <p className="banner error" role="alert">{actionError}</p>}
      {list.error && <p className="banner error" role="alert">{list.error} <button className="link" onClick={list.reload}>Tentar de novo</button></p>}
      <label className="check inline"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar arquivados</label>
      {list.loading && <p className="muted">A carregar…</p>}
      {!list.loading && !list.error && list.data?.length === 0 && (
        <div className="empty card">
          <h3>Ainda não tem canais</h3>
          <p className="muted">Crie o primeiro canal para começar a produzir vídeos.</p>
          <button className="btn primary" onClick={() => setEditing("new")}>Criar o primeiro canal</button>
        </div>
      )}
      <ul className="cards">
        {list.data?.map((c) => (
          <li key={c.id} className={`card channel ${c.archivedAt ? "archived" : ""}`} style={{ borderTopColor: c.primaryColor }}>
            <div className="channel-head">
              <span className="swatch" style={{ background: c.primaryColor }} /><span className="swatch" style={{ background: c.secondaryColor }} />
              <h3>{c.name}</h3>{c.archivedAt && <span className="pill">arquivado</span>}
            </div>
            <p className="muted">{c.niche} · {c.audience}</p>
            <p className="meta">
              {LANGUAGES.find((l) => l.code === c.language)?.label} · ~{Math.round(c.targetDurationSeconds / 60)} min · {c.formats.join(", ")} · {c.frequency}
            </p>
            <div className="actions">
              {c.archivedAt ? (
                <button className="btn ghost" onClick={() => act(() => api.restoreChannel(c.id), "Canal restaurado.")}>Restaurar</button>
              ) : (
                <>
                  <button className="btn ghost" onClick={() => { setNotice(null); setEditing(c); }}>Editar</button>
                  <button className="btn ghost" onClick={() => act(() => api.archiveChannel(c.id), "Canal arquivado (os dados são mantidos).")}>Arquivar</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
