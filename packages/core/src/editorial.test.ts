import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, ChannelRepo, IdeaRepo, JobRepo, ScriptRepo, listEvents, openDb, type Db } from "./index.ts";

let db: Db, channels: ChannelRepo, ideas: IdeaRepo, scripts: ScriptRepo, channelId: string;
const scene = (o: object = {}) => ({ id: "s" + Math.random().toString(36).slice(2, 8), kind: "development", title: "", narration: "Texto de teste.", visual: "Imagem", sourceIds: [], ...o });

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "replica-ed-"));
  db = openDb(dir, ":memory:");
  channels = new ChannelRepo(db, dir);
  ideas = new IdeaRepo(db);
  scripts = new ScriptRepo(db);
  channelId = channels.create({ name: "C", niche: "n", audience: "a", language: "pt-MZ" }).id;
});

describe("ideias", () => {
  it("cria na fila por ordem e reordena", () => {
    const a = ideas.create({ channelId, title: "A" });
    const b = ideas.create({ channelId, title: "B" });
    const c = ideas.create({ channelId, title: "C" });
    expect(ideas.list({ channelId }).map((i) => i.title)).toEqual(["A", "B", "C"]);
    ideas.move(c.id, "up");
    expect(ideas.list({ channelId }).map((i) => i.title)).toEqual(["A", "C", "B"]);
    ideas.move(a.id, "up"); // já é a primeira: sem efeito
    expect(ideas.list({ channelId })[0]!.title).toBe("A");
    ideas.move(a.id, "down");
    expect(ideas.list({ channelId }).map((i) => i.title)).toEqual(["C", "A", "B"]);
    void b;
  });
  it("exige canal existente e ativo", () => {
    expect(() => ideas.create({ channelId: "nope", title: "x" })).toThrow(/Canal inexistente/);
    channels.archive(channelId);
    expect(() => ideas.create({ channelId, title: "x" })).toThrow(/arquivado/);
  });
  it("arquivar mantém os dados e tira da fila", () => {
    const i = ideas.create({ channelId, title: "A" });
    ideas.archive(i.id);
    expect(ideas.list({ channelId })).toHaveLength(0);
    expect(ideas.list({ channelId, includeArchived: true })).toHaveLength(1);
    expect(() => ideas.update(i.id, { title: "x" })).toThrow(/arquivada/);
  });
});

describe("fontes", () => {
  it("guarda URL, nota, citação e data fornecida; rejeita esquemas perigosos", () => {
    const i = ideas.create({ channelId, title: "A" });
    const s = ideas.addSource(i.id, { title: "Livro", url: "https://exemplo.org/x", quote: "citação", accessedAt: "2026-10-01" });
    expect(s).toMatchObject({ url: "https://exemplo.org/x", quote: "citação", accessedAt: "2026-10-01" });
    expect(() => ideas.addSource(i.id, { title: "x", url: "javascript:alert(1)" })).toThrow(AppError);
    expect(ideas.get(i.id).sourceCount).toBe(1);
  });
  it("não remove fonte citada por um roteiro, mas remove as não usadas", () => {
    const i = ideas.create({ channelId, title: "A" });
    const used = ideas.addSource(i.id, { title: "Usada" });
    const free = ideas.addSource(i.id, { title: "Livre" });
    scripts.addVersion(i.id, { scenes: [scene({ sourceIds: [used.id] })] }, "manual");
    expect(() => ideas.removeSource(used.id)).toThrow(/citada/);
    ideas.removeSource(free.id);
    expect(ideas.sources(i.id)).toHaveLength(1);
  });
});

describe("roteiros: versões e aprovação", () => {
  it("versões são imutáveis e sequenciais; conteúdo idêntico não duplica", () => {
    const i = ideas.create({ channelId, title: "A" });
    const sc = scene();
    expect(scripts.addVersion(i.id, { scenes: [sc] }, "template").latestVersion).toBe(1);
    expect(scripts.addVersion(i.id, { scenes: [sc] }, "manual").latestVersion).toBe(1);
    const s2 = scripts.addVersion(i.id, { scenes: [{ ...sc, narration: "Outro texto." }] }, "manual", "ajuste");
    expect(s2.latestVersion).toBe(2);
    expect(s2.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(scripts.getVersion(i.id, 1).content.scenes[0]!.narration).toBe("Texto de teste.");
  });

  it("aprova a versão exata e qualquer nova versão invalida a aprovação", () => {
    const i = ideas.create({ channelId, title: "A" });
    const sc = scene();
    scripts.addVersion(i.id, { scenes: [sc] }, "manual");
    expect(scripts.approve(i.id, 1).approved).toBe(true);
    expect(ideas.get(i.id).scriptApproved).toBe(true);
    const s = scripts.addVersion(i.id, { scenes: [{ ...sc, narration: "Alterado." }] }, "manual");
    expect(s.approved).toBe(false);
    expect(ideas.get(i.id).scriptApproved).toBe(false);
    expect(() => scripts.approve(i.id, 1)).toThrow(/mais recente/);
    expect(scripts.approve(i.id, 2).approved).toBe(true);
    expect(listEvents(db).some((e) => /aprovação anterior invalidada/.test(e.message))).toBe(true);
  });

  it("bloqueia a aprovação com erros (narração vazia, fonte inexistente) mas não com avisos", () => {
    const i = ideas.create({ channelId, title: "A" });
    scripts.addVersion(i.id, { scenes: [scene({ narration: "" })] }, "manual");
    try { scripts.approve(i.id, 1); expect.unreachable(); } catch (e) { expect((e as AppError).status).toBe(422); }
    scripts.addVersion(i.id, { scenes: [scene({ sourceIds: ["fantasma"] })] }, "manual");
    expect(() => scripts.approve(i.id, 2)).toThrow(/erros/);
    scripts.addVersion(i.id, { scenes: [scene({ visual: "" })] }, "manual"); // só aviso
    expect(scripts.approve(i.id, 3).approved).toBe(true);
  });

  it("deteta adulteração: conteúdo alterado fora das versões anula a aprovação", () => {
    const i = ideas.create({ channelId, title: "A" });
    scripts.addVersion(i.id, { scenes: [scene()] }, "manual");
    scripts.approve(i.id, 1);
    db.prepare("UPDATE script_versions SET content = replace(content, 'Texto de teste.', 'ADULTERADO')").run();
    expect(scripts.state(i.id).approved).toBe(false);
  });

  it("valida a estrutura e calcula a duração estimada", () => {
    const i = ideas.create({ channelId, title: "A" });
    expect(() => scripts.addVersion(i.id, { scenes: [] }, "manual")).toThrow(/inválido/);
    const long = Array(150).fill("palavra").join(" ");
    expect(scripts.addVersion(i.id, { scenes: [scene({ narration: long })] }, "manual").totalSeconds).toBe(60);
  });
});

describe("jobs de roteiro", () => {
  it("deteta job pendente da mesma ideia (idempotência)", () => {
    const jobs = new JobRepo(db);
    const i = ideas.create({ channelId, title: "A" });
    expect(jobs.findActiveForIdea("script.generate", i.id)).toBeNull();
    const j = jobs.enqueue("script.generate", { ideaId: i.id });
    expect(jobs.findActiveForIdea("script.generate", i.id)?.id).toBe(j.id);
    jobs.cancel(j.id);
    expect(jobs.findActiveForIdea("script.generate", i.id)).toBeNull();
  });
});
