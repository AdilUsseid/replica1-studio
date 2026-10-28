import { describe, expect, it } from "vitest";
import { openDb, JobRepo } from "@replica/core";
import { runOnce } from "./runner.ts";

describe("worker", () => {
  it("executa job real de FFmpeg e guarda o resultado (ou falha com instruções)", async () => {
    const db = openDb("", ":memory:");
    const jobs = new JobRepo(db);
    const j = jobs.enqueue("system.ffmpeg-check", {}, { maxAttempts: 1 });
    expect(await runOnce(db)).toBe(true);
    const r = jobs.get(j.id);
    if (r.status === "succeeded") expect((r.result as { available: boolean }).available).toBe(true);
    else expect(r.error).toMatch(/FFmpeg/);
  });

  it("falha do handler regista erro e esgota tentativas", async () => {
    const db = openDb("", ":memory:");
    const jobs = new JobRepo(db);
    const j = jobs.enqueue("t", {}, { maxAttempts: 2 });
    const boom = { t: async () => { throw new Error("falhou"); } };
    await runOnce(db, boom);
    expect(jobs.get(j.id).status).toBe("queued");
    await runOnce(db, boom);
    const r = jobs.get(j.id);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("falhou");
  });

  it("ignora tipos sem handler e devolve false se não há trabalho", async () => {
    const db = openDb("", ":memory:");
    new JobRepo(db).enqueue("desconhecido");
    expect(await runOnce(db)).toBe(false);
  });

  it("cancelamento pedido durante a execução termina em cancelled", async () => {
    const db = openDb("", ":memory:");
    const jobs = new JobRepo(db);
    const j = jobs.enqueue("t");
    await runOnce(db, { t: async ({ jobs, job }) => { jobs.cancel(job.id); return {}; } });
    expect(jobs.get(j.id).status).toBe("cancelled");
  });
});

describe("worker: geração de roteiro", () => {
  it("processa script.generate em segundo plano e cria versão do roteiro", async () => {
    const { ChannelRepo, IdeaRepo, ScriptRepo } = await import("@replica/core");
    const db = openDb("", ":memory:");
    const ch = new ChannelRepo(db, "").create({ name: "C", niche: "N", audience: "A", language: "pt-MZ" });
    const idea = new IdeaRepo(db).create({ channelId: ch.id, title: "Tema" });
    const jobs = new JobRepo(db);
    const j = jobs.enqueue("script.generate", { ideaId: idea.id, adapter: "template" });
    expect(await runOnce(db)).toBe(true);
    const r = jobs.get(j.id);
    expect(r.status).toBe("succeeded");
    expect((r.result as { version: number }).version).toBe(1);
    expect(new ScriptRepo(db).state(idea.id).exists).toBe(true);
  });

  it("falha de geração (adaptador indisponível) fica registada no job", async () => {
    const { ChannelRepo, IdeaRepo } = await import("@replica/core");
    const db = openDb("", ":memory:");
    const ch = new ChannelRepo(db, "").create({ name: "C", niche: "N", audience: "A", language: "pt-MZ" });
    const idea = new IdeaRepo(db).create({ channelId: ch.id, title: "Tema" });
    const jobs = new JobRepo(db);
    const j = jobs.enqueue("script.generate", { ideaId: idea.id, adapter: "ollama" }, { maxAttempts: 1 });
    await runOnce(db);
    const r = jobs.get(j.id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/OLLAMA_MODEL/);
  });
});
