import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, ChannelRepo, IdeaRepo, ScriptRepo, generateScript, listGenerators, templateGenerator, ollamaGenerator, type Db } from "./index.ts";

let db: Db, ideaId: string, ideas: IdeaRepo;
beforeEach(() => {
  db = openDb("", ":memory:");
  const ch = new ChannelRepo(db, "").create({ name: "C", niche: "Tech", audience: "Todos", language: "pt-MZ", targetDurationSeconds: 600 });
  ideas = new IdeaRepo(db);
  ideaId = ideas.create({ channelId: ch.id, title: "História da IA", description: "De Turing aos LLMs" }).id;
});

describe("gerador esqueleto", () => {
  it("cria estrutura por duração, sem narração inventada, e bloqueia aprovação", async () => {
    const st = await generateScript(db, ideaId, "template");
    const kinds = st.content!.scenes.map((s) => s.kind);
    expect(kinds[0]).toBe("hook");
    expect(kinds.at(-1)).toBe("conclusion");
    expect(kinds.filter((k) => k === "development")).toHaveLength(5); // 600s/90 - 2
    expect(st.content!.scenes.every((s) => s.narration === "")).toBe(true);
    expect(st.origin).toBe("template");
    expect(() => new ScriptRepo(db).approve(ideaId, 1)).toThrow(/Corrija os erros/);
  });

  it("repetir não duplica versões (ids determinísticos)", async () => {
    await generateScript(db, ideaId, "template");
    const st = await generateScript(db, ideaId, "template");
    expect(st.versions).toHaveLength(1);
  });

  it("gerar depois de uma aprovação cria nova versão e invalida a aprovação", async () => {
    const repo = new ScriptRepo(db);
    repo.addVersion(ideaId, { scenes: [{ id: "a", kind: "hook", narration: "Olá mundo", visual: "x" }] }, "manual");
    repo.approve(ideaId, 1);
    expect(repo.state(ideaId).approved).toBe(true);
    const st = await generateScript(db, ideaId, "template");
    expect(st.latestVersion).toBe(2);
    expect(st.approved).toBe(false);
  });
});

describe("Ollama (servidor local simulado)", () => {
  let server: Server, url: string, reply: { status: number; body: unknown }, lastPrompt = "";
  beforeEach(async () => {
    reply = { status: 200, body: {} };
    server = createServer((req, res) => {
      if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }] })); return; }
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
        lastPrompt = JSON.parse(b).prompt;
        res.statusCode = reply.status; res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(() => server.close());
  const env = () => ({ OLLAMA_URL: url, OLLAMA_MODEL: "llama3.2" });

  it("indisponível sem modelo configurado ou com modelo não instalado", async () => {
    expect((await ollamaGenerator(null).available()).ok).toBe(false);
    expect((await ollamaGenerator({ url, model: "outro" }).available()).reason).toMatch(/não instalado/);
    expect((await ollamaGenerator({ url: "http://127.0.0.1:1", model: "x" }).available()).reason).toMatch(/inacessível/);
    expect((await ollamaGenerator({ url, model: "llama3.2" }).available()).ok).toBe(true);
  });

  it("converte a resposta, associa só fontes reais e descarta referências inventadas", async () => {
    const src = ideas.addSource(ideaId, { title: "Artigo de Turing", url: "https://example.org/turing" });
    reply.body = { response: JSON.stringify({ scenes: [
      { kind: "hook", title: "Abertura", narration: "Pode uma máquina pensar?", visual: "Turing", sources: [] },
      { kind: "development", title: "1950", narration: "Em 1950...", visual: "", sources: ["S1", "S9", "inventada"] },
      { kind: "conclusion", title: "Fim", narration: "Obrigado.", visual: "", sources: [] },
    ] }) };
    const st = await generateScript(db, ideaId, "ollama", env());
    expect(st.origin).toBe("ollama");
    expect(st.content!.scenes[1]!.sourceIds).toEqual([src.id]);
    expect(lastPrompt).toContain("S1: Artigo de Turing");
    expect(st.versions[0]!.note).toMatch(/Rever/);
    expect(st.approved).toBe(false); // IA nunca aprova
  });

  it("falha com mensagem clara se o modelo não devolve JSON ou formato válido", async () => {
    reply.body = { response: "isto não é json" };
    await expect(generateScript(db, ideaId, "ollama", env())).rejects.toThrow(/JSON válido/);
    reply.body = { response: JSON.stringify({ scenes: [] }) };
    await expect(generateScript(db, ideaId, "ollama", env())).rejects.toThrow(/formato esperado/);
    reply = { status: 500, body: {} };
    await expect(generateScript(db, ideaId, "ollama", env())).rejects.toThrow(/500/);
    expect(new ScriptRepo(db).state(ideaId).exists).toBe(false); // nada foi guardado
  });
});

describe("registo de geradores", () => {
  it("lista disponibilidade real; adaptador desconhecido dá 404; manual não é gerador", async () => {
    const l = await listGenerators({});
    expect(l.find((g) => g.id === "template")!.ok).toBe(true);
    expect(l.find((g) => g.id === "ollama")!.ok).toBe(false);
    await expect(generateScript(db, ideaId, "xpto")).rejects.toThrow(/não encontrado/);
    await expect(generateScript(db, ideaId, "manual")).rejects.toThrow(/não encontrado/);
    await expect(generateScript(db, ideaId, "ollama", {})).rejects.toThrow(/Defina OLLAMA_MODEL/);
    expect(templateGenerator.aiGenerated).toBe(false);
  });
});
