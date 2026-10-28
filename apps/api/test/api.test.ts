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
  const app = createApp({ db: openDb(dir), storageDir: dir });
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
