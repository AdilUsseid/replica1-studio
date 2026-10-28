// Teste de ponta a ponta com processos reais: API + worker + SQLite em disco.
// Prova: arranque, criação de canal, job real de FFmpeg, persistência após reinício.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tsx = path.join(root, "node_modules/.bin/tsx");
const storage = mkdtempSync(path.join(tmpdir(), "replica-smoke-"));
const port = 3100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), REPLICA_STORAGE_DIR: storage, REPLICA_WEB_DIST: path.join(root, "apps/web/dist") };
const procs = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "  ✔" : "  ✘"} ${msg}`); if (!ok) failed++; };
const start = (cwd, file) => { const p = spawn(tsx, [file], { cwd: path.join(root, cwd), env, stdio: ["ignore", "pipe", "pipe"] }); p.stderr.on("data", (d) => { const s = d.toString(); if (!/ExperimentalWarning|trace-warnings/.test(s)) process.stderr.write(s); }); procs.push(p); return p; };
const stop = async (...ps) => { for (const p of ps) { p.kill("SIGTERM"); await new Promise((r) => p.once("exit", r)); } };
const j = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { "content-type": "application/json" }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null), r }; };
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await new Promise((r) => setTimeout(r, 200)); } throw new Error("timeout"); }

try {
  console.log("1) Arranque");
  let api = start("apps/api", "src/server.ts");
  let worker = start("apps/worker", "src/main.ts");
  await waitFor(async () => (await j("GET", "/api/health")).status === 200);
  check(true, "API respondeu em /api/health");
  const page = await fetch(base + "/");
  check(page.ok && (await page.text()).includes('id="root"'), "Interface web servida pela API (build)");

  console.log("2) Criar canal");
  const c = await j("POST", "/api/channels", { name: "Canal Smoke", niche: "Tecnologia", audience: "Estudantes", language: "pt-MZ" });
  check(c.status === 201 && c.body.id, "Canal criado (201)");

  console.log("3) Job real de FFmpeg processado pelo worker");
  const job = await j("POST", "/api/jobs", { type: "system.ffmpeg-check" });
  const done = await waitFor(async () => { const r = await j("GET", `/api/jobs/${job.body.id}`); return ["succeeded", "failed"].includes(r.body.status) && r.body; });
  check(done.status === "succeeded" && done.result.available, `Job ${done.status}: ${done.result?.version ?? done.error}`);

  console.log("4) Persistência após reiniciar tudo");
  await stop(api, worker);
  api = start("apps/api", "src/server.ts");
  worker = start("apps/worker", "src/main.ts");
  await waitFor(async () => (await j("GET", "/api/health")).status === 200);
  const list = await j("GET", "/api/channels");
  check(list.body.length === 1 && list.body[0].id === c.body.id, "Canal ainda existe após reinício");
  const jobs = await j("GET", "/api/jobs");
  check(jobs.body.some((x) => x.id === job.body.id && x.status === "succeeded"), "Histórico de jobs preservado");
  await stop(api, worker);
} catch (e) {
  check(false, `Erro: ${e.message}`);
} finally {
  for (const p of procs) p.kill("SIGKILL");
  rmSync(storage, { recursive: true, force: true });
}
console.log(failed ? `\nSMOKE FALHOU (${failed})` : "\nSMOKE OK");
process.exit(failed ? 1 : 0);
