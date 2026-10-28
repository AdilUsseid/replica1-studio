import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "@replica/core";
import { createApp } from "../src/app.ts";

let server: Server, base: string;
const body = { name: "Canal API", niche: "Tech", audience: "Todos", language: "pt-MZ" };
const call = async (method: string, url: string, data?: unknown) => {
  const r = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, json: (await r.json()) as any };
};

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "replica-api-"));
  const app = createApp({ db: openDb(dir), storageDir: dir, env: {} });
  await new Promise<void>((res) => { server = app.listen(0, "127.0.0.1", () => res()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("API", () => {
  it("health", async () => {
    const r = await call("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, schemaVersion: 2 });
  });

  it("CRUD de canais com validação e erros por campo", async () => {
    const bad = await call("POST", "/api/channels", { ...body, name: "", primaryColor: "x" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toHaveProperty("name");
    expect(bad.json.error.fields).toHaveProperty("primaryColor");

    const created = await call("POST", "/api/channels", body);
    expect(created.status).toBe(201);
    const id = created.json.id;

    expect((await call("POST", "/api/channels", body)).status).toBe(409);
    const patched = await call("PATCH", `/api/channels/${id}`, { tone: "Calmo" });
    expect(patched.json.tone).toBe("Calmo");
    expect(patched.json.targetDurationSeconds).toBe(600);
    expect((await call("PATCH", `/api/channels/${id}`, {})).status).toBe(400);

    expect((await call("GET", "/api/channels")).json).toHaveLength(1);
    await call("POST", `/api/channels/${id}/archive`);
    expect((await call("GET", "/api/channels")).json).toHaveLength(0);
    expect((await call("GET", "/api/channels?archived=1")).json).toHaveLength(1);
    expect((await call("GET", "/api/channels/inexistente")).status).toBe(404);
  });

  it("jobs: só tipos permitidos, cancelar e repetir com regras de estado", async () => {
    expect((await call("POST", "/api/jobs", { type: "rm -rf" })).status).toBe(400);
    const j = await call("POST", "/api/jobs", { type: "system.ffmpeg-check" });
    expect(j.status).toBe(201);
    expect(j.json.status).toBe("queued");
    expect((await call("POST", `/api/jobs/${j.json.id}/retry`)).status).toBe(409);
    expect((await call("POST", `/api/jobs/${j.json.id}/cancel`)).json.status).toBe("cancelled");
    expect((await call("POST", `/api/jobs/${j.json.id}/cancel`)).status).toBe(409);
    const detail = await call("GET", `/api/jobs/${j.json.id}`);
    expect(detail.json.events.length).toBeGreaterThan(0);
  });

  it("JSON inválido e rotas desconhecidas dão erros estruturados", async () => {
    const r = await fetch(base + "/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: "{x" });
    expect(r.status).toBe(400);
    expect((await call("GET", "/api/nada")).json.error.code).toBe("not_found");
  });
});

describe("API editorial", () => {
  let channelId: string, ideaId: string;
  it("ideias: criar, ordenar, validar", async () => {
    channelId = (await call("POST", "/api/channels", { name: "Canal Editorial", niche: "N", audience: "A", language: "pt-MZ" })).json.id;
    expect((await call("POST", "/api/ideas", { channelId, title: "" })).status).toBe(400);
    expect((await call("POST", "/api/ideas", { channelId: "nope", title: "X" })).status).toBe(400);
    const a = await call("POST", "/api/ideas", { channelId, title: "Primeira" });
    const b = await call("POST", "/api/ideas", { channelId, title: "Segunda" });
    expect(a.status).toBe(201);
    ideaId = a.json.id;
    expect((await call("POST", `/api/ideas/${b.json.id}/move`, { direction: "up" })).status).toBe(200);
    const list = await call("GET", `/api/ideas?channelId=${channelId}`);
    expect(list.json.map((i: any) => i.title)).toEqual(["Segunda", "Primeira"]);
    expect((await call("POST", `/api/ideas/${b.json.id}/move`, { direction: "sideways" })).status).toBe(400);
    expect((await call("PATCH", `/api/ideas/${ideaId}`, { status: "in_progress" })).json.status).toBe("in_progress");
    expect((await call("GET", "/api/ideas/nope")).status).toBe(404);
  });

  it("fontes: só http(s); remover só se não citada", async () => {
    expect((await call("POST", `/api/ideas/${ideaId}/sources`, { title: "x", url: "javascript:alert(1)" })).status).toBe(400);
    const s = await call("POST", `/api/ideas/${ideaId}/sources`, { title: "Wikipedia", url: "https://pt.wikipedia.org/wiki/IA", accessedAt: "2026-10-01" });
    expect(s.status).toBe(201);
    expect((await call("GET", `/api/ideas/${ideaId}/sources`)).json).toHaveLength(1);
    const put = await call("PUT", `/api/ideas/${ideaId}/script`, { scenes: [{ id: "a", kind: "hook", narration: "Olá", visual: "v", sourceIds: [s.json.id] }] });
    expect(put.status).toBe(200);
    const del = await fetch(base + `/api/sources/${s.json.id}`, { method: "DELETE" });
    expect(del.status).toBe(409);
  });

  it("roteiro: versões, aprovação e invalidação", async () => {
    expect((await call("PUT", `/api/ideas/${ideaId}/script`, { scenes: [] })).status).toBe(400);
    expect((await call("PUT", `/api/ideas/${ideaId}/script`, {})).status).toBe(400);
    const st = await call("GET", `/api/ideas/${ideaId}/script`);
    expect(st.json.latestVersion).toBe(1);
    expect((await call("POST", `/api/ideas/${ideaId}/script/versions/9/approve`)).status).toBe(409);
    expect((await call("POST", `/api/ideas/${ideaId}/script/versions/abc/approve`)).status).toBe(400);
    const ok = await call("POST", `/api/ideas/${ideaId}/script/versions/1/approve`);
    expect(ok.json.approved).toBe(true);
    expect((await call("GET", `/api/ideas/${ideaId}`)).json.scriptApproved).toBe(true);
    const sc = st.json.content.scenes;
    const v2 = await call("PUT", `/api/ideas/${ideaId}/script`, { scenes: [{ ...sc[0], narration: "Olá, versão dois" }] });
    expect(v2.json.latestVersion).toBe(2);
    expect(v2.json.approved).toBe(false);
    expect((await call("GET", `/api/ideas/${ideaId}/script/versions/1`)).json.content.scenes[0].narration).toBe("Olá");
    expect((await call("GET", `/api/ideas/${ideaId}/script/versions/7`)).status).toBe(404);
  });

  it("geração: valida adaptador, cria job e evita duplicados", async () => {
    expect((await call("GET", "/api/generators")).json.find((g: any) => g.id === "template").ok).toBe(true);
    expect((await call("POST", `/api/ideas/${ideaId}/script/generate`, { adapter: "xpto" })).status).toBe(400);
    const off = await call("POST", `/api/ideas/${ideaId}/script/generate`, { adapter: "ollama" });
    expect(off.status).toBe(409);
    expect(off.json.error.code).toBe("generator_unavailable");
    const j = await call("POST", `/api/ideas/${ideaId}/script/generate`, { adapter: "template" });
    expect(j.status).toBe(202);
    expect(j.json.type).toBe("script.generate");
    expect((await call("POST", `/api/ideas/${ideaId}/script/generate`, { adapter: "template" })).status).toBe(409);
  });
});
