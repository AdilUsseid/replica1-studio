import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AppError, ChannelRepo, IdeaRepo, JobRepo, ScriptRepo, checkFfmpeg, listEvents, listGenerators, getGenerators, conflict,
  type Db, type JobStatus,
} from "@replica/core";
import type { ApiErrorBody } from "@replica/shared";

/** Tipos de job que a API aceita criar. O worker tem de ter um handler para cada um. */
export const USER_JOB_TYPES = ["system.ffmpeg-check"] as const;

const STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

export interface AppDeps {
  db: Db;
  storageDir: string;
  webDist?: string;
  /** Variáveis de ambiente para os geradores (OLLAMA_URL/OLLAMA_MODEL). Injetável em testes. */
  env?: NodeJS.ProcessEnv;
}

export function createApp({ db, storageDir, webDist, env = process.env }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const channels = new ChannelRepo(db, storageDir);
  const jobs = new JobRepo(db);
  const ideas = new IdeaRepo(db);
  const scripts = new ScriptRepo(db);
  const api = express.Router();
  const versionParam = (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new AppError(400, "validation_error", "Versão inválida");
    return n;
  };

  api.get("/health", (_req, res) => {
    const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    res.json({ ok: true, schemaVersion: v.v });
  });

  api.get("/system/ffmpeg", async (_req, res) => res.json(await checkFfmpeg()));

  // Canais
  api.get("/channels", (req, res) => res.json(channels.list(req.query.archived === "1")));
  api.post("/channels", (req, res) => res.status(201).json(channels.create(req.body)));
  api.get("/channels/:id", (req, res) => res.json(channels.get(req.params.id)));
  api.patch("/channels/:id", (req, res) => res.json(channels.update(req.params.id, req.body)));
  api.post("/channels/:id/archive", (req, res) => res.json(channels.archive(req.params.id)));
  api.post("/channels/:id/restore", (req, res) => res.json(channels.restore(req.params.id)));

  // Ideias (fila editorial)
  api.get("/ideas", (req, res) =>
    res.json(ideas.list({ channelId: req.query.channelId as string | undefined, includeArchived: req.query.archived === "1" })));
  api.post("/ideas", (req, res) => res.status(201).json(ideas.create(req.body)));
  api.get("/ideas/:id", (req, res) => res.json(ideas.get(req.params.id)));
  api.patch("/ideas/:id", (req, res) => res.json(ideas.update(req.params.id, req.body)));
  api.post("/ideas/:id/move", (req, res) => {
    const d = req.body?.direction;
    if (d !== "up" && d !== "down") throw new AppError(400, "validation_error", "Direção inválida", { direction: "Use up ou down" });
    res.json(ideas.move(req.params.id, d));
  });
  api.post("/ideas/:id/archive", (req, res) => res.json(ideas.archive(req.params.id)));

  // Fontes (introdução manual; não há pesquisa web automática)
  api.get("/ideas/:id/sources", (req, res) => res.json(ideas.sources(req.params.id)));
  api.post("/ideas/:id/sources", (req, res) => res.status(201).json(ideas.addSource(req.params.id, req.body)));
  api.patch("/sources/:id", (req, res) => res.json(ideas.updateSource(req.params.id, req.body)));
  api.delete("/sources/:id", (req, res) => { ideas.removeSource(req.params.id); res.status(204).end(); });

  // Roteiros: versões imutáveis, aprovação ligada à versão exata
  api.get("/ideas/:id/script", (req, res) => res.json(scripts.state(req.params.id)));
  api.put("/ideas/:id/script", (req, res) => {
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : "";
    res.json(scripts.addVersion(req.params.id, { scenes: req.body?.scenes }, "manual", note));
  });
  api.get("/ideas/:id/script/versions/:v", (req, res) => res.json(scripts.getVersion(req.params.id, versionParam(req.params.v))));
  api.post("/ideas/:id/script/versions/:v/approve", (req, res) => res.json(scripts.approve(req.params.id, versionParam(req.params.v))));
  api.get("/generators", async (_req, res) => res.json(await listGenerators(env)));
  api.post("/ideas/:id/script/generate", async (req, res) => {
    const adapter = req.body?.adapter;
    const idea = ideas.get(req.params.id);
    const g = typeof adapter === "string" && adapter !== "manual" ? getGenerators(env)[adapter as "template" | "ollama"] : undefined;
    if (!g) throw new AppError(400, "validation_error", "Gerador desconhecido", { adapter: "Use template ou ollama" });
    const av = await g.available();
    if (!av.ok) throw new AppError(409, "generator_unavailable", av.reason ?? "Gerador indisponível");
    if (jobs.findActiveForIdea("script.generate", idea.id)) throw conflict("Já existe uma geração em curso para esta ideia");
    res.status(202).json(jobs.enqueue("script.generate", { ideaId: idea.id, adapter }, { channelId: idea.channelId, maxAttempts: 2 }));
  });

  // Jobs
  api.get("/jobs", (req, res) => {
    const s = req.query.status as JobStatus | undefined;
    if (s && !STATUSES.includes(s)) throw new AppError(400, "validation_error", "Estado inválido");
    res.json(jobs.list({ status: s }));
  });
  api.post("/jobs", (req, res) => {
    const type = req.body?.type;
    if (!USER_JOB_TYPES.includes(type)) {
      throw new AppError(400, "validation_error", "Tipo de job desconhecido", { type: `Use um de: ${USER_JOB_TYPES.join(", ")}` });
    }
    res.status(201).json(jobs.enqueue(type, {}));
  });
  api.get("/jobs/:id", (req, res) => res.json({ ...jobs.get(req.params.id), events: listEvents(db, { jobId: req.params.id }) }));
  api.post("/jobs/:id/cancel", (req, res) => res.json(jobs.cancel(req.params.id)));
  api.post("/jobs/:id/retry", (req, res) => res.json(jobs.retry(req.params.id)));

  api.get("/events", (_req, res) => res.json(listEvents(db, { limit: 100 })));

  api.use((_req, _res, next) => next(new AppError(404, "not_found", "Rota não encontrada")));
  app.use("/api", api);

  if (webDist && existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      const body: ApiErrorBody = { error: { code: err.code, message: err.message, fields: err.fields } };
      res.status(err.status).json(body);
      return;
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      const body: ApiErrorBody = { error: { code: "bad_request", message: err.type === "entity.too.large" ? "Pedido demasiado grande" : "JSON inválido" } };
      res.status(err.status ?? 400).json(body);
      return;
    }
    console.error("[api] erro inesperado:", err);
    const body: ApiErrorBody = { error: { code: "internal_error", message: "Erro interno" } };
    res.status(500).json(body);
  };
  app.use(onError);
  return app;
}
export { conflict };
